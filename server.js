/**
 * unfurl.pro — Aurora landing page + live link preview checker.
 * The hero browser is a REAL checker: type a URL, it calls /api/check,
 * and fills the window with the live score, preview cards, and issues.
 * Zero dependencies. Run:  node server.js  ->  http://localhost:3000
 */
const http = require('http');
const https = require('https');
const fs = require('fs');
const { checkUrl } = require('./checker');

const PORT = process.env.PORT || 3000;

// Load the static OG preview image once at startup (served at /og.png).
let OG_IMAGE = null;
try { OG_IMAGE = fs.readFileSync(__dirname + '/og.png'); } catch (e) { OG_IMAGE = null; }

// Supabase config — secret key comes from the environment, never hardcoded.
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://qgwfeeggzookkyvnefcn.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || '';

// Resend config — API key from the environment.
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const ALERT_FROM = 'Unfurl Alerts <alerts@unfurl.pro>';

// Save a signup row to Supabase via its REST API (no external libraries).
function saveSignup(record) {
  return new Promise((resolve, reject) => {
    if (!SUPABASE_KEY) return reject(new Error('no-key'));
    const body = JSON.stringify(record);
    const u = new URL(SUPABASE_URL + '/rest/v1/signups');
    const req = https.request(
      u,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: SUPABASE_KEY,
          Authorization: 'Bearer ' + SUPABASE_KEY,
          Prefer: 'return=minimal',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (r) => {
        let d = '';
        r.on('data', (c) => (d += c));
        r.on('end', () => {
          if (r.statusCode >= 200 && r.statusCode < 300) resolve(true);
          else reject(new Error('supabase-' + r.statusCode + ':' + d));
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(8000, () => req.destroy(new Error('timeout')));
    req.end(body);
  });
}

function isEmail(s) {
  return typeof s === 'string' && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s.trim());
}

// Mark all rows for an email as unsubscribed (PATCH via Supabase REST).
function unsubscribeEmail(email) {
  return new Promise((resolve, reject) => {
    if (!SUPABASE_KEY) return reject(new Error('no-key'));
    const body = JSON.stringify({ unsubscribed: true });
    const u = new URL(SUPABASE_URL + '/rest/v1/signups?email=eq.' + encodeURIComponent(email));
    const req = https.request(
      u,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          apikey: SUPABASE_KEY,
          Authorization: 'Bearer ' + SUPABASE_KEY,
          Prefer: 'return=minimal',
          'Content-Length': Buffer.byteLength(body),
        },
      },
      (r) => {
        let d = '';
        r.on('data', (c) => (d += c));
        r.on('end', () => {
          if (r.statusCode >= 200 && r.statusCode < 300) resolve(true);
          else reject(new Error('supabase-' + r.statusCode + ':' + d));
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(8000, () => req.destroy(new Error('timeout')));
    req.end(body);
  });
}

function esc(s){ if(s==null)return ''; return String(s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); }

// --- Monitor engine -------------------------------------------------------

// Fetch all active monitor rows (kind=monitor, not unsubscribed, has a url).
function fetchMonitors() {
  return new Promise((resolve, reject) => {
    if (!SUPABASE_KEY) return reject(new Error('no-key'));
    const u = new URL(SUPABASE_URL + '/rest/v1/signups?kind=eq.monitor&unsubscribed=eq.false&url=not.is.null&select=*');
    https.get(u, {
      headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY },
    }, (r) => {
      let d = '';
      r.on('data', (c) => (d += c));
      r.on('end', () => {
        if (r.statusCode >= 200 && r.statusCode < 300) {
          try { resolve(JSON.parse(d)); } catch { reject(new Error('bad-json')); }
        } else reject(new Error('supabase-' + r.statusCode + ':' + d));
      });
    }).on('error', reject);
  });
}

// Update one monitor row's stored state by id.
function updateMonitorRow(id, fields) {
  return new Promise((resolve, reject) => {
    if (!SUPABASE_KEY) return reject(new Error('no-key'));
    const body = JSON.stringify(fields);
    const u = new URL(SUPABASE_URL + '/rest/v1/signups?id=eq.' + encodeURIComponent(id));
    const req = https.request(u, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_KEY,
        Authorization: 'Bearer ' + SUPABASE_KEY,
        Prefer: 'return=minimal',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (r) => {
      let d = ''; r.on('data', (c) => (d += c));
      r.on('end', () => {
        if (r.statusCode >= 200 && r.statusCode < 300) resolve(true);
        else reject(new Error('supabase-' + r.statusCode + ':' + d));
      });
    });
    req.on('error', reject);
    req.setTimeout(8000, () => req.destroy(new Error('timeout')));
    req.end(body);
  });
}

// Decide whether a link has regressed since last check.
// Returns { broke, recovered } booleans.
function judgeChange(prevGrade, prevAlerted, current) {
  const nowBroken = current.grade === 'broken' || current.grade === 'poor';
  const wasBroken = prevGrade === 'broken' || prevGrade === 'poor';
  // broke = newly bad and we haven't already alerted about it
  const broke = nowBroken && !wasBroken && !prevAlerted;
  // recovered = was bad (and alerted), now healthy again -> clear the alert flag
  const recovered = !nowBroken && prevAlerted;
  return { broke, recovered };
}

// Send an email via Resend's API (no external libraries).
function sendEmail({ to, subject, html, text }) {
  return new Promise((resolve, reject) => {
    if (!RESEND_API_KEY) return reject(new Error('no-resend-key'));
    const body = JSON.stringify({ from: ALERT_FROM, to: [to], subject, html, text });
    const req = https.request('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + RESEND_API_KEY,
        'Content-Length': Buffer.byteLength(body),
      },
    }, (r) => {
      let d = ''; r.on('data', (c) => (d += c));
      r.on('end', () => {
        if (r.statusCode >= 200 && r.statusCode < 300) resolve(true);
        else reject(new Error('resend-' + r.statusCode + ':' + d));
      });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => req.destroy(new Error('timeout')));
    req.end(body);
  });
}

// Sends the "your link broke" alert email to a monitor subscriber.
async function sendBreakAlert(row, report) {
  const url = row.url;
  const score = report.score == null ? '—' : report.score;
  const topIssues = (report.issues || []).slice(0, 3)
    .map((i) => '<li style="margin-bottom:6px;color:#475569">' + esc(i.message) + '</li>').join('');
  const unsubLink = 'https://unfurl.pro/unsubscribe?email=' + encodeURIComponent(row.email);
  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;margin:0 auto;padding:8px">
    <div style="font-family:'JetBrains Mono',monospace;font-weight:700;font-size:18px;color:#0B1120;margin-bottom:20px">unfurl<span style="color:#22D3EE">.pro</span></div>
    <h1 style="font-size:20px;color:#0B1120;margin:0 0 8px">Heads up — a link you're watching looks broken</h1>
    <p style="color:#475569;font-size:15px;line-height:1.6;margin:0 0 16px">We re-checked <b>${esc(url)}</b> and its preview is no longer rendering the way it should. Here's what we found (health score: <b>${score}/100</b>):</p>
    <ul style="padding-left:18px;font-size:14px;margin:0 0 20px">${topIssues || '<li style="color:#475569">The preview failed our checks.</li>'}</ul>
    <a href="https://unfurl.pro" style="display:inline-block;background:#22D3EE;color:#04141A;font-weight:600;text-decoration:none;padding:11px 20px;border-radius:9px;font-size:14px">Re-check it on Unfurl →</a>
    <p style="color:#94A3B8;font-size:12px;line-height:1.5;margin:28px 0 0;border-top:1px solid #E2E8F0;padding-top:16px">You're getting this because you asked Unfurl to watch this link. <a href="${unsubLink}" style="color:#64748B">Unsubscribe</a> anytime.</p>
  </div>`;
  const text = `A link you're watching looks broken.\n\n${url} — health score ${score}/100.\n\nRe-check it at https://unfurl.pro\n\nUnsubscribe: ${unsubLink}`;
  await sendEmail({ to: row.email, subject: `⚠ Your link preview looks broken — ${url}`, html, text });
  return true;
}

// The core run: re-check every monitored link, decide who to alert.
// sendFn(row, report) is injected so we can test without real email.
async function runMonitorCheck(sendFn) {
  const rows = await fetchMonitors();
  const summary = { checked: 0, alerted: 0, recovered: 0, errors: 0 };
  for (const row of rows) {
    try {
      const report = await checkUrl(row.url);
      summary.checked++;
      const { broke, recovered } = judgeChange(row.last_grade, row.alerted, report);
      if (broke) {
        await sendFn(row, report);
        summary.alerted++;
        await updateMonitorRow(row.id, {
          last_score: report.score, last_grade: report.grade,
          last_checked_at: new Date().toISOString(), alerted: true,
        });
      } else if (recovered) {
        summary.recovered++;
        await updateMonitorRow(row.id, {
          last_score: report.score, last_grade: report.grade,
          last_checked_at: new Date().toISOString(), alerted: false,
        });
      } else {
        await updateMonitorRow(row.id, {
          last_score: report.score, last_grade: report.grade,
          last_checked_at: new Date().toISOString(),
        });
      }
    } catch (e) {
      summary.errors++;
    }
  }
  return summary;
}

const PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Unfurl — make every shared link look right</title>
<meta name="description" content="Check, monitor, and perfect your link previews. See how your links render across X, LinkedIn, Slack and more — and get alerted if a preview ever breaks.">
<link rel="canonical" href="https://unfurl.pro/">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Unfurl">
<meta property="og:url" content="https://unfurl.pro/">
<meta property="og:title" content="Unfurl — make every shared link look right">
<meta property="og:description" content="Check, monitor, and perfect your link previews. See how your links render across X, LinkedIn, Slack and more — and get alerted if a preview ever breaks.">
<meta property="og:image" content="https://unfurl.pro/og.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="Unfurl — make every shared link look right">
<meta name="twitter:description" content="Check, monitor, and perfect your link previews — and get alerted if one ever breaks.">
<meta name="twitter:image" content="https://unfurl.pro/og.png">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 48 56'%3E%3Cdefs%3E%3ClinearGradient id='g' x1='0' y1='8' x2='44' y2='48' gradientUnits='userSpaceOnUse'%3E%3Cstop stop-color='%235EEAD4'/%3E%3Cstop offset='1' stop-color='%2322D3EE'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect x='4' y='8' width='40' height='40' rx='9' fill='%230B1120' stroke='url(%23g)' stroke-width='2.5'/%3E%3Ccircle cx='15' cy='15' r='2' fill='url(%23g)'/%3E%3Cline x1='15' y1='16' x2='15' y2='41' stroke='url(%23g)' stroke-width='2.6' stroke-linecap='round'/%3E%3Cpath d='M15 18 H33 q5 5 0 9 q-5 4 0 8 H15 Z' fill='url(%23g)'/%3E%3C/svg%3E">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;700&family=Instrument+Serif:ital@0;1&display=swap" rel="stylesheet">
<style>
:root{
  --bg:#05080F;--bg2:#080D18;--panel:#0C1322;--line:#1B2436;--line2:#263149;
  --text:#EAF0F7;--muted:#93A1B5;--dim:#5C6A80;
  --accent:#22D3EE;--accent2:#5EEAD4;--accent3:#3B82F6;
}
*{margin:0;padding:0;box-sizing:border-box}
html{scroll-behavior:smooth}
body{background:var(--bg);color:var(--text);font-family:'Space Grotesk',sans-serif;line-height:1.6;overflow-x:hidden;-webkit-font-smoothing:antialiased}
a{color:inherit;text-decoration:none}
.wrap{max-width:1140px;margin:0 auto;padding:0 28px}
.mono{font-family:'JetBrains Mono',monospace}

.aurora{position:fixed;inset:0;z-index:0;pointer-events:none;overflow:hidden}
.aurora::before,.aurora::after{content:'';position:absolute;border-radius:50%;filter:blur(90px);opacity:.5}
.aurora::before{width:760px;height:760px;top:-340px;left:50%;transform:translateX(-60%);background:radial-gradient(circle,#22D3EE55,transparent 60%)}
.aurora::after{width:620px;height:620px;top:-220px;right:-160px;background:radial-gradient(circle,#3B82F644,transparent 60%)}
.aurora .blob3{position:absolute;width:520px;height:520px;border-radius:50%;filter:blur(100px);opacity:.35;background:radial-gradient(circle,#5EEAD433,transparent 60%);top:120px;left:-180px}
.grid{position:fixed;inset:0;z-index:0;pointer-events:none;background-image:linear-gradient(var(--line) 1px,transparent 1px),linear-gradient(90deg,var(--line) 1px,transparent 1px);background-size:60px 60px;opacity:.18;mask-image:radial-gradient(ellipse 75% 55% at 50% 0%,#000 25%,transparent 72%)}
.noise{position:fixed;inset:0;z-index:1;pointer-events:none;opacity:.025;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")}

nav{position:relative;z-index:10;display:flex;align-items:center;justify-content:space-between;padding:24px 28px;max-width:1140px;margin:0 auto}
nav .links{display:flex;gap:30px;align-items:center}
nav .links a{color:var(--muted);font-size:14px;font-weight:500;transition:color .2s}
nav .links a:hover{color:var(--text)}
.btn{background:linear-gradient(135deg,var(--accent2),var(--accent));color:#04141A;font-weight:600;padding:11px 20px;border-radius:11px;font-size:14px;border:none;cursor:pointer;transition:transform .15s,box-shadow .25s;display:inline-block}
.btn:hover{transform:translateY(-2px);box-shadow:0 10px 36px rgba(34,211,238,.4)}
.btn:disabled{opacity:.7;cursor:wait;transform:none}
.btn-ghost{background:rgba(255,255,255,.03);border:1px solid var(--line2);color:var(--text);font-weight:500;backdrop-filter:blur(8px)}
.btn-ghost:hover{border-color:var(--accent);box-shadow:none}

header{position:relative;z-index:5;text-align:center;padding:80px 0 40px}
.badge{display:inline-flex;align-items:center;gap:9px;border:1px solid var(--line2);background:rgba(255,255,255,.02);border-radius:100px;padding:7px 16px;font-size:13px;color:var(--muted);margin-bottom:34px;font-family:'JetBrains Mono',monospace;backdrop-filter:blur(8px)}
.badge .dot{width:7px;height:7px;border-radius:50%;background:var(--accent2);box-shadow:0 0 12px var(--accent2);animation:pulse 2.4s ease-in-out infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
h1{font-size:clamp(44px,7.5vw,82px);line-height:1;font-weight:700;letter-spacing:-3px;margin-bottom:26px}
h1 .serif{font-family:'Instrument Serif',serif;font-style:italic;font-weight:400;letter-spacing:-1px;background:linear-gradient(135deg,var(--accent2),var(--accent) 60%,var(--accent3));-webkit-background-clip:text;background-clip:text;color:transparent}
.sub{font-size:clamp(17px,2.2vw,21px);color:var(--muted);max-width:600px;margin:0 auto 40px;line-height:1.55}
.hero-cta{display:flex;gap:14px;justify-content:center;flex-wrap:wrap}
.hero-note{margin-top:20px;font-size:13px;color:var(--dim);font-family:'JetBrains Mono',monospace}

/* SIGNATURE: live checker browser */
.showcase{position:relative;z-index:5;max-width:920px;margin:60px auto 0;perspective:1800px}
.checker-input-row{display:flex;gap:12px;max-width:620px;margin:0 auto 30px;flex-wrap:wrap;scroll-margin-top:90px}
@keyframes nudge{0%,100%{box-shadow:0 0 0 0 rgba(34,211,238,0)}50%{box-shadow:0 0 0 4px rgba(34,211,238,.25)}}
.checker-input-row.highlight input{animation:nudge 1.1s ease-in-out 2}
.checker-input-row input{flex:1;min-width:260px;background:rgba(12,19,34,.8);border:1px solid var(--line2);border-radius:12px;padding:15px 18px;color:var(--text);font-family:'JetBrains Mono',monospace;font-size:14.5px;outline:none;transition:border-color .2s;backdrop-filter:blur(8px)}
.checker-input-row input:focus{border-color:var(--accent)}
.browser{background:var(--panel);border:1px solid var(--line2);border-radius:16px;overflow:hidden;box-shadow:0 50px 120px -20px rgba(0,0,0,.8),0 0 0 1px rgba(34,211,238,.08),0 0 80px -30px rgba(34,211,238,.3);transform:rotateX(5deg);transform-style:preserve-3d;transition:transform .5s}
.browser.resting{animation:float 7s ease-in-out infinite}
@keyframes float{0%,100%{transform:rotateX(5deg) translateY(0)}50%{transform:rotateX(5deg) translateY(-10px)}}
.browser.active{transform:rotateX(0deg);animation:none}
.browser-bar{display:flex;align-items:center;gap:8px;padding:15px 18px;background:#0A0F1C;border-bottom:1px solid var(--line)}
.browser-bar .c{width:12px;height:12px;border-radius:50%}
.c1{background:#FF5F57}.c2{background:#FEBC2E}.c3{background:#28C840}
.browser-bar .addr{margin-left:14px;flex:1;background:#070B14;border:1px solid var(--line);border-radius:8px;padding:7px 14px;font-family:'JetBrains Mono',monospace;font-size:12.5px;color:var(--muted);display:flex;align-items:center;gap:8px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.browser-bar .addr svg{opacity:.6;flex-shrink:0}
.browser-body{padding:34px;min-height:280px}

/* default (resting) two-column hero state */
.bb-grid{display:grid;grid-template-columns:1.05fr .95fr;gap:28px;align-items:center}
.bb-left .score-ring{width:96px;height:96px;margin-bottom:18px}
.bb-left h3{font-size:22px;font-weight:600;letter-spacing:-.5px;margin-bottom:8px}
.bb-left p{font-size:14px;color:var(--muted);margin-bottom:16px}
.bb-checks{display:flex;flex-direction:column;gap:9px}
.bb-check{display:flex;align-items:center;gap:9px;font-size:13px;color:var(--muted)}
.bb-check svg{flex-shrink:0}
.bb-right{background:#070B14;border:1px solid var(--line);border-radius:13px;overflow:hidden}
.bb-right .pv-img{aspect-ratio:1.91/1;background:linear-gradient(135deg,#0B2530,#10283A 60%,#0E1E3A);display:flex;align-items:center;justify-content:center;position:relative;overflow:hidden}
.bb-right .pv-img img{width:100%;height:100%;object-fit:cover;display:block}
.bb-right .pv-img .glow-orb{position:absolute;width:120px;height:120px;border-radius:50%;background:radial-gradient(circle,#22D3EE66,transparent 70%);filter:blur(8px)}
.bb-right .pv-img .fg{position:relative;z-index:2;font-family:'JetBrains Mono',monospace;font-weight:700;font-size:26px;letter-spacing:-1px;color:#EAF0F7}
.bb-right .pv-img .fg b{color:var(--accent)}
.bb-right .pv-img.missing{flex-direction:column;gap:6px;color:var(--dim);font-size:13px;text-align:center;padding:16px}
.bb-right .pv-meta{padding:14px 16px}
.bb-right .pv-meta .site{font-family:'JetBrains Mono',monospace;font-size:10.5px;text-transform:uppercase;letter-spacing:.6px;color:var(--dim)}
.bb-right .pv-meta .t{font-size:14.5px;font-weight:600;margin:4px 0}
.bb-right .pv-meta .d{font-size:12.5px;color:var(--muted)}
.showcase-reflect{position:absolute;bottom:-60px;left:10%;right:10%;height:120px;background:radial-gradient(ellipse at center,rgba(34,211,238,.12),transparent 70%);filter:blur(20px);z-index:-1}

/* result state inside browser */
.res-head{display:flex;flex-direction:column;align-items:center;text-align:center;gap:0;margin-bottom:20px}
.res-ring{width:88px;height:88px;flex-shrink:0;margin-bottom:14px}
.res-head .grade{font-family:'JetBrains Mono',monospace;font-size:12px;text-transform:uppercase;letter-spacing:1.5px;color:var(--muted)}
.res-head .headline{font-size:21px;font-weight:600;letter-spacing:-.3px;margin-top:4px}
.res-head .url{font-size:12px;color:var(--dim);font-family:'JetBrains Mono',monospace;margin-top:5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%}
.cards{display:grid;grid-template-columns:1fr 1fr;gap:13px;margin:18px 0 6px}
.pcard{background:#070B14;border:1px solid var(--line);border-radius:11px;overflow:hidden;text-align:left}
.pcard .platform{display:flex;align-items:center;gap:7px;font-size:10.5px;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);padding:10px 12px 8px;font-weight:600}
.pcard .platform svg{flex-shrink:0;opacity:.95}
.pcard .pimg{width:100%;aspect-ratio:1.91/1;background:#0a1622;display:flex;align-items:center;justify-content:center;border-bottom:1px solid var(--line);overflow:hidden}
.pcard .pimg img{width:100%;height:100%;object-fit:cover;display:block}
.pcard .pimg.missing{flex-direction:column;gap:5px;color:var(--dim);font-size:11px;text-align:center;padding:12px}
.pcard .pmeta{padding:9px 12px}
.pcard .pdomain{font-size:10.5px;color:var(--dim)}
.pcard .ptitle{font-size:13px;font-weight:600;margin:2px 0;color:var(--text);overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.pcard .pdesc{font-size:11.5px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.issues{margin:0 auto 4px;text-align:left;max-width:600px}
.issue{background:#070B14;border:1px solid var(--line);border-left:3px solid var(--dim);border-radius:9px;padding:11px 14px;margin-top:9px;font-size:13px;color:var(--muted)}
.issue.high{border-left-color:#FF6B6B}.issue.medium{border-left-color:#FBBF24}.issue.low{border-left-color:var(--accent)}.issue.info{border-left-color:var(--accent2)}
.issue .sev{font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:var(--dim);margin-bottom:3px}
.blocked-wrap{text-align:center;padding:10px 0}
.blocked-wrap .em{font-size:40px;margin-bottom:10px}
.blocked-wrap .bt{font-size:18px;font-weight:600;margin-bottom:8px}
.blocked-wrap .bd{font-size:13.5px;color:var(--muted);max-width:440px;margin:0 auto}
.monitor{margin-top:18px;padding:18px 18px 15px;background:linear-gradient(135deg,rgba(94,234,212,.07),rgba(34,211,238,.03));border:1px solid var(--line2);border-radius:13px;text-align:left}
.monitor .m-head{display:flex;align-items:center;gap:9px;margin-bottom:6px}
.monitor .m-head svg{flex-shrink:0}
.monitor .m-head b{font-size:14.5px;color:var(--text);font-weight:600}
.monitor .m-sub{font-size:13px;color:var(--muted);margin-bottom:13px}
.monitor .m-form{display:flex;gap:9px;flex-wrap:wrap}
.monitor .m-form input{flex:1;min-width:200px;background:rgba(0,0,0,.3);border:1px solid var(--line2);border-radius:9px;padding:11px 14px;color:var(--text);font-family:'JetBrains Mono',monospace;font-size:13px;outline:none;transition:border-color .2s}
.monitor .m-form input:focus{border-color:var(--accent)}
.monitor .m-form .btn{padding:11px 18px;white-space:nowrap}
.monitor .m-note{font-size:10.5px;color:var(--dim);margin-top:9px;font-family:'JetBrains Mono',monospace}
.monitor .m-success{color:var(--accent2);font-family:'JetBrains Mono',monospace;font-size:13px;display:none}
.monitor .m-error{color:#FF8585;font-family:'JetBrains Mono',monospace;font-size:13px;display:none;margin-bottom:2px}
.form-error{color:#FF8585;font-family:'JetBrains Mono',monospace;font-size:13px;margin-top:14px;display:none}
.spinner{width:15px;height:15px;border:2px solid rgba(4,20,26,.35);border-top-color:#04141A;border-radius:50%;animation:spin .6s linear infinite;display:inline-block;vertical-align:-2px;margin-right:8px}
@keyframes spin{to{transform:rotate(360deg)}}
.fade{animation:fadeIn .5s cubic-bezier(.16,.8,.3,1) both}
@keyframes fadeIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}

.trust{position:relative;z-index:5;text-align:center;padding:70px 0 20px}
section{position:relative;z-index:5;padding:90px 0}
.eyebrow{font-family:'JetBrains Mono',monospace;font-size:13px;color:var(--accent);letter-spacing:1.5px;text-transform:uppercase;margin-bottom:16px;text-align:center}
.eyebrow.left{text-align:left}
.sec-title{font-size:clamp(30px,4.5vw,48px);font-weight:700;letter-spacing:-1.5px;text-align:center;margin-bottom:18px;line-height:1.08}
.sec-title .serif{font-family:'Instrument Serif',serif;font-style:italic;font-weight:400;color:var(--accent2)}
.sec-sub{color:var(--muted);text-align:center;max-width:560px;margin:0 auto 60px;font-size:16px}

.steps{display:grid;grid-template-columns:repeat(3,1fr);gap:22px}
.step{background:linear-gradient(180deg,rgba(255,255,255,.025),transparent);border:1px solid var(--line);border-radius:18px;padding:32px;position:relative;transition:transform .25s,border-color .25s;overflow:hidden}
.step::before{content:'';position:absolute;top:0;left:0;right:0;height:1px;background:linear-gradient(90deg,transparent,var(--accent2),transparent);opacity:0;transition:opacity .3s}
.step:hover{transform:translateY(-5px);border-color:var(--line2)}
.step:hover::before{opacity:.6}
.step .num{font-family:'JetBrains Mono',monospace;font-size:13px;color:var(--accent);border:1px solid var(--line2);border-radius:9px;width:36px;height:36px;display:flex;align-items:center;justify-content:center;margin-bottom:20px;background:rgba(34,211,238,.05)}
.step .free{position:absolute;top:30px;right:30px;font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--accent2);border:1px solid var(--accent2);border-radius:100px;padding:3px 10px}
.step h3{font-size:20px;font-weight:600;margin-bottom:10px;letter-spacing:-.3px}
.step p{color:var(--muted);font-size:14.5px}

.code-showcase{display:grid;grid-template-columns:1fr 1fr;gap:50px;align-items:center;max-width:1040px;margin:0 auto}
.code-showcase .copy h2{font-size:clamp(26px,3.5vw,38px);font-weight:700;letter-spacing:-1px;line-height:1.1;margin-bottom:18px}
.code-showcase .copy h2 .serif{font-family:'Instrument Serif',serif;font-style:italic;font-weight:400;color:var(--accent2)}
.code-showcase .copy p{color:var(--muted);font-size:15.5px;margin-bottom:20px}
.code-showcase .copy .feat-list{display:flex;flex-direction:column;gap:12px}
.code-showcase .copy .feat-list div{display:flex;gap:11px;align-items:flex-start;font-size:14.5px;color:var(--muted)}
.code-showcase .copy .feat-list svg{flex-shrink:0;margin-top:3px}
.terminal{background:#070B14;border:1px solid var(--line2);border-radius:15px;overflow:hidden;box-shadow:0 30px 70px -20px rgba(0,0,0,.7),0 0 60px -30px rgba(34,211,238,.25)}
.term-bar{display:flex;align-items:center;gap:8px;padding:14px 18px;border-bottom:1px solid var(--line);background:#0A0F1C}
.term-bar .label{margin-left:auto;font-family:'JetBrains Mono',monospace;font-size:12px;color:var(--dim)}
.term-body{padding:24px;font-family:'JetBrains Mono',monospace;font-size:13.5px;line-height:1.9;overflow-x:auto}
.term-body .cm{color:var(--dim)}.term-body .fn{color:var(--accent2)}.term-body .str{color:#A5F3C0}.term-body .key{color:var(--accent)}

.prices{display:grid;grid-template-columns:repeat(3,1fr);gap:22px;max-width:940px;margin:0 auto}
.price{background:linear-gradient(180deg,rgba(255,255,255,.025),transparent);border:1px solid var(--line);border-radius:20px;padding:36px 30px;position:relative;display:flex;flex-direction:column}
.price.feat{border-color:var(--accent);box-shadow:0 0 60px -20px rgba(34,211,238,.4)}
.price .tag{position:absolute;top:-12px;left:50%;transform:translateX(-50%);background:linear-gradient(135deg,var(--accent2),var(--accent));color:#04141A;font-size:11px;font-weight:700;padding:5px 15px;border-radius:100px;font-family:'JetBrains Mono',monospace}
.price.soon{opacity:.72}
.price .soon-tag{position:absolute;top:-12px;left:50%;transform:translateX(-50%);background:var(--panel);border:1px solid var(--line2);color:var(--muted);font-size:11px;font-weight:600;padding:5px 15px;border-radius:100px;font-family:'JetBrains Mono',monospace}
.price.soon .amt{color:var(--muted)}
.price .name{font-family:'JetBrains Mono',monospace;color:var(--muted);font-size:14px;margin-bottom:12px}
.price .amt{font-size:46px;font-weight:700;letter-spacing:-2px}
.price .amt span{font-size:15px;color:var(--dim);font-weight:400;letter-spacing:0}
.price ul{list-style:none;margin:26px 0 30px;display:flex;flex-direction:column;gap:13px}
.price li{font-size:14px;color:var(--muted);display:flex;gap:10px;align-items:flex-start}
.price li svg{flex-shrink:0;margin-top:3px}
.price .btn{width:100%;text-align:center;margin-top:auto}

.waitlist{position:relative;background:linear-gradient(135deg,rgba(34,211,238,.08),rgba(59,130,246,.05));border:1px solid var(--line2);border-radius:26px;padding:64px 44px;text-align:center;max-width:720px;margin:0 auto;overflow:hidden}
.waitlist::before{content:'';position:absolute;top:-100px;left:50%;transform:translateX(-50%);width:400px;height:300px;background:radial-gradient(circle,rgba(34,211,238,.2),transparent 65%);filter:blur(30px)}
.waitlist h2{position:relative;font-size:clamp(28px,4vw,42px);font-weight:700;letter-spacing:-1.5px;margin-bottom:16px}
.waitlist h2 .serif{font-family:'Instrument Serif',serif;font-style:italic;font-weight:400;color:var(--accent2)}
.waitlist p{position:relative;color:var(--muted);margin-bottom:32px}
.form{position:relative;display:flex;gap:12px;max-width:460px;margin:0 auto;flex-wrap:wrap}
.form input{flex:1;min-width:220px;background:rgba(0,0,0,.3);border:1px solid var(--line2);border-radius:11px;padding:14px 16px;color:var(--text);font-family:'JetBrains Mono',monospace;font-size:14px;outline:none;transition:border-color .2s}
.form input:focus{border-color:var(--accent)}
.success{position:relative;color:var(--accent2);font-family:'JetBrains Mono',monospace;font-size:14px;margin-top:20px;display:none}

footer{position:relative;z-index:5;border-top:1px solid var(--line);padding:40px 0;margin-top:50px}
footer .wrap{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:16px}
footer .muted{color:var(--dim);font-size:13px;font-family:'JetBrains Mono',monospace}

.reveal{opacity:0;transform:translateY(20px);animation:rise .8s cubic-bezier(.16,.8,.3,1) forwards}
@keyframes rise{to{opacity:1;transform:translateY(0)}}
.d1{animation-delay:.05s}.d2{animation-delay:.15s}.d3{animation-delay:.28s}.d4{animation-delay:.42s}.d5{animation-delay:.56s}

@media(max-width:860px){.bb-grid{grid-template-columns:1fr;gap:20px}.code-showcase{grid-template-columns:1fr;gap:30px}}
@media(max-width:768px){.steps,.prices,.cards{grid-template-columns:1fr}nav .links a:not(.btn){display:none}header{padding:46px 0 30px}}
@media(prefers-reduced-motion:reduce){.reveal,.browser.resting,.badge .dot,.fade{animation:none;opacity:1;transform:none}.browser{transform:none}}
</style>
</head>
<body>
<div class="aurora"><div class="blob3"></div></div>
<div class="grid"></div>
<div class="noise"></div>

<nav>
  <a href="/" class="logo">
    <svg width="170" height="40" viewBox="0 0 240 56" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs><linearGradient id="f1" x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse"><stop stop-color="#5EEAD4"/><stop offset="1" stop-color="#22D3EE"/></linearGradient></defs>
      <rect x="4" y="8" width="40" height="40" rx="9" fill="#0B1120" stroke="url(#f1)" stroke-width="2.5"/>
      <circle cx="15" cy="15" r="2" fill="url(#f1)"/>
      <line x1="15" y1="16" x2="15" y2="41" stroke="url(#f1)" stroke-width="2.6" stroke-linecap="round"/>
      <path d="M15 18 H33 q5 5 0 9 q-5 4 0 8 H15 Z" fill="url(#f1)"/>
      <text x="56" y="36" font-family="'Space Grotesk',sans-serif" font-size="24" font-weight="700" fill="#EAF0F7" letter-spacing="-1">unfurl<tspan fill="#22D3EE">.pro</tspan></text>
    </svg>
  </a>
  <div class="links">
    <a href="#how">How it works</a>
    <a href="#api">API</a>
    <a href="#pricing">Pricing</a>
    <a href="#waitlist" class="btn">Get early access</a>
  </div>
</nav>

<header>
  <div class="wrap">
    <div class="badge reveal d1"><span class="dot"></span> The complete link-preview toolkit</div>
    <h1 class="reveal d2">Make every link<br>look <span class="serif">absolutely right.</span></h1>
    <p class="sub reveal d3">Broken link previews make great work look like spam. Unfurl turns them into previews people actually click — check, generate, and auto-maintain your images and meta tags, with zero fiddling.</p>
    <p class="hero-note reveal d4" style="margin-bottom:8px">Paste a link below — free, no signup, see how it really looks when shared.</p>
  </div>

  <div class="showcase reveal d5">
    <div class="checker-input-row" id="checker">
      <input id="url" placeholder="https://yourblog.dev/post" />
      <button id="go" class="btn" onclick="runCheck()">Check link</button>
    </div>
    <div class="showcase-reflect"></div>
    <div class="browser resting" id="browser">
      <div class="browser-bar">
        <span class="c c1"></span><span class="c c2"></span><span class="c c3"></span>
        <span class="addr" id="addr"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#5EEAD4" stroke-width="2"><path d="M12 2a10 10 0 100 20 10 10 0 000-20zM2 12h20M12 2a15 15 0 010 20 15 15 0 010-20"/></svg> unfurl.pro/check</span>
      </div>
      <div class="browser-body" id="browserBody">
        <div class="bb-grid">
          <div class="bb-left">
            <svg class="score-ring" viewBox="0 0 100 100">
              <circle cx="50" cy="50" r="42" fill="none" stroke="#1B2436" stroke-width="8"/>
              <circle cx="50" cy="50" r="42" fill="none" stroke="#5EEAD4" stroke-width="8" stroke-linecap="round" stroke-dasharray="264" stroke-dashoffset="26" transform="rotate(-90 50 50)"/>
              <text x="50" y="58" text-anchor="middle" font-family="JetBrains Mono,monospace" font-size="26" font-weight="700" fill="#EAF0F7">92</text>
            </svg>
            <h3>Looking sharp.</h3>
            <p>This is a sample. Paste your own link above to check it live.</p>
            <div class="bb-checks">
              <div class="bb-check"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#5EEAD4" stroke-width="2.5"><path d="M20 6L9 17l-5-5"/></svg> og:image present &amp; 1200×630</div>
              <div class="bb-check"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#5EEAD4" stroke-width="2.5"><path d="M20 6L9 17l-5-5"/></svg> twitter:card large image</div>
              <div class="bb-check"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#5EEAD4" stroke-width="2.5"><path d="M20 6L9 17l-5-5"/></svg> title &amp; description set</div>
            </div>
          </div>
          <div class="bb-right">
            <div class="pv-img"><div class="glow-orb"></div><div class="fg">un<b>furl</b></div></div>
            <div class="pv-meta">
              <div class="site">unfurl.pro</div>
              <div class="t">How we cut render time by 90%</div>
              <div class="d">A deep dive into our new edge pipeline.</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</header>

<section id="how">
  <div class="wrap">
    <p class="eyebrow">One toolkit, three steps</p>
    <h2 class="sec-title">Check it. Forge it. <span class="serif">Forget it.</span></h2>
    <p class="sec-sub">Most teams glue together four different tools for this. Unfurl is the whole pipeline.</p>
    <div class="steps">
      <div class="step"><div class="num">01</div><span class="free">FREE FOREVER</span><h3>Check</h3><p>Paste any URL and instantly see how it renders across every platform, with a health score and exactly what's broken. No signup.</p></div>
      <div class="step"><div class="num">02</div><h3>Forge</h3><p>Generate a pixel-perfect preview image with one API call. Pick a template, send your title and logo, get a cached CDN URL back.</p></div>
      <div class="step"><div class="num">03</div><h3>Sync</h3><p>Unfurl returns the complete meta-tag block and keeps it in sync automatically whenever your page changes.</p></div>
    </div>
  </div>
</section>

<section id="api" style="padding-top:30px">
  <div class="wrap">
    <div class="code-showcase">
      <div class="copy">
        <p class="eyebrow left">The forge</p>
        <h2>One call returns the image <span class="serif">and</span> the tags.</h2>
        <p>No headless browser to babysit. No meta-tag boilerplate to hand-write. Send your content, get back everything a perfect preview needs.</p>
        <div class="feat-list">
          <div><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#5EEAD4" stroke-width="2"><path d="M13 2L3 14h9l-1 8 10-12h-9z"/></svg> Edge-cached — repeat shares cost nothing</div>
          <div><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#5EEAD4" stroke-width="2"><path d="M20 6L9 17l-5-5"/></svg> SDKs for Node, Next.js &amp; Python</div>
          <div><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#5EEAD4" stroke-width="2"><path d="M12 2v20M2 12h20"/></svg> Dynamic by signed URL params</div>
        </div>
      </div>
      <div class="terminal">
        <div class="term-bar"><span class="c c1"></span><span class="c c2"></span><span class="c c3"></span><span class="label">page.tsx</span></div>
        <div class="term-body">
<span class="cm">// one call, everything you need</span><br>
<span class="key">const</span> og = <span class="key">await</span> <span class="fn">unfurl</span>.<span class="fn">forge</span>({<br>
&nbsp;&nbsp;<span class="key">template</span>: <span class="str">"minimal-dark"</span>,<br>
&nbsp;&nbsp;<span class="key">title</span>: <span class="str">"Cut render time 90%"</span>,<br>
&nbsp;&nbsp;<span class="key">logo</span>: <span class="str">"/logo.svg"</span><br>
});<br><br>
<span class="cm">// → og.image  cdn.unfurl.pro/i/a8f.png</span><br>
<span class="cm">// → og.tags   full meta block</span><br>
<span class="cm">// → og.synced auto-refreshes</span>
        </div>
      </div>
    </div>
  </div>
</section>

<section id="pricing">
  <div class="wrap">
    <p class="eyebrow">Pricing</p>
    <h2 class="sec-title">Fair, flat, <span class="serif">forgettable.</span></h2>
    <p class="sec-sub">The checker and link monitoring are free, today. Generating preview images is coming soon — join the waitlist for early access.</p>
    <div class="prices">
      <div class="price feat">
        <div class="tag">AVAILABLE NOW</div>
        <div class="name">Free</div><div class="amt">€0<span> /mo</span></div>
        <ul>
          <li><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#5EEAD4" stroke-width="2.5"><path d="M20 6L9 17l-5-5"/></svg> Unlimited link checks</li>
          <li><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#5EEAD4" stroke-width="2.5"><path d="M20 6L9 17l-5-5"/></svg> Full meta-tag health scores</li>
          <li><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#5EEAD4" stroke-width="2.5"><path d="M20 6L9 17l-5-5"/></svg> Previews across X, LinkedIn, Slack &amp; more</li>
          <li><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#5EEAD4" stroke-width="2.5"><path d="M20 6L9 17l-5-5"/></svg> Link monitoring — get alerted if a preview breaks</li>
        </ul>
        <a href="#checker" class="btn" onclick="goToChecker(event)">Try it now</a>
      </div>
      <div class="price soon">
        <div class="soon-tag">COMING SOON</div>
        <div class="name">Pro</div><div class="amt">€19<span> /mo</span></div>
        <ul>
          <li><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#5EEAD4" stroke-width="2.5"><path d="M20 6L9 17l-5-5"/></svg> Generate preview images via API</li>
          <li><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#5EEAD4" stroke-width="2.5"><path d="M20 6L9 17l-5-5"/></svg> Custom templates · your branding</li>
          <li><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#5EEAD4" stroke-width="2.5"><path d="M20 6L9 17l-5-5"/></svg> Auto meta-tag sync + SDK</li>
          <li><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#5EEAD4" stroke-width="2.5"><path d="M20 6L9 17l-5-5"/></svg> Dynamic signed URLs</li>
        </ul>
        <a href="#waitlist" class="btn btn-ghost">Join the waitlist</a>
      </div>
      <div class="price soon">
        <div class="soon-tag">COMING SOON</div>
        <div class="name">Scale</div><div class="amt">€49<span> /mo</span></div>
        <ul>
          <li><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#5EEAD4" stroke-width="2.5"><path d="M20 6L9 17l-5-5"/></svg> High-volume image generation</li>
          <li><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#5EEAD4" stroke-width="2.5"><path d="M20 6L9 17l-5-5"/></svg> Everything in Pro</li>
          <li><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#5EEAD4" stroke-width="2.5"><path d="M20 6L9 17l-5-5"/></svg> Site-wide preview audits</li>
          <li><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#5EEAD4" stroke-width="2.5"><path d="M20 6L9 17l-5-5"/></svg> Team seats &amp; priority support</li>
        </ul>
        <a href="#waitlist" class="btn btn-ghost">Join the waitlist</a>
      </div>
    </div>
  </div>
</section>

<section id="waitlist">
  <div class="wrap">
    <div class="waitlist">
      <h2>Be first <span class="serif">through the gate.</span></h2>
      <p>Drop your email for early access and lifetime launch pricing. No spam — just one note when your invite is ready.</p>
      <div class="form">
        <input type="email" id="email" placeholder="you@company.dev" aria-label="Email">
        <button class="btn" onclick="joinWaitlist()">Join waitlist</button>
      </div>
      <p class="success" id="success">✓ You're on the list. We'll be in touch soon.</p>
      <p class="form-error" id="waitError"></p>
    </div>
  </div>
</section>

<footer>
  <div class="wrap">
    <svg width="140" height="34" viewBox="0 0 240 56" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs><linearGradient id="f2" x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse"><stop stop-color="#5EEAD4"/><stop offset="1" stop-color="#22D3EE"/></linearGradient></defs>
      <rect x="4" y="8" width="40" height="40" rx="9" fill="#0B1120" stroke="url(#f2)" stroke-width="2.5"/>
      <circle cx="15" cy="15" r="2" fill="url(#f2)"/>
      <line x1="15" y1="16" x2="15" y2="41" stroke="url(#f2)" stroke-width="2.6" stroke-linecap="round"/>
      <path d="M15 18 H33 q5 5 0 9 q-5 4 0 8 H15 Z" fill="url(#f2)"/>
      <text x="56" y="36" font-family="'Space Grotesk',sans-serif" font-size="24" font-weight="700" fill="#EAF0F7" letter-spacing="-1">unfurl<tspan fill="#22D3EE">.pro</tspan></text>
    </svg>
    <span class="muted">© 2026 Unfurl · made for developers · <a href="/privacy" style="color:inherit">Privacy</a> · <a href="/unsubscribe" style="color:inherit">Unsubscribe</a></span>
  </div>
</footer>

<script>
function esc(s){if(s==null)return '';return String(s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}

var LOGOS={
  twitter:'<svg width="12" height="12" viewBox="0 0 24 24" fill="#5EEAD4"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231 5.45-6.231zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77z"/></svg>',
  linkedin:'<svg width="12" height="12" viewBox="0 0 24 24" fill="#5EEAD4"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>',
  slack:'<svg width="12" height="12" viewBox="0 0 24 24" fill="#5EEAD4"><path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z"/></svg>',
  facebook:'<svg width="12" height="12" viewBox="0 0 24 24" fill="#5EEAD4"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>'
};
var NAMES={twitter:'X / Twitter',linkedin:'LinkedIn',slack:'Slack',facebook:'Facebook'};

function badge(k){return '<div class="platform">'+(LOGOS[k]||'')+'<span>'+NAMES[k]+'</span></div>';}
function pimg(p){
  if(p&&p.image){return '<div class="pimg"><img src="'+esc(p.image)+'" alt="" onerror="this.parentNode.innerHTML=\\'<span style=&quot;color:#FF8585;font-size:11px&quot;>⚠ image failed</span>\\'"></div>';}
  return '<div class="pimg missing"><span>no image</span></div>';
}
function pcard(k,p){
  if(!p)return '';
  return '<div class="pcard">'+badge(k)+pimg(p)+'<div class="pmeta"><div class="ptitle">'+esc(p.title||'(no title)')+'</div><div class="pdesc">'+esc(p.description||'')+'</div><div class="pdomain">'+esc(p.domain||'')+'</div></div></div>';
}

function ringColor(s){return s>=75?'#5EEAD4':s>=45?'#FBBF24':'#FF6B6B';}

function goToChecker(e){
  if(e)e.preventDefault();
  var el=document.getElementById('checker');
  if(!el)return;
  el.scrollIntoView({behavior:'smooth',block:'center'});
  el.classList.remove('highlight');
  void el.offsetWidth; // restart animation
  el.classList.add('highlight');
  var input=document.getElementById('url');
  if(input){ setTimeout(function(){ input.focus(); }, 500); }
}
function runCheck(){
  var btn=document.getElementById('go'),body=document.getElementById('browserBody'),browser=document.getElementById('browser'),addr=document.getElementById('addr');
  var url=document.getElementById('url').value.trim();
  if(!url)return;
  btn.disabled=true;btn.innerHTML='<span class="spinner"></span>Checking';
  browser.classList.remove('resting');browser.classList.add('active');
  addr.innerHTML='<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#5EEAD4" stroke-width="2"><path d="M12 2a10 10 0 100 20 10 10 0 000-20zM2 12h20"/></svg> '+esc(url);
  body.innerHTML='<div style="text-align:center;color:var(--muted);padding:60px 0;font-family:JetBrains Mono,monospace;font-size:14px"><span class="spinner" style="border-top-color:#5EEAD4;border-color:rgba(94,234,212,.3);border-top-color:#5EEAD4"></span> forging your preview…</div>';
  fetch('/api/check?url='+encodeURIComponent(url)).then(function(r){return r.json();}).then(function(res){
    renderResult(res);
  }).catch(function(){
    body.innerHTML='<div class="blocked-wrap fade"><div class="em">😵</div><div class="bt">Something went sideways</div><div class="bd">We couldn\\'t complete that check. Give it another go in a moment.</div></div>';
  }).finally(function(){
    btn.disabled=false;btn.textContent='Check link';
  });
}

function renderResult(r){
  var body=document.getElementById('browserBody');

  if(r.grade==='blocked'){
    var bh='<div class="blocked-wrap fade"><div class="em">🚧</div><div class="bt">The site\\'s bouncer turned us away</div><div class="bd">'+esc((r.issues&&r.issues[0]&&r.issues[0].message)||'Some sites gatekeep automated checks. Your link is probably fine — you\\'ll just need to eyeball this one yourself.')+'</div></div>';
    body.innerHTML=bh;return;
  }

  var col=ringColor(r.score);
  var off=264-(264*(r.score/100));
  var html='<div class="fade">';
  html+='<div class="res-head"><svg class="res-ring" viewBox="0 0 100 100"><circle cx="50" cy="50" r="42" fill="none" stroke="#1B2436" stroke-width="8"/><circle cx="50" cy="50" r="42" fill="none" stroke="'+col+'" stroke-width="8" stroke-linecap="round" stroke-dasharray="264" stroke-dashoffset="'+off+'" transform="rotate(-90 50 50)"/><text x="50" y="58" text-anchor="middle" font-family="JetBrains Mono,monospace" font-size="26" font-weight="700" fill="#EAF0F7">'+r.score+'</text></svg>';
  html+='<div class="grade">'+esc(r.grade)+'</div><div class="headline">'+(r.score>=75?'Looking sharp.':r.score>=45?'Room to improve.':'This needs work.')+'</div><div class="url">'+esc(r.finalUrl||'')+'</div></div>';

  // verdict / issues — centered, directly under the score
  if(r.issues&&r.issues.length){
    html+='<div class="issues">';
    r.issues.forEach(function(i){html+='<div class="issue '+i.severity+'"><div class="sev">'+i.severity+'</div>'+esc(i.message)+'</div>';});
    html+='</div>';
  }else{
    html+='<div class="issues"><div class="issue low"><div class="sev">perfect</div>No issues found — this link will look great when shared.</div></div>';
  }

  // previews below the verdict
  if(r.previews){
    var pv=r.previews;
    html+='<div class="cards">'+pcard('twitter',pv.twitter)+pcard('linkedin',pv.linkedin)+pcard('slack',pv.slack)+pcard('facebook',pv.facebook)+'</div>';
  }

  html+='<div class="monitor" id="monitor">'
    +'<div class="m-head"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#5EEAD4" stroke-width="1.8"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg><b>Want to know if this ever breaks?</b></div>'
    +'<p class="m-sub">We\\'ll keep an eye on this link and email you the moment its preview stops rendering right — after a deploy, a CMS change, or a platform update. Free, no account needed.</p>'
    +'<div class="m-form" id="mForm"><input type="email" id="monitorEmail" placeholder="you@company.dev" aria-label="Email for monitoring"><button class="btn" onclick="startMonitor()">Watch this link</button></div>'
    +'<p class="m-success" id="mSuccess">✓ Done. We\\'re watching this link — we\\'ll only email you if something breaks.</p>'
    +'<p class="m-error" id="mError"></p>'
    +'<p class="m-note">One email per issue · unsubscribe anytime · we never share your address</p>'
    +'</div>';
  html+='</div>';
  body.innerHTML=html;
}

function startMonitor(){
  var e=document.getElementById('monitorEmail').value.trim();
  var err=document.getElementById('mError');
  err.style.display='none';
  if(!/^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(e)){err.textContent='⚠ That doesn\\'t look like a valid email address.';err.style.display='block';document.getElementById('monitorEmail').style.borderColor='#FF5F57';return;}
  document.getElementById('monitorEmail').style.borderColor='';
  var btn=document.querySelector('#mForm .btn');btn.disabled=true;btn.textContent='Saving…';
  var url=document.getElementById('addr')?document.getElementById('addr').textContent.trim():'';
  fetch('/api/signup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind:'monitor',email:e,url:url})})
    .then(function(r){return r.json();})
    .then(function(res){
      if(res.ok){document.getElementById('mForm').style.display='none';document.getElementById('mSuccess').style.display='block';}
      else{err.textContent='⚠ Couldn\\'t save that just now — please try again in a moment.';err.style.display='block';btn.disabled=false;btn.textContent='Watch this link';}
    })
    .catch(function(){err.textContent='⚠ Something went wrong. Please try again.';err.style.display='block';btn.disabled=false;btn.textContent='Watch this link';});
}
function joinWaitlist(){
  var e=document.getElementById('email').value.trim();
  var err=document.getElementById('waitError');
  err.style.display='none';
  if(!/^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(e)){err.textContent='⚠ That doesn\\'t look like a valid email address.';err.style.display='block';document.getElementById('email').style.borderColor='#FF5F57';return;}
  document.getElementById('email').style.borderColor='';
  fetch('/api/signup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind:'waitlist',email:e})})
    .then(function(r){return r.json();})
    .then(function(res){
      if(res.ok){document.querySelector('.form').style.display='none';document.getElementById('success').style.display='block';}
      else{err.textContent='⚠ Couldn\\'t save that just now — please try again in a moment.';err.style.display='block';}
    })
    .catch(function(){err.textContent='⚠ Something went wrong. Please try again.';err.style.display='block';});
}
document.getElementById('url').addEventListener('keydown',function(ev){if(ev.key==='Enter')runCheck();});
document.getElementById('email').addEventListener('keydown',function(ev){if(ev.key==='Enter')joinWaitlist();});
</script>
</body>
</html>`;

// Shared minimal styling for the standalone privacy / unsubscribe pages
const PAGE_HEAD = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 48 56'%3E%3Cdefs%3E%3ClinearGradient id='g' x1='0' y1='8' x2='44' y2='48' gradientUnits='userSpaceOnUse'%3E%3Cstop stop-color='%235EEAD4'/%3E%3Cstop offset='1' stop-color='%2322D3EE'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect x='4' y='8' width='40' height='40' rx='9' fill='%230B1120' stroke='url(%23g)' stroke-width='2.5'/%3E%3Ccircle cx='15' cy='15' r='2' fill='url(%23g)'/%3E%3Cline x1='15' y1='16' x2='15' y2='41' stroke='url(%23g)' stroke-width='2.6' stroke-linecap='round'/%3E%3Cpath d='M15 18 H33 q5 5 0 9 q-5 4 0 8 H15 Z' fill='url(%23g)'/%3E%3C/svg%3E">
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
body{background:#05080F;color:#EAF0F7;font-family:'Space Grotesk',sans-serif;line-height:1.7;margin:0;padding:60px 24px}
.wrap{max-width:680px;margin:0 auto}
a{color:#22D3EE}
.logo{display:inline-flex;align-items:center;gap:8px;margin-bottom:40px;font-family:'JetBrains Mono',monospace;font-weight:700;font-size:18px;color:#EAF0F7;text-decoration:none;letter-spacing:-1px}
.logo b{color:#22D3EE;font-weight:700}
h1{font-size:32px;font-weight:700;letter-spacing:-1px;margin-bottom:8px}
.updated{color:#5C6A80;font-family:'JetBrains Mono',monospace;font-size:13px;margin-bottom:36px}
h2{font-size:19px;font-weight:600;margin:32px 0 10px;letter-spacing:-.3px}
p,li{color:#93A1B5;font-size:15px}
ul{padding-left:20px}
li{margin-bottom:6px}
.box{background:#0C1322;border:1px solid #263149;border-radius:14px;padding:30px;margin-top:20px}
.uform{display:flex;gap:10px;flex-wrap:wrap;margin-top:18px}
.uform input{flex:1;min-width:220px;background:rgba(0,0,0,.3);border:1px solid #263149;border-radius:10px;padding:13px 16px;color:#EAF0F7;font-family:'JetBrains Mono',monospace;font-size:14px;outline:none}
.uform input:focus{border-color:#22D3EE}
.btn{background:linear-gradient(135deg,#5EEAD4,#22D3EE);color:#04141A;font-weight:600;padding:13px 22px;border-radius:10px;font-size:14px;border:none;cursor:pointer}
.msg{margin-top:16px;font-family:'JetBrains Mono',monospace;font-size:14px;display:none}
.msg.ok{color:#5EEAD4}.msg.err{color:#FF8585}
.back{margin-top:40px;display:inline-block;font-size:14px;color:#5C6A80}
</style></head><body><div class="wrap">
<a href="/" class="logo">unfurl<b>.pro</b></a>`;

function privacyPage() {
  return PAGE_HEAD + `
<h1>Privacy Policy</h1>
<div class="updated">Last updated: June 2026</div>

<p>Unfurl ("we") makes a tool for checking and monitoring how links look when shared. This policy explains, in plain language, what personal data we handle and your choices. We aim to collect as little as possible.</p>

<h2>What we collect</h2>
<ul>
<li><b>Your email address</b> — only if you give it to us by joining the waitlist or asking us to monitor a link.</li>
<li><b>A URL you ask us to monitor</b> — the link you want us to watch, stored alongside your email so we can alert you if its preview breaks.</li>
<li><b>Basic, anonymous usage data</b> — we may record which URLs are checked and their scores to improve the tool. This is not tied to your identity.</li>
</ul>
<p>When you use the free checker without entering an email, we do not store anything that identifies you.</p>

<h2>Why we collect it</h2>
<p>Your email is used solely to contact you about the thing you signed up for — early-access news (waitlist), or an alert if a link you asked us to monitor stops rendering correctly. We do not use it for anything else.</p>

<h2>What we will never do</h2>
<ul>
<li>We never sell or rent your email address.</li>
<li>We never share it with third parties for their own marketing.</li>
<li>We never send you unrelated promotional email.</li>
</ul>

<h2>How long we keep it</h2>
<p>We keep your email until you unsubscribe or ask us to delete it. Once you unsubscribe, we stop contacting you; you can also request full deletion at any time.</p>

<h2>Your rights</h2>
<p>Under the GDPR you can access, correct, or delete your personal data, and withdraw consent at any time. To unsubscribe, use the <a href="/unsubscribe">unsubscribe page</a>. For access or deletion requests, email us at the address below and we'll action it.</p>

<h2>Where your data is stored</h2>
<p>Signup data is stored with our database provider (Supabase) on servers in the EU. Reasonable measures are taken to protect it, though no online service can guarantee absolute security.</p>

<h2>Contact</h2>
<p>Questions or requests about your data: <a href="mailto:privacy@unfurl.pro">privacy@unfurl.pro</a></p>

<a href="/" class="back">← Back to Unfurl</a>
</div></body></html>`;
}

function unsubscribePage(prefillEmail) {
  return PAGE_HEAD + `
<h1>Unsubscribe</h1>
<div class="updated">Stop all emails from Unfurl</div>
<p>Enter your email below and we'll stop contacting you — both waitlist news and any link-monitoring alerts. This takes effect immediately.</p>
<div class="box">
  <div class="uform">
    <input type="email" id="uemail" placeholder="you@company.dev" value="${esc(prefillEmail || '')}" aria-label="Your email">
    <button class="btn" onclick="doUnsub()">Unsubscribe</button>
  </div>
  <p class="msg ok" id="uok">✓ Done. You've been unsubscribed and won't receive further emails.</p>
  <p class="msg err" id="uerr"></p>
</div>
<a href="/" class="back">← Back to Unfurl</a>
<script>
function doUnsub(){
  var e=document.getElementById('uemail').value.trim();
  var ok=document.getElementById('uok'),err=document.getElementById('uerr');
  ok.style.display='none';err.style.display='none';
  if(!/^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(e)){err.textContent='⚠ Please enter a valid email address.';err.style.display='block';return;}
  fetch('/api/unsubscribe',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:e})})
    .then(function(r){return r.json();})
    .then(function(res){
      if(res.ok){document.querySelector('.uform').style.display='none';ok.style.display='block';}
      else{err.textContent='⚠ Something went wrong. Please try again, or email privacy@unfurl.pro.';err.style.display='block';}
    })
    .catch(function(){err.textContent='⚠ Something went wrong. Please try again.';err.style.display='block';});
}
</script>
</div></body></html>`;
}

const server = http.createServer(async (req, res) => {
  if (req.url.startsWith('/api/check')) {
    const u = new URL(req.url, 'http://x');
    const target = u.searchParams.get('url');
    res.setHeader('content-type', 'application/json');
    if (!target) {
      res.statusCode = 400;
      return res.end(JSON.stringify({ ok: false, error: 'missing url' }));
    }
    try {
      const report = await checkUrl(target);
      return res.end(JSON.stringify(report));
    } catch (e) {
      res.statusCode = 500;
      return res.end(JSON.stringify({ ok: false, error: 'check-failed' }));
    }
  }
  if (req.url === '/api/signup' && req.method === 'POST') {
    res.setHeader('content-type', 'application/json');
    let body = '';
    req.on('data', (c) => {
      body += c;
      if (body.length > 4000) req.destroy(); // guard against oversized payloads
    });
    req.on('end', async () => {
      let data;
      try { data = JSON.parse(body); } catch { data = {}; }
      const kind = data.kind === 'monitor' ? 'monitor' : 'waitlist';
      const email = (data.email || '').trim().toLowerCase();
      const url = typeof data.url === 'string' ? data.url.slice(0, 500) : null;
      if (!isEmail(email)) {
        res.statusCode = 400;
        return res.end(JSON.stringify({ ok: false, error: 'invalid-email' }));
      }
      try {
        await saveSignup({ kind, email, url: kind === 'monitor' ? url : null });
        return res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.statusCode = 500;
        return res.end(JSON.stringify({ ok: false, error: 'save-failed' }));
      }
    });
    return;
  }
  if (req.url === '/api/unsubscribe' && req.method === 'POST') {
    res.setHeader('content-type', 'application/json');
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 2000) req.destroy(); });
    req.on('end', async () => {
      let data; try { data = JSON.parse(body); } catch { data = {}; }
      const email = (data.email || '').trim().toLowerCase();
      if (!isEmail(email)) {
        res.statusCode = 400;
        return res.end(JSON.stringify({ ok: false, error: 'invalid-email' }));
      }
      try {
        await unsubscribeEmail(email);
        return res.end(JSON.stringify({ ok: true }));
      } catch (e) {
        res.statusCode = 500;
        return res.end(JSON.stringify({ ok: false, error: 'unsub-failed' }));
      }
    });
    return;
  }
  if (req.url === '/privacy') {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    return res.end(privacyPage());
  }
  if (req.url.startsWith('/unsubscribe')) {
    const u = new URL(req.url, 'http://x');
    res.setHeader('content-type', 'text/html; charset=utf-8');
    return res.end(unsubscribePage(u.searchParams.get('email')));
  }
  if (req.url.startsWith('/api/run-monitor')) {
    res.setHeader('content-type', 'application/json');
    const u = new URL(req.url, 'http://x');
    const token = u.searchParams.get('key');
    const expected = process.env.MONITOR_SECRET || '';
    if (!expected || token !== expected) {
      res.statusCode = 403;
      return res.end(JSON.stringify({ ok: false, error: 'forbidden' }));
    }
    try {
      const summary = await runMonitorCheck(sendBreakAlert);
      return res.end(JSON.stringify({ ok: true, summary }));
    } catch (e) {
      res.statusCode = 500;
      return res.end(JSON.stringify({ ok: false, error: String(e.message || e) }));
    }
  }
  if (req.url === '/og.png') {
    if (OG_IMAGE) {
      res.setHeader('content-type', 'image/png');
      res.setHeader('cache-control', 'public, max-age=86400');
      return res.end(OG_IMAGE);
    }
    res.statusCode = 404;
    return res.end('not found');
  }
  if (req.url === '/health') {
    return res.end('ok');
  }
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.end(PAGE);
});

server.listen(PORT, () => {
  console.log(`Unfurl running on http://localhost:${PORT}`);
});
