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
  .sev{font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:var(--dim);margin-bottom:2px}
  .err{color:#FF8585}
  .preview-section{margin-top:26px}
  .preview-label{font-size:12px;text-transform:uppercase;letter-spacing:1px;color:var(--dim);margin:0 0 12px 2px}
  .cards{display:grid;grid-template-columns:1fr 1fr;gap:14px}
  .pcard{background:var(--panel);border:1px solid var(--line);border-radius:12px;overflow:hidden}
  .pcard .platform{font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:var(--dim);padding:9px 12px 0}
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

function imgBlock(p, small){
  if(p && p.image){
    return '<div class="pimg'+(small?' small':'')+'"><img src="'+esc(p.image)+'" alt="" onerror="this.parentNode.innerHTML=\\'<span style=&quot;color:#FF8585;font-size:12px&quot;>⚠ image failed to load</span>\\'"></div>';
  }
  return '<div class="pimg missing"><span>no image</span><span style="color:#FF8585">this link shows no picture</span></div>';
}

function previewCard(platform, p, thumb){
  if(!p) return '';
  if(thumb){
    return '<div class="pcard thumb"><div class="pimg">'+(p.image?'<img src="'+esc(p.image)+'" alt="">':'')+'</div>'
      +'<div class="pmeta"><div class="platform">'+platform+'</div><div class="ptitle">'+esc(p.title||'(no title)')+'</div>'
      +'<div class="pdomain">'+esc(p.domain||'')+'</div></div></div>';
  }
  return '<div class="pcard"><div class="platform">'+platform+'</div>'+imgBlock(p)
    +'<div class="pmeta"><div class="ptitle">'+esc(p.title||'(no title)')+'</div>'
    +'<div class="pdesc">'+esc(p.description||'')+'</div>'
    +'<div class="pdomain">'+esc(p.domain||'')+'</div></div></div>';
}

function render(r){
  var out=document.getElementById('out');
  var color = r.score>=75?'#5EEAD4':r.score>=45?'#FEBC2E':'#FF6B6B';
  var html='<div class="score"><div class="badge" style="border-color:'+color+';color:'+color+'">'+r.score+'</div>'
    +'<div><div class="grade">'+r.grade+'</div><div>'+(r.ok?'Checked '+(r.finalUrl||''):'Could not fully check this URL')+'</div></div></div>';

  // visual previews
  if(r.previews){
    var pv=r.previews;
    var twThumb = pv.twitter && pv.twitter.style==='thumbnail';
    html+='<div class="preview-section"><p class="preview-label">How it will look when shared</p><div class="cards">';
    html+=previewCard('X / Twitter', pv.twitter, twThumb);
    html+=previewCard('LinkedIn', pv.linkedin, false);
    html+=previewCard('Slack', pv.slack, false);
    html+=previewCard('Facebook', pv.facebook, false);
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
