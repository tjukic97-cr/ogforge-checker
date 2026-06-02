/**
 * OGForge — Link Preview Checker
 * ---------------------------------
 * The shared engine behind the free instant-checker, the health score,
 * and the link monitor. Zero external dependencies — uses only Node built-ins.
 *
 * Public API:
 *   checkUrl(url)  ->  Promise<Report>
 *
 * A Report looks like:
 * {
 *   url, finalUrl, fetchedAt,
 *   ok: boolean,                // did we manage to fetch & parse at all
 *   score: number,             // 0..100 health score
 *   grade: 'great'|'good'|'poor'|'broken',
 *   tags: { ...extracted meta values },
 *   image: { url, reachable, status, contentType, width, height },
 *   issues: [ { id, severity, message } ],
 *   previews: { twitter, linkedin, slack, facebook }  // what each platform would show
 * }
 */

const https = require('https');
const http = require('http');
const { URL } = require('url');

// ---- tunables ---------------------------------------------------------------
const FETCH_TIMEOUT_MS = 8000;
const MAX_HTML_BYTES = 1_500_000; // don't slurp huge pages; head is near the top
const MAX_REDIRECTS = 5;
const USER_AGENT =
  'OGForgeBot/1.0 (+https://ogforge.io/bot) link-preview-checker';

// ---- tiny HTTP(S) GET with redirect + timeout + size cap -------------------
function rawGet(targetUrl, { method = 'GET', redirectsLeft = MAX_REDIRECTS } = {}) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(targetUrl);
    } catch {
      return reject(new Error('invalid-url'));
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return reject(new Error('unsupported-protocol'));
    }

    const lib = parsed.protocol === 'https:' ? https : http;
    const req = lib.request(
      parsed,
      {
        method,
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'text/html,application/xhtml+xml',
        },
      },
      (res) => {
        const status = res.statusCode || 0;

        // follow redirects
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume(); // drain
          if (redirectsLeft <= 0) return reject(new Error('too-many-redirects'));
          const next = new URL(res.headers.location, parsed).toString();
          return resolve(
            rawGet(next, { method, redirectsLeft: redirectsLeft - 1 })
          );
        }

        if (method === 'HEAD') {
          res.resume();
          return resolve({
            finalUrl: parsed.toString(),
            status,
            headers: res.headers,
            body: '',
          });
        }

        let bytes = 0;
        const chunks = [];
        res.on('data', (c) => {
          bytes += c.length;
          if (bytes > MAX_HTML_BYTES) {
            res.destroy();
          } else {
            chunks.push(c);
          }
        });
        res.on('end', () =>
          resolve({
            finalUrl: parsed.toString(),
            status,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          })
        );
      }
    );

    req.setTimeout(FETCH_TIMEOUT_MS, () => {
      req.destroy(new Error('timeout'));
    });
    req.on('error', reject);
    req.end();
  });
}

// ---- meta-tag extraction (no DOM library; just the <head>) -----------------
// We grab the head region, then pull every <meta ...> and <title>.
function extractHead(html) {
  const headMatch = html.match(/<head[^>]*>([\s\S]*?)<\/head>/i);
  return headMatch ? headMatch[1] : html.slice(0, 50_000);
}

function attr(tag, name) {
  // matches name="x" or name='x'
  const re = new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i');
  const m = tag.match(re);
  return m ? (m[2] ?? m[3] ?? '').trim() : null;
}

function parseTags(html) {
  const head = extractHead(html);
  const tags = {};

  // <title>
  const title = head.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (title) tags.htmlTitle = decodeEntities(title[1].trim());

  // every <meta ...>
  const metaRe = /<meta\b[^>]*>/gi;
  let m;
  while ((m = metaRe.exec(head)) !== null) {
    const tag = m[0];
    const key = attr(tag, 'property') || attr(tag, 'name');
    const content = attr(tag, 'content');
    if (key && content != null) tags[key.toLowerCase()] = decodeEntities(content);
  }
  return tags;
}

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x2F;/g, '/');
}

// ---- verify the og:image actually loads (and how big it is) ----------------
// PNG/JPEG/GIF/WEBP dimensions read from the first bytes — no image library.
function readImageMeta(imageUrl, baseUrl) {
  return new Promise((resolve) => {
    let abs;
    try {
      abs = new URL(imageUrl, baseUrl).toString();
    } catch {
      return resolve({ url: imageUrl, reachable: false, status: 0 });
    }

    const parsed = new URL(abs);
    const lib = parsed.protocol === 'https:' ? https : http;
    const req = lib.request(
      parsed,
      { method: 'GET', headers: { 'User-Agent': USER_AGENT } },
      (res) => {
        const status = res.statusCode || 0;
        const contentType = res.headers['content-type'] || '';
        if (status >= 400) {
          res.resume();
          return resolve({ url: abs, reachable: false, status, contentType });
        }
        const chunks = [];
        let got = 0;
        res.on('data', (c) => {
          chunks.push(c);
          got += c.length;
          if (got >= 65536) res.destroy(); // first 64KB has the header
        });
        const finish = () => {
          const buf = Buffer.concat(chunks);
          const dim = imageSize(buf);
          resolve({
            url: abs,
            reachable: status >= 200 && status < 400,
            status,
            contentType,
            width: dim.width,
            height: dim.height,
          });
        };
        res.on('end', finish);
        res.on('close', finish);
      }
    );
    req.setTimeout(FETCH_TIMEOUT_MS, () => req.destroy());
    req.on('error', () =>
      resolve({ url: abs, reachable: false, status: 0 })
    );
    req.end();
  });
}

