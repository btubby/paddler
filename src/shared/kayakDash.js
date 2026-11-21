// Kayaks dashing across the screen in all directions, while a page loads.
//
// One source for two places:
//   - every page's HTML (vite.config.js puts it inside <div id="app">), shown from the first
//     moment until the page's Vue app starts and replaces it. It fades in after a quarter of
//     a second, so a quick load never flashes it.
//   - KayakDash.vue, for loading inside a page (a paddler's results being read, say).
// Plain HTML and CSS (no script), so it runs before anything else has loaded. With reduced
// motion asked for, the kayaks stay still.

// each kayak: where it starts and ends (% of the width / height: off the edge on each side), how long a
// crossing takes (s), when it starts (s), its colour and size
const K = [
  { from: [-12, 18], to: [112, 26], t: 3.6, d: 0, c: '#e3a91c', s: 1 },
  { from: [112, 62], to: [-12, 54], t: 4.2, d: 0.6, c: '#c1602e', s: 0.9 },
  { from: [30, -14], to: [38, 114], t: 4.8, d: 1.1, c: '#1f5c56', s: 0.85 },
  { from: [72, 114], to: [64, -14], t: 4.4, d: 0.3, c: '#2f7ea8', s: 0.95 },
  { from: [-12, 92], to: [112, 8], t: 5.2, d: 1.8, c: '#d9483b', s: 0.8 },
  { from: [112, 4], to: [-12, 96], t: 5.6, d: 2.4, c: '#7b5ea7', s: 0.75 },
  { from: [-12, 42], to: [112, 40], t: 2.9, d: 2.0, c: '#f2b705', s: 1.1 },
  { from: [112, 84], to: [-12, 80], t: 3.3, d: 3.0, c: '#3e6b35', s: 0.9 },
  { from: [50, -14], to: [44, 114], t: 3.9, d: 3.4, c: '#e3a91c', s: 0.8 }
]
// the angle to point each kayak along its path (width and height taken as about the same:
// close enough for a dash across the screen)
const angle = k => Math.round(Math.atan2(k.to[1] - k.from[1], k.to[0] - k.from[0]) * 180 / Math.PI)

// a kayak seen from above, pointing right: hull, cockpit, paddler, a paddle that swings,
// and a wake
const kayak = (k, i) => `<span class="kd__k" style="--fx:${k.from[0]};--fy:${k.from[1]};--tx:${k.to[0]};--ty:${k.to[1]};--a:${angle(k)}deg;--t:${k.t}s;--d:-${k.d}s;--s:${k.s};color:${k.c}">` +
  '<svg viewBox="-40 -14 170 68" aria-hidden="true">' +
  '<path class="kd__wake" d="M4 20 L-36 6 M4 20 L-36 34 M-6 20 L-30 20" />' +
  '<path d="M2 20 Q30 7 62 7 Q96 7 118 20 Q96 33 62 33 Q30 33 2 20 Z" fill="currentColor" />' +
  '<path d="M10 20 Q36 12 62 12 Q90 12 110 20" fill="none" stroke="rgba(255,255,255,.35)" stroke-width="2" />' +
  '<ellipse cx="62" cy="20" rx="13" ry="7.5" fill="#1d2a28" opacity=".55" />' +
  `<g class="kd__paddle" style="animation-delay:-${(i * 0.13).toFixed(2)}s"><line x1="62" y1="-8" x2="62" y2="48" stroke="#2b2b2b" stroke-width="2.6" stroke-linecap="round" />` +
  '<ellipse cx="62" cy="-9" rx="3.4" ry="7" fill="#2b2b2b" /><ellipse cx="62" cy="49" rx="3.4" ry="7" fill="#2b2b2b" /></g>' +
  '<circle cx="62" cy="20" r="6" fill="#f0c49a" stroke="#1d2a28" stroke-width="1.2" />' +
  '</svg></span>'

export const kayakDashCss = `
.kd { position: fixed; inset: 0; z-index: 50; overflow: hidden; pointer-events: none; display: grid; place-items: center; container-type: size;
  background: radial-gradient(ellipse at 50% 40%, #eaf3f1, #cfe2de); opacity: 0; animation: kd-in .35s .25s ease-out forwards; }
.kd--inline { position: relative; inset: auto; z-index: auto; height: 220px; margin: 12px 0 18px; border-radius: 8px;
  background: linear-gradient(180deg, #e3eeeb, #cfe2de); }
.kd__k { position: absolute; left: 0; top: 0; width: calc(96px * var(--s)); animation: kd-go var(--t) linear var(--d) infinite; will-change: transform; }
.kd--inline .kd__k { width: calc(70px * var(--s)); }
.kd__k svg { display: block; width: 100%; height: auto; overflow: visible; }
.kd__wake { fill: none; stroke: #fff; stroke-width: 2.4; stroke-linecap: round; opacity: .75; }
.kd__paddle { transform-origin: 62px 20px; transform-box: view-box; animation: kd-paddle .55s ease-in-out infinite alternate; }
.kd__msg { position: relative; z-index: 1; margin: 0; padding: 10px 18px; border-radius: 999px; background: #fff;
  color: #123430; font: 600 15px/1.3 Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; box-shadow: 0 4px 16px rgba(0,0,0,.08); text-align: center; max-width: 80%; }
@keyframes kd-in { to { opacity: 1; } }
/* positions in % of the box (cqw / cqh: the .kd box, the whole screen for a page) */
@keyframes kd-go {
  from { transform: translate(calc(var(--fx) * 1cqw), calc(var(--fy) * 1cqh)) rotate(var(--a)); }
  to { transform: translate(calc(var(--tx) * 1cqw), calc(var(--ty) * 1cqh)) rotate(var(--a)); }
}
@keyframes kd-paddle { from { transform: rotate(-28deg); } to { transform: rotate(28deg); } }
@media (prefers-reduced-motion: reduce) {
  .kd__k, .kd__paddle { animation: none; }
  .kd__k { transform: translate(calc((var(--fx) + var(--tx)) * .5cqw), calc((var(--fy) + var(--ty)) * .5cqh)) rotate(var(--a)); }
}
`

// the whole thing, as HTML: inline: true for a box inside a page (KayakDash.vue)
export function kayakDashHtml({ inline = false, message = 'Loading…' } = {}) {
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
  return `<div class="kd${inline ? ' kd--inline' : ''}" role="status" aria-live="polite">` +
    K.map(kayak).join('') + `<p class="kd__msg">${esc(message)}</p></div>`
}
