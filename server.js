/**
 * OGForge — Aurora landing page + live link preview checker.
 * The hero browser is a REAL checker: type a URL, it calls /api/check,
 * and fills the window with the live score, preview cards, and issues.
 * Zero dependencies. Run:  node server.js  ->  http://localhost:3000
 */
const http = require('http');
const { checkUrl } = require('./checker');

const PORT = process.env.PORT || 3000;

const PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>OGForge — Make every shared link look right</title>
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
.checker-input-row{display:flex;gap:12px;max-width:620px;margin:0 auto 30px;flex-wrap:wrap}
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
.res-head{display:flex;align-items:center;gap:18px;margin-bottom:22px}
.res-ring{width:78px;height:78px;flex-shrink:0}
.res-head .grade{font-family:'JetBrains Mono',monospace;font-size:12px;text-transform:uppercase;letter-spacing:1.5px;color:var(--muted)}
.res-head .headline{font-size:19px;font-weight:600;letter-spacing:-.3px;margin-top:2px}
.res-head .url{font-size:12px;color:var(--dim);font-family:'JetBrains Mono',monospace;margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:420px}
.cards{display:grid;grid-template-columns:1fr 1fr;gap:13px;margin-bottom:6px}
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
.issues{margin-top:16px;text-align:left}
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
  <a href="#" class="logo">
    <svg width="160" height="40" viewBox="0 0 220 56" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs><linearGradient id="f1" x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse"><stop stop-color="#5EEAD4"/><stop offset="1" stop-color="#22D3EE"/></linearGradient></defs>
      <rect x="4" y="8" width="40" height="40" rx="9" fill="#0B1120" stroke="url(#f1)" stroke-width="2.5"/>
      <rect x="13" y="17" width="22" height="22" rx="4" fill="none" stroke="url(#f1)" stroke-width="2.5"/>
      <circle cx="20" cy="24" r="2.6" fill="url(#f1)"/>
      <path d="M14 36L21 28L26 33L31 27L35 32" stroke="url(#f1)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
      <text x="56" y="36" font-family="JetBrains Mono,monospace" font-size="23" font-weight="700" fill="#EAF0F7" letter-spacing="-0.5">OG<tspan fill="#22D3EE">Forge</tspan></text>
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
    <p class="sub reveal d3">Broken link previews make great work look like spam. OGForge turns them into previews people actually click — check, generate, and auto-maintain your images and meta tags, with zero fiddling.</p>
    <p class="hero-note reveal d4" style="margin-bottom:8px">Paste a link below — free, no signup, see how it really looks when shared.</p>
  </div>

  <div class="showcase reveal d5">
    <div class="checker-input-row">
      <input id="url" placeholder="https://yourblog.dev/post" />
      <button id="go" class="btn" onclick="runCheck()">Check link</button>
    </div>
    <div class="showcase-reflect"></div>
    <div class="browser resting" id="browser">
      <div class="browser-bar">
        <span class="c c1"></span><span class="c c2"></span><span class="c c3"></span>
        <span class="addr" id="addr"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#5EEAD4" stroke-width="2"><path d="M12 2a10 10 0 100 20 10 10 0 000-20zM2 12h20M12 2a15 15 0 010 20 15 15 0 010-20"/></svg> ogforge.io/check</span>
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
            <div class="pv-img"><div class="glow-orb"></div><div class="fg">OG<b>Forge</b></div></div>
            <div class="pv-meta">
              <div class="site">ogforge.io</div>
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
    <p class="sec-sub">Most teams glue together four different tools for this. OGForge is the whole pipeline.</p>
    <div class="steps">
      <div class="step"><div class="num">01</div><span class="free">FREE FOREVER</span><h3>Check</h3><p>Paste any URL and instantly see how it renders across every platform, with a health score and exactly what's broken. No signup.</p></div>
      <div class="step"><div class="num">02</div><h3>Forge</h3><p>Generate a pixel-perfect preview image with one API call. Pick a template, send your title and logo, get a cached CDN URL back.</p></div>
      <div class="step"><div class="num">03</div><h3>Sync</h3><p>OGForge returns the complete meta-tag block and keeps it in sync automatically whenever your page changes.</p></div>
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
<span class="key">const</span> og = <span class="key">await</span> <span class="fn">ogforge</span>.<span class="fn">forge</span>({<br>
&nbsp;&nbsp;<span class="key">template</span>: <span class="str">"minimal-dark"</span>,<br>
&nbsp;&nbsp;<span class="key">title</span>: <span class="str">"Cut render time 90%"</span>,<br>
&nbsp;&nbsp;<span class="key">logo</span>: <span class="str">"/logo.svg"</span><br>
});<br><br>
<span class="cm">// → og.image  cdn.ogforge.io/i/a8f.png</span><br>
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
    <p class="sec-sub">The checker is free forever. Pay only when you want OGForge generating and syncing for you.</p>
    <div class="prices">
      <div class="price">
        <div class="name">Free</div><div class="amt">€0<span> /mo</span></div>
        <ul>
          <li><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#5EEAD4" stroke-width="2.5"><path d="M20 6L9 17l-5-5"/></svg> Unlimited link checks</li>
          <li><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#5EEAD4" stroke-width="2.5"><path d="M20 6L9 17l-5-5"/></svg> Full meta-tag health scores</li>
          <li><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#5EEAD4" stroke-width="2.5"><path d="M20 6L9 17l-5-5"/></svg> 1,000 images / month</li>
          <li><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#5EEAD4" stroke-width="2.5"><path d="M20 6L9 17l-5-5"/></svg> 3 templates</li>
        </ul>
        <a href="#waitlist" class="btn btn-ghost">Start free</a>
      </div>
      <div class="price feat">
        <div class="tag">MOST POPULAR</div>
        <div class="name">Pro</div><div class="amt">€19<span> /mo</span></div>
        <ul>
          <li><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#5EEAD4" stroke-width="2.5"><path d="M20 6L9 17l-5-5"/></svg> 50,000 images / month</li>
          <li><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#5EEAD4" stroke-width="2.5"><path d="M20 6L9 17l-5-5"/></svg> Unlimited templates</li>
          <li><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#5EEAD4" stroke-width="2.5"><path d="M20 6L9 17l-5-5"/></svg> No watermark · your branding</li>
          <li><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#5EEAD4" stroke-width="2.5"><path d="M20 6L9 17l-5-5"/></svg> Auto meta-tag sync + SDK</li>
          <li><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#5EEAD4" stroke-width="2.5"><path d="M20 6L9 17l-5-5"/></svg> Dynamic signed URLs</li>
        </ul>
        <a href="#waitlist" class="btn">Get early access</a>
      </div>
      <div class="price">
        <div class="name">Scale</div><div class="amt">€49<span> /mo</span></div>
        <ul>
          <li><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#5EEAD4" stroke-width="2.5"><path d="M20 6L9 17l-5-5"/></svg> 250,000 images / month</li>
          <li><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#5EEAD4" stroke-width="2.5"><path d="M20 6L9 17l-5-5"/></svg> Everything in Pro</li>
          <li><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#5EEAD4" stroke-width="2.5"><path d="M20 6L9 17l-5-5"/></svg> Site-wide preview audits</li>
          <li><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#5EEAD4" stroke-width="2.5"><path d="M20 6L9 17l-5-5"/></svg> Team seats &amp; priority support</li>
        </ul>
        <a href="#waitlist" class="btn btn-ghost">Get early access</a>
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
    </div>
  </div>