// minimal image-dimension reader for the common formats
function imageSize(buf) {
  if (buf.length < 24) return {};
  // PNG
  if (buf[0] === 0x89 && buf[1] === 0x50) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  // GIF
  if (buf[0] === 0x47 && buf[1] === 0x49) {
    return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
  }
  // JPEG — scan for SOF marker
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i < buf.length - 8) {
      if (buf[i] !== 0xff) { i++; continue; }
      const marker = buf[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf &&
          marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
      }
      i += 2 + buf.readUInt16BE(i + 2);
    }
  }
  // WEBP (VP8X)
  if (buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP') {
    const fmt = buf.slice(12, 16).toString();
    if (fmt === 'VP8X') {
      return {
        width: 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16)),
        height: 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16)),
      };
    }
  }
  return {};
}

// ---- text quality helpers --------------------------------------------------
// Detect titles/descriptions that are technically present but useless:
// gibberish symbols, or just the bare domain instead of a real title.
function looksLikeJunk(text) {
  if (!text) return false;
  const t = text.trim();
  if (t.length < 3) return true;
  // ratio of letters/numbers to total — lots of symbols = junk
  const wordChars = (t.match(/[\p{L}\p{N}]/gu) || []).length;
  if (wordChars / t.length < 0.5) return true;
  // no actual word of 2+ letters
  if (!/[\p{L}]{2,}/u.test(t)) return true;
  return false;
}
function isJustDomain(title, finalUrl) {
  if (!title) return false;
  try {
    const host = new URL(finalUrl).hostname.replace(/^www\./, '');
    const t = title.trim().toLowerCase().replace(/^www\./, '');
    return t === host || t === host.split('.')[0];
  } catch { return false; }
}

// ---- scoring + issue detection ---------------------------------------------
// Proportional model: penalties are realistic and weighted so image, title,
// and description each carry comparable weight. A wrong-shaped tiny image is
// treated as severe (nearly as bad as no image), since it makes a card look broken.
function evaluate(tags, image, finalUrl) {
  const issues = [];
  let score = 100;

  const og = (k) => tags[`og:${k}`];
  const tw = (k) => tags[`twitter:${k}`];

  const fail = (id, severity, message, cost) => {
    issues.push({ id, severity, message });
    score -= cost;
  };

  // ---- TITLE (weight ~ up to 30) ----
  const title = og('title') || tags.htmlTitle;
  if (!title) {
    fail('no-title', 'high', 'No title found. Shares will show a bare URL with no headline.', 30);
  } else if (looksLikeJunk(title)) {
    fail('title-junk', 'high', `Title looks like junk or symbols ("${title.slice(0, 40)}"). It needs to read as a real headline.`, 26);
  } else if (isJustDomain(title, finalUrl)) {
    fail('title-domain', 'high', 'Title is just the domain name, not a real headline. The card will look generic and low-effort.', 22);
  } else if (title.length > 70) {
    fail('title-long', 'low', 'Title is long and may be truncated on some platforms.', 4);
  }

  // ---- DESCRIPTION (weight ~ up to 22) ----
  const desc = og('description') || tags.description;
  if (!desc) {
    fail('no-description', 'medium', 'No description. The card looks empty and gives no reason to click.', 18);
  } else if (looksLikeJunk(desc)) {
    fail('desc-junk', 'high', `Description looks like junk or symbols ("${desc.slice(0, 40)}"). It should be a readable sentence.`, 22);
  }

  // ---- IMAGE (weight ~ up to 40) ----
  if (!og('image') && !tw('image')) {
    fail('no-image', 'high', 'No image. Most platforms show no picture — the top cause of "broken-looking" links.', 40);
  } else if (image) {
    if (!image.reachable) {
      fail('image-unreachable', 'high', `Image is set but does not load (HTTP ${image.status || 'error'}). The classic post-deploy break.`, 36);
    } else if (image.width && image.height) {
      const ratio = image.width / image.height;
      const tooSmall = image.width < 600 || image.height < 315;
      const wrongShape = ratio < 1.5 || ratio > 2.3;
      // A small AND wrong-shaped image is a logo/banner misused as a preview — severe.
      if (tooSmall && wrongShape) {
        fail('image-misused', 'high', `Image is ${image.width}×${image.height} (ratio ${ratio.toFixed(1)}:1) — that's a logo or banner, not a preview image. It will look stretched, tiny, or broken. Use ~1200×630.`, 34);
      } else if (tooSmall) {
        fail('image-small', 'medium', `Image is ${image.width}×${image.height}. Recommended is 1200×630 — smaller images look blurry or get cropped.`, 18);
      } else if (wrongShape) {
        fail('image-ratio', 'medium', `Aspect ratio ${ratio.toFixed(1)}:1 is well off the ideal ~1.91:1, so it will be cropped awkwardly.`, 12);
      }
    }
  }

  // ---- TWITTER CARD (weight ~ up to 8) ----
  if (!tw('card')) {
    fail('no-twitter-card', 'low', 'No twitter:card. X may show a small thumbnail instead of a large preview.', 6);
  } else if (tw('card') !== 'summary_large_image' && (og('image') || tw('image'))) {
    fail('twitter-card-small', 'low', 'twitter:card is not "summary_large_image", so your image shows small on X.', 5);
  }

  // ---- MINOR META (small weights) ----
  if (!og('url')) fail('no-url', 'low', 'No og:url — platforms guess the canonical link, sometimes wrongly.', 2);
  if (!og('site_name')) fail('no-site-name', 'low', 'No og:site_name — your brand name will not appear on the card.', 2);

  score = Math.max(0, Math.min(100, Math.round(score)));
  // grade thresholds aligned to the new model
  const grade =
    score >= 88 ? 'great' : score >= 70 ? 'good' : score >= 45 ? 'poor' : 'broken';

  return { score, grade, issues };
}

