/**
 * OGForge — minimal web server
 * Serves one page with an input box, and a /api/check endpoint
 * that runs the checker and returns JSON. Zero dependencies.
 *
 * Run locally:   node server.js   ->   http://localhost:3000
 */
const http = require('http');
const { checkUrl } = require('./checker');

const PORT = process.env.PORT || 3000;

const PAGE = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>OGForge — Link Preview Checker</title>
<style>
  :root{--bg:#070B14;--soft:#0B1120;--panel:#0F172A;--line:#1E293B;--text:#E2E8F0;--muted:#94A3B8;--dim:#64748B;--accent:#22D3EE;--accent2:#5EEAD4}
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:var(--bg);color:var(--text);font-family:system-ui,sans-serif;line-height:1.6;padding:40px 16px}
  .wrap{max-width:640px;margin:0 auto}
  h1{font-size:26px;letter-spacing:-.5px;margin-bottom:6px}
  h1 span{background:linear-gradient(135deg,var(--accent2),var(--accent));-webkit-background-clip:text;background-clip:text;color:transparent}
  p.sub{color:var(--muted);margin-bottom:24px;font-size:15px}
  .row{display:flex;gap:10px;flex-wrap:wrap}
  input{flex:1;min-width:240px;background:var(--soft);border:1px solid var(--line);border-radius:10px;padding:13px 15px;color:var(--text);font-size:15px;outline:none}
  input:focus{border-color:var(--accent)}
  button{background:linear-gradient(135deg,var(--accent2),var(--accent));color:#04141A;font-weight:700;border:none;border-radius:10px;padding:13px 22px;font-size:15px;cursor:pointer}
  button:disabled{opacity:.6;cursor:wait}
  #out{margin-top:26px}
  .score{display:flex;align-items:center;gap:16px;background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:18px}
  .badge{width:56px;height:56px;border-radius:50%;border:3px solid var(--accent2);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:18px;flex-shrink:0}
  .grade{font-size:13px;text-transform:uppercase;letter-spacing:1px;color:var(--muted)}
  .issue{background:var(--panel);border:1px solid var(--line);border-left:3px solid var(--dim);border-radius:10px;padding:12px 14px;margin-top:10px;font-size:14px}
  .issue.high{border-left-color:#FF6B6B}.issue.medium{border-left-color:#FEBC2E}.issue.low{border-left-color:var(--accent)}
  .issue.info{border-left-color:var(--accent2)}
  .badge.blocked{border-color:var(--accent2);font-size:24px}
  .sev{font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:var(--dim);margin-bottom:2px}
  .err{color:#FF8585}
  .preview-section{margin-top:26px}
  .preview-label{font-size:12px;text-transform:uppercase;letter-spacing:1px;color:var(--dim);margin:0 0 12px 2px}
  .cards{display:grid;grid-template-columns:1fr 1fr;gap:14px}
  .pcard{background:var(--panel);border:1px solid var(--line);border-radius:12px;overflow:hidden}
  .pcard .platform{display:flex;align-items:center;gap:7px;font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);padding:10px 12px 0;font-weight:600}
  .pcard .platform svg{flex-shrink:0;opacity:.95}
  .pcard.thumb .platform{padding:0 0 4px}
  .pcard .pimg{width:100%;aspect-ratio:1.91/1;background:#0a1622;display:flex;align-items:center;justify-content:center;border-bottom:1px solid var(--line);overflow:hidden}
  .pcard .pimg img{width:100%;height:100%;object-fit:cover;display:block}
  .pcard .pimg.missing{flex-direction:column;gap:6px;color:var(--dim);font-size:12px;text-align:center;padding:14px}
  .pcard .pimg.small img{width:64px;height:64px;border-radius:8px}
  .pcard.thumb{display:flex}
  .pcard.thumb .pimg{width:84px;aspect-ratio:auto;border-bottom:none;border-right:1px solid var(--line);flex-shrink:0}
  .pcard.thumb .pimg img{width:84px;height:84px}
  .pcard .pmeta{padding:10px 12px;min-width:0}
  .pcard .pdomain{font-size:11px;color:var(--dim);text-transform:lowercase}
  .pcard .ptitle{font-size:14px;font-weight:600;margin:2px 0;color:var(--text);overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
  .pcard .pdesc{font-size:12px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
  @media(max-width:560px){.cards{grid-template-columns:1fr}}
  footer{margin-top:32px;color:var(--dim);font-size:12px;text-align:center}
</style></head>
<body><div class="wrap">
  <h1>OG<span>Forge</span> — Link Preview Checker</h1>
  <p class="sub">Paste a URL to see how it renders when shared, and what's broken.</p>
  <div class="row">
    <input id="url" placeholder="https://yourblog.dev/post" />
    <button id="go" onclick="run()">Check</button>
  </div>
  <div id="out"></div>
  <footer>OGForge · early preview</footer>
</div>
<script>
async function run(){
  var btn=document.getElementById('go'), out=document.getElementById('out');
  var url=document.getElementById('url').value.trim();
  if(!url){return}
  btn.disabled=true; btn.textContent='Checking…'; out.innerHTML='';
  try{
    var res=await fetch('/api/check?url='+encodeURIComponent(url));
    var r=await res.json();
    if(!r.ok && r.issues){ render(r); }
    else { render(r); }
  }catch(e){ out.innerHTML='<p class="err">Something went wrong. Try again.</p>'; }
  btn.disabled=false; btn.textContent='Check';
}
function esc(s){ if(s==null)return ''; return String(s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]}); }

// Platform logos as inline SVG, tinted with the site accent so they match the
// dark/teal brand rather than clashing with each platform's native colours.
function platformBadge(key){
  var c='#5EEAD4';
  var logos={
    twitter:'<svg width="13" height="13" viewBox="0 0 24 24" fill="'+c+'"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231 5.45-6.231zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77z"/></svg>',
    linkedin:'<svg width="13" height="13" viewBox="0 0 24 24" fill="'+c+'"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>',
    slack:'<svg width="13" height="13" viewBox="0 0 24 24" fill="'+c+'"><path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z"/></svg>',
    facebook:'<svg width="13" height="13" viewBox="0 0 24 24" fill="'+c+'"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>'
  };
  var names={twitter:'X / Twitter',linkedin:'LinkedIn',slack:'Slack',facebook:'Facebook'};
  return '<div class="platform">'+(logos[key]||'')+'<span>'+names[key]+'</span></div>';
}

function imgBlock(p, small){
  if(p && p.image){
    return '<div class="pimg'+(small?' small':'')+'"><img src="'+esc(p.image)+'" alt="" onerror="this.parentNode.innerHTML=\\'<span style=&quot;color:#FF8585;font-size:12px&quot;>⚠ image failed to load</span>\\'"></div>';
  }
  return '<div class="pimg missing"><span>no image</span><span style="color:#FF8585">this link shows no picture</span></div>';
}

function previewCard(key, p, thumb){
  if(!p) return '';
  if(thumb){
    return '<div class="pcard thumb"><div class="pimg">'+(p.image?'<img src="'+esc(p.image)+'" alt="">':'')+'</div>'
      +'<div class="pmeta">'+platformBadge(key)+'<div class="ptitle">'+esc(p.title||'(no title)')+'</div>'
      +'<div class="pdomain">'+esc(p.domain||'')+'</div></div></div>';
  }
  return '<div class="pcard">'+platformBadge(key)+imgBlock(p)
    +'<div class="pmeta"><div class="ptitle">'+esc(p.title||'(no title)')+'</div>'
    +'<div class="pdesc">'+esc(p.description||'')+'</div>'
    +'<div class="pdomain">'+esc(p.domain||'')+'</div></div></div>';
}

function render(r){
  var out=document.getElementById('out');

  // blocked: the site refused our check — show a light, honest message, no scary 0
  if(r.grade==='blocked'){
    var bhtml='<div class="score"><div class="badge blocked">🚧</div>'
      +'<div><div class="grade">Blocked</div><div>The site wouldn\\'t let us in</div></div></div>';
    (r.issues||[]).forEach(function(i){
      bhtml+='<div class="issue info"><div class="sev">heads up</div>'+i.message+'</div>';
    });
    out.innerHTML=bhtml;
    return;
  }

  var color = r.score>=75?'#5EEAD4':r.score>=45?'#FEBC2E':'#FF6B6B';
  var html='<div class="score"><div class="badge" style="border-color:'+color+';color:'+color+'">'+r.score+'</div>'
    +'<div><div class="grade">'+r.grade+'</div><div>'+(r.ok?'Checked '+(r.finalUrl||''):'Could not fully check this URL')+'</div></div></div>';

  // visual previews
  if(r.previews){
    var pv=r.previews;
    var twThumb = pv.twitter && pv.twitter.style==='thumbnail';
    html+='<div class="preview-section"><p class="preview-label">How it will look when shared</p><div class="cards">';
    html+=previewCard('twitter', pv.twitter, twThumb);
    html+=previewCard('linkedin', pv.linkedin, false);
    html+=previewCard('slack', pv.slack, false);
    html+=previewCard('facebook', pv.facebook, false);
    html+='</div></div>';
  }

  (r.issues||[]).forEach(function(i){
    html+='<div class="issue '+i.severity+'"><div class="sev">'+i.severity+'</div>'+i.message+'</div>';
  });
  if((r.issues||[]).length===0){ html+='<div class="issue low"><div class="sev">perfect</div>No issues found — this link will look great when shared.</div>'; }
  out.innerHTML=html;
}
document.getElementById('url').addEventListener('keydown',function(e){if(e.key==='Enter')run()});
</script>
</body></html>`;

const server = http.createServer(async (req, res) => {
  // API endpoint
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
  // health check (hosts ping this)
  if (req.url === '/health') {
    return res.end('ok');
  }
  // the page
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.end(PAGE);
});

server.listen(PORT, () => {
  console.log(`OGForge checker running on http://localhost:${PORT}`);
});
