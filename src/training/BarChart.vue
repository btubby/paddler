<script setup>
// Stacked bars: one bar per week (or month), split by series. Hover or tab to a bar for the
// numbers; the same numbers are in the table below each chart for screen readers.
import { computed, ref } from 'vue'

const props = defineProps({
  bars: { type: Array, required: true }, // [{ key, label, tick, year, values: { [series]: n } }]
  series: { type: Array, required: true }, // [{ key, label, color }]
  unit: { type: Function, required: true }, // n -> text
  title: { type: String, required: true }
})
const W = 760, H = 240
const M = { left: 52, right: 10, top: 12, bottom: 44 }
const max = computed(() => Math.max(1e-9, ...props.bars.map(b => props.series.reduce((s, x) => s + (b.values[x.key] || 0), 0))))
const nice = computed(() => {
  const raw = max.value / 4
  const p = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map(k => k * p).find(s => s >= raw)
  return { step, top: Math.ceil(max.value / step) * step }
})
const bw = computed(() => (W - M.left - M.right) / Math.max(1, props.bars.length))
const y = v => H - M.bottom - (v / nice.value.top) * (H - M.top - M.bottom)
const stacks = computed(() => props.bars.map((b, i) => {
  let acc = 0
  const parts = props.series.map(s => {
    const v = b.values[s.key] || 0
    const part = { key: s.key, color: s.color, y: y(acc + v), h: y(acc) - y(acc + v) }
    acc += v
    return part
  }).filter(p => p.h > 0.2)
  return { ...b, x: M.left + i * bw.value, total: acc, parts }
}))
const grid = computed(() => { const out = []; for (let v = 0; v <= nice.value.top + 1e-9; v += nice.value.step) out.push(v); return out })
const hover = ref(null)
</script>

<template>
  <figure class="bars">
    <svg :viewBox="`0 0 ${W} ${H}`" role="img" :aria-label="title">
      <g v-for="v in grid" :key="v">
        <line :x1="M.left" :x2="W - M.right" :y1="y(v)" :y2="y(v)" class="bars__grid" />
        <text :x="M.left - 8" :y="y(v) + 4" text-anchor="end" class="bars__axis">{{ unit(v) }}</text>
      </g>
      <g v-for="(b, i) in stacks" :key="b.key" class="bars__bar" tabindex="0" @mouseenter="hover = i" @mouseleave="hover = null" @focus="hover = i" @blur="hover = null">
        <rect :x="b.x" :y="M.top" :width="bw" :height="H - M.top - M.bottom" fill="transparent" />
        <rect v-for="p in b.parts" :key="p.key" :x="b.x + bw * 0.12" :width="Math.max(1, bw * 0.76)" :y="p.y" :height="p.h" :fill="p.color" />
        <text v-if="b.tick" :x="b.x + bw / 2" :y="H - M.bottom + 18" text-anchor="middle" class="bars__axis">{{ b.tick }}</text>
        <text v-if="b.year" :x="b.x + bw / 2" :y="H - M.bottom + 33" text-anchor="middle" class="bars__axis bars__axis--year">{{ b.year }}</text>
      </g>
    </svg>
    <div v-if="hover != null" class="bars__tip" :style="{ left: `${((stacks[hover].x + bw / 2) / W) * 100}%` }">
      <strong>{{ stacks[hover].label }}</strong>
      <span v-for="s in series" v-show="stacks[hover].values[s.key]" :key="s.key"><i :style="{ background: s.color }" />{{ s.label }}: {{ unit(stacks[hover].values[s.key]) }}</span>
      <span v-if="series.length > 1">Total: {{ unit(stacks[hover].total) }}</span>
    </div>
    <figcaption class="legend">
      <span v-for="s in series" :key="s.key"><i :style="{ background: s.color }" />{{ s.label }}</span>
    </figcaption>
  </figure>
</template>

<style scoped>
.bars { position: relative; margin: 0; }
.bars svg { width: 100%; height: auto; display: block; overflow: visible; }
.bars__grid { stroke: var(--line); stroke-width: 1; }
.bars__axis { fill: var(--muted); font: 11px var(--font-body); }
.bars__axis--year { font-weight: 700; fill: var(--heading); }
.bars__bar { outline: none; cursor: default; }
.bars__bar:hover rect:not([fill='transparent']), .bars__bar:focus rect:not([fill='transparent']) { opacity: 0.8; }
.bars__tip { position: absolute; top: 0; transform: translateX(-50%); background: var(--teal-deep); color: #fff; padding: 8px 10px; border-radius: 6px; font-size: 0.8rem; display: grid; gap: 2px; pointer-events: none; white-space: nowrap; z-index: 2; }
.bars__tip i, .legend i { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 6px; vertical-align: -1px; }
.legend { display: flex; flex-wrap: wrap; gap: 6px 16px; margin-top: 6px; font-size: 0.82rem; color: var(--muted); }
</style>