// ---- what each platform would actually display -----------------------------
function buildPreviews(tags, image, finalUrl) {
  const title = tags['og:title'] || tags.htmlTitle || null;
  const desc = tags['og:description'] || tags.description || null;
  const img = (image && image.reachable && image.url) || null;
  const host = (() => { try { return new URL(finalUrl).hostname; } catch { return null; } })();
  const card = tags['twitter:card'] || null;

  return {
    twitter: {
      style: card === 'summary_large_image' ? 'large-image' : 'thumbnail',
      title, description: desc, image: img, domain: host,
    },
    linkedin: { title, description: desc, image: img, domain: host },
    slack: { title, description: desc, image: img, domain: host },
    facebook: { title, description: desc, image: img, domain: host },
  };
}

// ---- the one function everything else calls --------------------------------
async function checkUrl(inputUrl) {
  const fetchedAt = new Date().toISOString();
  let url = inputUrl.trim();
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url; // be forgiving

  let page;
  try {
    page = await rawGet(url);
  } catch (err) {
    return {
      url, finalUrl: url, fetchedAt, ok: false, score: 0, grade: 'broken',
      tags: {}, image: null,
      issues: [{ id: 'fetch-failed', severity: 'high', message: `Could not load the page (${err.message}).` }],
      previews: null,
    };
  }

  if (page.status >= 400) {
    return {
      url, finalUrl: page.finalUrl, fetchedAt, ok: false, score: 0, grade: 'broken',
      tags: {}, image: null,
      issues: [{ id: 'http-error', severity: 'high', message: `Page returned HTTP ${page.status}.` }],
      previews: null,
    };
  }

  const tags = parseTags(page.body);
  const imageRef = tags['og:image'] || tags['twitter:image'];
  const image = imageRef ? await readImageMeta(imageRef, page.finalUrl) : null;
  const { score, grade, issues } = evaluate(tags, image, page.finalUrl);
  const previews = buildPreviews(tags, image, page.finalUrl);

  return {
    url, finalUrl: page.finalUrl, fetchedAt, ok: true,
    score, grade, tags, image, issues, previews,
  };
}

// ---- monitor helper: did it get worse since last time? ---------------------
// The monitor stores the previous report; this decides whether to email.
function detectRegression(previous, current) {
  if (!previous) return { changed: false, reason: null };
  const wasOk = previous.grade !== 'broken';
  const nowBroken = current.grade === 'broken';
  if (wasOk && nowBroken)
    return { changed: true, reason: 'Your link preview stopped working.' };
  // image specifically went from loading to not loading
  const imgWas = previous.image && previous.image.reachable;
  const imgNow = current.image && current.image.reachable;
  if (imgWas && !imgNow)
    return { changed: true, reason: 'Your preview image no longer loads.' };
  // meaningful score drop
  if (current.score <= previous.score - 25)
    return { changed: true, reason: `Preview health dropped from ${previous.score} to ${current.score}.` };
  return { changed: false, reason: null };
}

module.exports = { checkUrl, detectRegression };