</section>

<footer>
  <div class="wrap">
    <svg width="130" height="34" viewBox="0 0 220 56" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs><linearGradient id="f2" x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse"><stop stop-color="#5EEAD4"/><stop offset="1" stop-color="#22D3EE"/></linearGradient></defs>
      <rect x="4" y="8" width="40" height="40" rx="9" fill="#0B1120" stroke="url(#f2)" stroke-width="2.5"/>
      <rect x="13" y="17" width="22" height="22" rx="4" fill="none" stroke="url(#f2)" stroke-width="2.5"/>
      <circle cx="20" cy="24" r="2.6" fill="url(#f2)"/>
      <path d="M14 36L21 28L26 33L31 27L35 32" stroke="url(#f2)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
      <text x="56" y="36" font-family="JetBrains Mono,monospace" font-size="23" font-weight="700" fill="#EAF0F7" letter-spacing="-0.5">OG<tspan fill="#22D3EE">Forge</tspan></text>
    </svg>
    <span class="muted">© 2026 OGForge · forged for developers</span>
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
  html+='<div><div class="grade">'+esc(r.grade)+'</div><div class="headline">'+(r.score>=75?'Looking sharp.':r.score>=45?'Room to improve.':'This needs work.')+'</div><div class="url">'+esc(r.finalUrl||'')+'</div></div></div>';

  if(r.previews){
    var pv=r.previews;
    html+='<div class="cards">'+pcard('twitter',pv.twitter)+pcard('linkedin',pv.linkedin)+pcard('slack',pv.slack)+pcard('facebook',pv.facebook)+'</div>';
  }
  if(r.issues&&r.issues.length){
    html+='<div class="issues">';
    r.issues.forEach(function(i){html+='<div class="issue '+i.severity+'"><div class="sev">'+i.severity+'</div>'+esc(i.message)+'</div>';});
    html+='</div>';
  }else{
    html+='<div class="issues"><div class="issue low"><div class="sev">perfect</div>No issues found — this link will look great when shared.</div></div>';
  }
  html+='<div class="monitor" id="monitor">'
    +'<div class="m-head"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#5EEAD4" stroke-width="1.8"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg><b>Want to know if this ever breaks?</b></div>'
    +'<p class="m-sub">We\\'ll keep an eye on this link and email you the moment its preview stops rendering right — after a deploy, a CMS change, or a platform update. Free, no account needed.</p>'
    +'<div class="m-form" id="mForm"><input type="email" id="monitorEmail" placeholder="you@company.dev" aria-label="Email for monitoring"><button class="btn" onclick="startMonitor()">Watch this link</button></div>'
    +'<p class="m-success" id="mSuccess">✓ Done. We\\'re watching this link — we\\'ll only email you if something breaks.</p>'
    +'<p class="m-note">One email per issue · unsubscribe anytime · we never share your address</p>'
    +'</div>';
  html+='</div>';
  body.innerHTML=html;
}

function startMonitor(){
  var e=document.getElementById('monitorEmail').value.trim();
  if(!/^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(e)){document.getElementById('monitorEmail').style.borderColor='#FF5F57';return;}
  document.getElementById('mForm').style.display='none';
  document.getElementById('mSuccess').style.display='block';
  // On launch: POST {email, url} with opt-in consent, schedule periodic re-checks, alert on failure.
}
function joinWaitlist(){
  var e=document.getElementById('email').value.trim();
  if(!/^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$/.test(e)){document.getElementById('email').style.borderColor='#FF5F57';return;}
  document.querySelector('.form').style.display='none';
  document.getElementById('success').style.display='block';
}
document.getElementById('url').addEventListener('keydown',function(ev){if(ev.key==='Enter')runCheck();});
document.getElementById('email').addEventListener('keydown',function(ev){if(ev.key==='Enter')joinWaitlist();});
</script>
</body>
</html>`;

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
  if (req.url === '/health') {
    return res.end('ok');
  }
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.end(PAGE);
});

server.listen(PORT, () => {
  console.log(`OGForge running on http://localhost:${PORT}`);
});
