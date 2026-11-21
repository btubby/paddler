<script setup>
// Session by session over time: one dot per session (size: how far or how long), coloured by
// kind of training, with a smoothed trend line. Used for paddling speed and heart rate.
import { computed, ref } from 'vue'

const props = defineProps({
  points: { type: Array, required: true }, // [{ id, date, y, size (0..1), color, tip: [lines] }]
  trend: { type: Array, default: () => [] }, // [{ date, y }]
  unit: { type: String, required: true }, // axis label, e.g. 'km/h'
  title: { type: String, required: true },
  legend: { type: Array, default: () => [] } // [{ label, color }]
})
const W = 760, H = 260
const M = { left: 52, right: 14, top: 12, bottom: 44 }
const ts = d => Date.parse(d)
const dom = computed(() => {
  const xs = props.points.map(p => ts(p.date))
  const ks = props.points.map(p => p.y).sort((a, b) => a - b)
  // the middle 96%, so one glitch doesn't squash the rest
  const lo = ks[Math.floor(ks.length * 0.02)], hi = ks[Math.ceil(ks.length * 0.98) - 1]
  const span = hi - lo || 1
  const step = niceStep(span / 4)
  return { x0: Math.min(...xs) - 5 * 864e5, x1: Math.max(...xs) + 5 * 864e5, y0: Math.floor((lo - span * 0.08) / step) * step, y1: Math.ceil((hi + span * 0.08) / step) * step, step }
})
function niceStep(raw) {
  const p = 10 ** Math.floor(Math.log10(raw))
  return [1, 2, 2.5, 5, 10].map(k => k * p).find(s => s >= raw)
}
const x = d => M.left + ((ts(d) - dom.value.x0) / (dom.value.x1 - dom.value.x0)) * (W - M.left - M.right)
const y = k => M.top + (1 - (Math.min(dom.value.y1, Math.max(dom.value.y0, k)) - dom.value.y0) / (dom.value.y1 - dom.value.y0)) * (H - M.top - M.bottom)
const grid = computed(() => {
  const out = []
  for (let v = dom.value.y0; v <= dom.value.y1 + 1e-9; v += dom.value.step) out.push(+v.toFixed(2))
  return out
})
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
// month ticks, with the year under the first one and under each January
const ticks = computed(() => {
  const span = (dom.value.x1 - dom.value.x0) / (30.4 * 864e5)
  const step = span <= 8 ? 1 : span <= 26 ? 3 : 6
  const out = []
  const d = new Date(dom.value.x0)
  let yr = d.getUTCFullYear(), m = d.getUTCMonth() + 1
  for (;;) {
    if (m > 11) { m = 0; yr++ }
    const date = `${yr}-${String(m + 1).padStart(2, '0')}-01`
    if (ts(date) > dom.value.x1) break
    if (m % step === 0) out.push({ date, label: MONTHS[m], year: !out.length || m === 0 ? String(yr) : '' })
    m++
  }
  return out
})
const line = computed(() => props.trend.map((p, i) => `${i ? 'L' : 'M'}${x(p.date).toFixed(1)},${y(p.y).toFixed(1)}`).join(' '))
const hover = ref(null)
</script>

<template>
  <figure class="dots">
    <svg :viewBox="`0 0 ${W} ${H}`" role="img" :aria-label="title">
      <g v-for="v in grid" :key="v">
        <line :x1="M.left" :x2="W - M.right" :y1="y(v)" :y2="y(v)" class="dots__grid" />
        <text :x="M.left - 8" :y="y(v) + 4" text-anchor="end" class="dots__axis">{{ v }}</text>
      </g>
      <text :x="12" :y="M.top + (H - M.top - M.bottom) / 2" class="dots__axis" :transform="`rotate(-90 12 ${M.top + (H - M.top - M.bottom) / 2})`" text-anchor="middle">{{ unit }}</text>
      <g v-for="t in ticks" :key="t.date">
        <text :x="x(t.date)" :y="H - M.bottom + 18" text-anchor="middle" class="dots__axis">{{ t.label }}</text>
        <text v-if="t.year" :x="x(t.date)" :y="H - M.bottom + 33" text-anchor="middle" class="dots__axis dots__axis--year">{{ t.year }}</text>
      </g>
      <circle v-for="(p, i) in points" :key="p.id" :cx="x(p.date)" :cy="y(p.y)" :r="2.5 + (p.size ?? 0.3) * 5" class="dots__dot" :class="{ on: hover === i }" :style="{ '--c': p.color }" tabindex="0"
        @mouseenter="hover = i" @mouseleave="hover = null" @focus="hover = i" @blur="hover = null" />
      <path :d="line" class="dots__trend" />
    </svg>
    <div v-if="hover != null" class="dots__tip" :style="{ left: `${(x(points[hover].date) / W) * 100}%`, top: `${(y(points[hover].y) / H) * 100}%` }">
      <strong>{{ points[hover].tip[0] }}</strong>
      <span v-for="(l, k) in points[hover].tip.slice(1)" :key="k">{{ l }}</span>
    </div>
    <figcaption class="legend">
      <span v-for="l in legend" :key="l.label"><i class="dot" :style="{ background: l.color }" />{{ l.label }}</span>
      <span v-if="trend.length"><i class="bar" />Trend</span>
    </figcaption>
  </figure>
</template>

<style scoped>
.dots { position: relative; margin: 0; }
.dots svg { width: 100%; height: auto; display: block; overflow: visible; }
.dots__grid { stroke: var(--line); }
.dots__axis { fill: var(--muted); font: 11px var(--font-body); }
.dots__axis--year { font-weight: 700; fill: var(--heading); }
.dots__dot { fill: var(--c, var(--teal)); fill-opacity: 0.35; stroke: var(--c, var(--teal)); stroke-width: 1; outline: none; }
.dots__dot.on { fill-opacity: 0.9; stroke-width: 2; }
.dots__trend { fill: none; stroke: var(--gold); stroke-width: 3; stroke-linecap: round; pointer-events: none; }
.dots__tip { position: absolute; transform: translate(-50%, calc(-100% - 12px)); background: var(--teal-deep); color: #fff; padding: 8px 10px; border-radius: 6px; font-size: 0.8rem; display: grid; gap: 2px; pointer-events: none; white-space: nowrap; z-index: 2; }
.legend { display: flex; flex-wrap: wrap; gap: 6px 16px; margin-top: 6px; font-size: 0.82rem; color: var(--muted); }
.legend i { display: inline-block; margin-right: 6px; vertical-align: middle; }
.legend .dot { width: 10px; height: 10px; border-radius: 50%; opacity: 0.7; }
.legend .bar { width: 18px; height: 3px; background: var(--gold); }
</style>
