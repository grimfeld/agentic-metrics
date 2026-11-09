// PROTOTYPE (throwaway). Charts as inline SVG, no library, no network.
// Sparklines are drawn at build time (they carry no text). Charts with text
// are drawn in the page from embedded JSON, at the container's own width, so
// their labels stay 11–13px from phone to desktop. Every chart has a hover /
// focus tooltip, and the page beside it keeps a table view.
import { escapeHtml } from "../../cli/metrics/html.ts";

export interface Column {
  label: string;
  /** Second, muted line under the label: the coverage. */
  sub?: string;
  /** null: unknown (or withheld). Drawn as text, never as a zero bar. */
  value: number | null;
  text: string;
  tip: string;
}

export interface HBar {
  label: string;
  /** `l-full`, `l-assisted`, `l-manual`, or empty for the single-series colour. */
  cls?: string;
  value: number | null;
  text: string;
  sub?: string;
  tip: string;
}

export type ChartSpec =
  | { type: "columns"; points: Column[]; height?: number; labelEvery?: number; valueLabels?: "all" | "ends" | "max" }
  | { type: "hbars"; rows: HBar[] };

/** A chart placeholder the page script renders; `label` is its accessible name. */
export function chart(spec: ChartSpec, label: string): string {
  return `<div class="viz" role="img" aria-label="${escapeHtml(label)}" data-chart="${escapeHtml(JSON.stringify(spec))}"></div>`;
}

/** A 120×32 sparkline: values over time, gaps where unknown, end dot. */
export function sparkline(values: (number | null)[], tips: string[]): string {
  const known = values.filter((v): v is number => v !== null);
  if (known.length === 0) return `<span class="cov">no trend</span>`;
  const w = 120, h = 32, pad = 5;
  const max = Math.max(...known), min = Math.min(0, ...known);
  const x = (i: number) => (values.length === 1 ? w / 2 : pad + (i * (w - 2 * pad)) / (values.length - 1));
  const y = (v: number) => (max === min ? h / 2 : h - pad - ((v - min) / (max - min)) * (h - 2 * pad));
  const segments: string[] = [];
  let current: string[] = [];
  values.forEach((v, i) => {
    if (v === null) {
      if (current.length) segments.push(current.join(" "));
      current = [];
    } else current.push(`${x(i).toFixed(1)},${y(v).toFixed(1)}`);
  });
  if (current.length) segments.push(current.join(" "));
  const lines = segments.map((pts) => `<polyline class="line" points="${pts}"/>`).join("");
  const dots = values
    .map((v, i) =>
      v === null
        ? ""
        : `<circle class="dot" cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="${i === values.length - 1 ? 3.5 : 0}"/><rect class="hit" x="${(x(i) - 8).toFixed(1)}" y="0" width="16" height="${h}" data-tip="${escapeHtml(tips[i] ?? "")}"/>`,
    )
    .join("");
  return `<svg class="chart spark" viewBox="0 0 ${w} ${h}" aria-hidden="true">${lines}${dots}</svg>`;
}

