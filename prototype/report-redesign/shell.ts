// PROTOTYPE (throwaway). The page shell every generated page shares: colour
// tokens (light + dark), the tooltip, and the floating variant switcher.
// Each page holds all three variants' markup; `?variant=A|B|C` picks which one
// shows, and every relative link is rewritten to carry the param.

import { CHART_SCRIPT } from "./charts.ts";

export const VARIANTS = [
  { key: "A", name: "Executive one-pager" },
  { key: "B", name: "Dashboard" },
  { key: "C", name: "Editorial story" },
] as const;

export const BASE_CSS = `
:root {
  color-scheme: light;
  --surface: #fcfcfb; --plane: #f9f9f7; --raised: #ffffff;
  --ink: #0b0b0b; --ink-2: #52514e; --muted: #898781;
  --grid: #e1e0d9; --axis: #c3c2b7; --ring: rgba(11,11,11,0.10);
  --s1: #2a78d6; --s2: #eb6834; --s3: #1baf7a;
  --wash: rgba(42,120,214,0.10); --accent-ink: #1c5cab;
  --good: #006300;
  --font: system-ui, -apple-system, "Segoe UI", sans-serif;
}
@media (prefers-color-scheme: dark) {
  :root:where(:not([data-theme="light"])) {
    color-scheme: dark;
    --surface: #1a1a19; --plane: #0d0d0d; --raised: #222221;
    --ink: #f0efec; --ink-2: #c3c2b7; --muted: #898781;
    --grid: #2c2c2a; --axis: #383835; --ring: rgba(255,255,255,0.10);
    --s1: #3987e5; --s2: #d95926; --s3: #199e70;
    --wash: rgba(57,135,229,0.14); --accent-ink: #86b6ef; --good: #0ca30c;
  }
}
:root[data-theme="dark"] {
  color-scheme: dark;
  --surface: #1a1a19; --plane: #0d0d0d; --raised: #222221;
  --ink: #f0efec; --ink-2: #c3c2b7; --muted: #898781;
  --grid: #2c2c2a; --axis: #383835; --ring: rgba(255,255,255,0.10);
  --s1: #3987e5; --s2: #d95926; --s3: #199e70;
  --wash: rgba(57,135,229,0.14); --accent-ink: #86b6ef; --good: #0ca30c;
}
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body { margin: 0; background: var(--plane); color: var(--ink); font: 16px/1.5 var(--font); padding-bottom: 88px; }
a { color: inherit; text-underline-offset: 3px; text-decoration-color: var(--axis); }
a:hover { text-decoration-color: currentColor; }
img, svg { max-width: 100%; }
.variant { display: none; }
html[data-variant="A"] .variant[data-v="A"], html[data-variant="B"] .variant[data-v="B"], html[data-variant="C"] .variant[data-v="C"] { display: block; }
.muted { color: var(--muted); }
.cov { color: var(--muted); font-size: 13px; font-variant-numeric: tabular-nums; }
.unknown { color: var(--muted); font-style: italic; font-weight: 400; }
.num { font-variant-numeric: tabular-nums; }

/* charts */
.chart { display: block; width: 100%; height: auto; overflow: visible; }
.chart text { font-family: var(--font); fill: var(--muted); font-size: 11px; }
.chart .t-ink { fill: var(--ink); }
.chart .t-ink2 { fill: var(--ink-2); }
.chart .t-unknown { font-style: italic; }
.chart .grid { stroke: var(--grid); stroke-width: 1; }
.chart .base { stroke: var(--axis); stroke-width: 1; }
.chart .bar { fill: var(--s1); }
.chart .bar.l-full { fill: var(--s1); } .chart .bar.l-assisted { fill: var(--s2); } .chart .bar.l-manual { fill: var(--s3); }
.chart .line { fill: none; stroke: var(--s1); stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; }
.chart .area { fill: var(--wash); }
.chart .dot { fill: var(--s1); stroke: var(--surface); stroke-width: 2; }
.chart .hit { fill: transparent; cursor: default; }
.chart .hit:hover, .chart .hit:focus { fill: var(--ring); outline: none; }
.chart .rule { stroke: var(--ink-2); stroke-width: 1; }
.spark { display: inline-block; vertical-align: middle; width: 120px; height: 32px; }
.spark .line { stroke-width: 1.5; }
.legend { display: flex; flex-wrap: wrap; gap: 4px 16px; font-size: 13px; color: var(--ink-2); margin: 4px 0 8px; padding: 0; list-style: none; }
.legend i { display: inline-block; width: 10px; height: 10px; border-radius: 3px; margin-right: 6px; vertical-align: -1px; }
.sw-full { background: var(--s1); } .sw-assisted { background: var(--s2); } .sw-manual { background: var(--s3); }
#tip { position: fixed; z-index: 50; pointer-events: none; background: var(--raised); color: var(--ink); border: 1px solid var(--ring); box-shadow: 0 4px 16px rgba(0,0,0,.18); border-radius: 8px; padding: 6px 10px; font-size: 13px; line-height: 1.35; max-width: 260px; opacity: 0; transition: opacity .08s; }
#tip.on { opacity: 1; }
#tip b { font-weight: 600; }

/* tables */
table.data { border-collapse: collapse; width: 100%; font-size: 14px; font-variant-numeric: tabular-nums; }
table.data th, table.data td { text-align: left; padding: 6px 12px 6px 0; border-bottom: 1px solid var(--grid); vertical-align: top; }
table.data th { font-weight: 500; color: var(--ink-2); font-size: 13px; position: sticky; top: 0; background: var(--surface); cursor: pointer; user-select: none; }
table.data td.r, table.data th.r { text-align: right; padding-right: 0; }
.scroll { overflow-x: auto; -webkit-overflow-scrolling: touch; }
.tablewrap { max-height: 560px; overflow: auto; border-top: 1px solid var(--grid); }
details > summary { cursor: pointer; color: var(--ink-2); }

/* case-study prose */
.prose h4 { font-size: 20px; margin: 1.4em 0 .4em; } .prose h5 { font-size: 16px; margin: 1.4em 0 .3em; } .prose h6 { font-size: 15px; margin: 1.2em 0 .3em; }
.prose h4:first-child { margin-top: 0; }
.prose pre { background: var(--surface); border: 1px solid var(--grid); border-radius: 8px; padding: 12px; overflow-x: auto; font-size: 13px; }
.prose code { font-size: .9em; }
.prose blockquote { margin: 0; padding-left: 12px; border-left: 2px solid var(--axis); color: var(--ink-2); }

/* prototype switcher: deliberately not part of the design under review */
#proto-bar { position: fixed; left: 50%; bottom: 16px; transform: translateX(-50%); z-index: 100; display: flex; align-items: center; gap: 4px; background: #111; color: #fff; border-radius: 999px; padding: 6px; box-shadow: 0 8px 28px rgba(0,0,0,.35); font: 500 14px/1 var(--font); white-space: nowrap; max-width: calc(100vw - 16px); }
#proto-bar button { all: unset; cursor: pointer; padding: 8px 12px; border-radius: 999px; color: #fff; }
#proto-bar button:hover, #proto-bar button:focus-visible { background: #333; }
#proto-bar .lbl { padding: 0 8px; min-width: 190px; text-align: center; }
#proto-bar .lbl small { color: #aaa; font-weight: 400; margin-left: 4px; }
#proto-bar .theme { font-size: 12px; color: #bbb; }
@media (max-width: 420px) { #proto-bar .lbl { min-width: 0; } #proto-bar .lbl small { display: none; } }
`;