/** The page-side renderer for `chart()` placeholders. Plain JS, inlined into every page. */
export const CHART_SCRIPT = `(function(){
var NS="http://www.w3.org/2000/svg";
function el(n,a,t){var e=document.createElementNS(NS,n);for(var k in a)e.setAttribute(k,a[k]);if(t!==undefined)e.textContent=t;return e;}
function esc(s){return String(s);}
function topRound(x,y,w,h,r){r=Math.min(r,w/2,h);return "M"+x+","+(y+h)+"V"+(y+r)+"Q"+x+","+y+" "+(x+r)+","+y+"H"+(x+w-r)+"Q"+(x+w)+","+y+" "+(x+w)+","+(y+r)+"V"+(y+h)+"Z";}
function rightRound(x,y,w,h,r){r=Math.min(r,h/2,w);return "M"+x+","+y+"H"+(x+w-r)+"Q"+(x+w)+","+y+" "+(x+w)+","+(y+r)+"V"+(y+h-r)+"Q"+(x+w)+","+(y+h)+" "+(x+w-r)+","+(y+h)+"H"+x+"Z";}
function nice(max){if(max<=0)return 1;var p=Math.pow(10,Math.floor(Math.log10(max)));var m=max/p;var s=m<=1?1:m<=2?2:m<=5?5:10;return s*p;}
function columns(box,spec){
  var W=box.clientWidth||320,H=spec.height||200,pts=spec.points,n=pts.length;
  var hasSub=pts.some(function(p){return p.sub;});
  var top=22,bottom=hasSub?40:24,left=4,right=4,ph=H-top-bottom;
  var known=pts.filter(function(p){return p.value!==null;}).map(function(p){return p.value;});
  var max=nice(Math.max.apply(null,known.concat([0])));
  var band=(W-left-right)/n,bw=Math.max(2,Math.min(24,band*0.62));
  var svg=el("svg",{class:"chart",viewBox:"0 0 "+W+" "+H,width:W,height:H});
  [0.5,1].forEach(function(f){var y=top+ph-ph*f;svg.appendChild(el("line",{class:"grid",x1:left,x2:W-right,y1:y,y2:y}));});
  svg.appendChild(el("line",{class:"base",x1:left,x2:W-right,y1:top+ph,y2:top+ph}));
  var every=spec.labelEvery||Math.max(1,Math.ceil(n/Math.max(1,Math.floor(W/56))));
  var maxIdx=-1,mv=-Infinity;pts.forEach(function(p,i){if(p.value!==null&&p.value>mv){mv=p.value;maxIdx=i;}});
  var lastKnown=-1;pts.forEach(function(p,i){if(p.value!==null)lastKnown=i;});
  var firstKnown=pts.findIndex(function(p){return p.value!==null;});
  var mode=spec.valueLabels||(n<=8?"all":"max");
  pts.forEach(function(p,i){
    var cx=left+band*i+band/2,x=cx-bw/2;
    if(p.value===null){svg.appendChild(el("text",{x:cx,y:top+ph-6,"text-anchor":"middle",class:"t-unknown"},"unknown"));}
    else{var h=max?ph*p.value/max:0;if(p.value>0)h=Math.max(h,2);svg.appendChild(el("path",{class:"bar",d:topRound(x,top+ph-h,bw,h,4)}));
      var show=mode==="all"||(mode==="max"&&(i===maxIdx||i===lastKnown))||(mode==="ends"&&(i===firstKnown||i===lastKnown));
      if(show)svg.appendChild(el("text",{x:cx,y:top+ph-h-6,"text-anchor":"middle",class:"t-ink"},p.text));}
    if(i%every===0||n<=8){svg.appendChild(el("text",{x:cx,y:top+ph+15,"text-anchor":"middle",class:"t-ink2"},p.label));
      if(p.sub)svg.appendChild(el("text",{x:cx,y:top+ph+30,"text-anchor":"middle"},p.sub));}
    var hit=el("rect",{class:"hit",x:left+band*i,y:top-18,width:band,height:ph+18,tabindex:0,"data-tip":p.tip,"aria-label":p.label+": "+p.text});
    svg.appendChild(hit);
  });
  box.appendChild(svg);
}
function hbars(box,spec){
  var W=box.clientWidth||320,rows=spec.rows,rh=36,narrow=W<460;
  var labelW=narrow?0:Math.min(130,W*0.26),textW=narrow?120:170;
  var H=rows.length*(narrow?rh+16:rh)+4;
  var known=rows.filter(function(r){return r.value!==null;}).map(function(r){return r.value;});
  var max=Math.max.apply(null,known.concat([0]))||1;
  var x0=labelW+(narrow?0:8),pw=Math.max(40,W-x0-textW);
  var svg=el("svg",{class:"chart",viewBox:"0 0 "+W+" "+H,width:W,height:H});
  rows.forEach(function(r,i){
    var y=i*(narrow?rh+16:rh)+(narrow?16:0),bh=18,by=y+(rh-bh)/2;
    if(narrow)svg.appendChild(el("text",{x:0,y:y-2,class:"t-ink2"},r.label));
    else svg.appendChild(el("text",{x:labelW,y:by+13,"text-anchor":"end",class:"t-ink2"},r.label));
    svg.appendChild(el("line",{class:"base",x1:x0,x2:x0,y1:by-4,y2:by+bh+4}));
    var tx=x0+6;
    if(r.value!==null){var w=pw*r.value/max;if(r.value>0)w=Math.max(w,2);if(w>0)svg.appendChild(el("path",{class:"bar "+(r.cls||""),d:rightRound(x0,by,w,bh,4)}));tx=x0+w+8;
      var t=el("text",{x:tx,y:by+13,class:"t-ink"});t.textContent=r.text;svg.appendChild(t);
      if(r.sub){var s=el("tspan",{dx:8},r.sub);t.appendChild(s);}}
    else{var u=el("text",{x:tx,y:by+13,class:"t-unknown"},"unknown");if(r.sub)u.appendChild(el("tspan",{dx:8},r.sub));svg.appendChild(u);}
    svg.appendChild(el("rect",{class:"hit",x:0,y:y-(narrow?16:0),width:W,height:rh+(narrow?16:0),tabindex:0,"data-tip":r.tip,"aria-label":r.label+": "+r.text}));
  });
  box.appendChild(svg);
}
function draw(){document.querySelectorAll(".viz").forEach(function(box){if(!box.offsetParent)return;var w=box.clientWidth;if(box._w===w)return;box._w=w;box.innerHTML="";var spec=JSON.parse(box.getAttribute("data-chart"));if(spec.type==="columns")columns(box,spec);else hbars(box,spec);});}
window.__drawCharts=draw;document.addEventListener("toggle",function(){draw();},true);
draw();var t;window.addEventListener("resize",function(){clearTimeout(t);t=setTimeout(draw,80);});
})();`;