/** Runs in <head> before paint, so the right variant shows with no flash. */
const HEAD_SCRIPT = `(function(){var v=new URLSearchParams(location.search).get("variant");if(!/^[ABC]$/.test(v||""))v="A";document.documentElement.dataset.variant=v;try{var t=localStorage.getItem("proto-theme");if(t)document.documentElement.dataset.theme=t;}catch(e){}})();`;

const BODY_SCRIPT = `(function(){
var VARIANTS=${JSON.stringify(VARIANTS)};
var root=document.documentElement;
function current(){return root.dataset.variant||"A";}
function fixLinks(){var v=current();document.querySelectorAll("a[href]").forEach(function(a){var h=a.getAttribute("href");if(!h||/^[a-z]+:/i.test(h)||h.charAt(0)==="#")return;var parts=h.split("#");var path=parts[0].split("?")[0];if(!/\\.html$/.test(path))return;a.setAttribute("href",path+"?variant="+v+(parts[1]!==undefined?"#"+parts[1]:""));});}
function render(){var v=current();var i=VARIANTS.findIndex(function(x){return x.key===v;});var lbl=document.querySelector("#proto-bar .lbl");if(lbl)lbl.innerHTML=v+" <small>("+VARIANTS[i].name+")</small>";var th=document.querySelector("#proto-bar .theme");if(th)th.textContent=root.dataset.theme||"auto";}
function go(step){var i=VARIANTS.findIndex(function(x){return x.key===current();});var n=VARIANTS[(i+step+VARIANTS.length)%VARIANTS.length].key;root.dataset.variant=n;var u=new URL(location.href);u.searchParams.set("variant",n);try{history.replaceState(null,"",u.toString());}catch(e){}fixLinks();render();if(window.__drawCharts)window.__drawCharts();window.scrollTo(0,0);}
var bar=document.createElement("div");bar.id="proto-bar";bar.setAttribute("role","toolbar");bar.setAttribute("aria-label","Prototype variant switcher");
bar.innerHTML='<button type="button" aria-label="Previous variant" data-step="-1">&#8592;</button><span class="lbl" aria-live="polite"></span><button type="button" aria-label="Next variant" data-step="1">&#8594;</button><button type="button" class="theme" aria-label="Cycle colour theme"></button>';
document.body.appendChild(bar);
bar.addEventListener("click",function(e){var b=e.target.closest("button");if(!b)return;if(b.classList.contains("theme")){var order=["auto","light","dark"];var t=order[(order.indexOf(root.dataset.theme||"auto")+1)%3];if(t==="auto")delete root.dataset.theme;else root.dataset.theme=t;try{if(t==="auto")localStorage.removeItem("proto-theme");else localStorage.setItem("proto-theme",t);}catch(err){}render();return;}go(Number(b.dataset.step));});
document.addEventListener("keydown",function(e){var el=document.activeElement;if(el&&(el.tagName==="INPUT"||el.tagName==="TEXTAREA"||el.isContentEditable))return;if(e.altKey||e.ctrlKey||e.metaKey)return;if(e.key==="ArrowLeft")go(-1);else if(e.key==="ArrowRight")go(1);});
fixLinks();render();
var tip=document.createElement("div");tip.id="tip";tip.setAttribute("role","tooltip");document.body.appendChild(tip);
function show(el,x,y){tip.innerHTML=el.getAttribute("data-tip");tip.classList.add("on");var r=tip.getBoundingClientRect();var nx=Math.min(x+14,window.innerWidth-r.width-8);var ny=y-r.height-12;if(ny<8)ny=y+16;tip.style.left=Math.max(8,nx)+"px";tip.style.top=ny+"px";}
document.addEventListener("mousemove",function(e){var el=e.target.closest&&e.target.closest("[data-tip]");if(el)show(el,e.clientX,e.clientY);else tip.classList.remove("on");});
document.addEventListener("focusin",function(e){var el=e.target.closest&&e.target.closest("[data-tip]");if(el){var r=el.getBoundingClientRect();show(el,r.left+r.width/2,r.top);}});
document.addEventListener("focusout",function(){tip.classList.remove("on");});
document.addEventListener("click",function(e){var th=e.target.closest("table.data th");if(!th)return;var table=th.closest("table");var idx=Array.prototype.indexOf.call(th.parentNode.children,th);var body=table.tBodies[0];var rows=Array.prototype.slice.call(body.rows);var dir=th.dataset.dir==="asc"?"desc":"asc";th.parentNode.querySelectorAll("th").forEach(function(h){delete h.dataset.dir;});th.dataset.dir=dir;rows.sort(function(a,b){var x=a.cells[idx].dataset.sort||a.cells[idx].textContent,y=b.cells[idx].dataset.sort||b.cells[idx].textContent;var nx=parseFloat(x),ny=parseFloat(y);var c=(!isNaN(nx)&&!isNaN(ny))?nx-ny:String(x).localeCompare(String(y));return dir==="asc"?c:-c;});rows.forEach(function(r){body.appendChild(r);});});
})();`;

/** One complete page: the three variants' bodies, side by side in the DOM, one shown. */
export function page(title: string, bodies: { A: string; B: string; C: string }, css: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<script>${HEAD_SCRIPT}</script>
<style>${BASE_CSS}${css}</style>
</head>
<body>
<!-- PROTOTYPE: throwaway report redesign. Three variants; ?variant=A|B|C picks one. -->
<div class="variant" data-v="A">${bodies.A}</div>
<div class="variant" data-v="B">${bodies.B}</div>
<div class="variant" data-v="C">${bodies.C}</div>
<script>${CHART_SCRIPT}</script>
<script>${BODY_SCRIPT}</script>
</body>
</html>
`;
}
