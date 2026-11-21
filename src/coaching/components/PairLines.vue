<script setup>
// Draws a line between the cards of K2 partners: everyone who has raced a K2 together
// (all results), thicker the more races they've done together and solid if they raced
// together in the last year. Sits over the board without blocking clicks or drags, and
// redraws whenever cards move, the window resizes, or the list of pairs changes.
import { ref, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'

const props = defineProps({
  pairs: { type: Array, required: true }, // [{ a: id, b: id, races, last: 'YYYY-MM-DD' }, ...]
  container: { type: Object, default: null }, // element the lines are drawn over
  names: { type: Object, default: null } // id -> name, for the race list's heading
})

const lines = ref([])
const hover = ref(null) // the race list shown for the number under the mouse: { x, y, line }
const size = ref({ w: 0, h: 0 })
let frame = 0
let resizeObs = null
let mutationObs = null

// point on the edge of a card, facing the other card
function edgePoint(r, towards) {
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2
  const dx = towards.x - cx, dy = towards.y - cy
  if (Math.abs(dx) * r.height > Math.abs(dy) * r.width) return { x: dx > 0 ? r.right : r.left, y: cy }
  return { x: cx, y: dy > 0 ? r.bottom : r.top }
}

function draw() {
  frame = 0
  const box = props.container
  if (!box) return
  const base = box.getBoundingClientRect()
  size.value = { w: box.scrollWidth, h: box.scrollHeight }
  const find = id => box.querySelector(`[data-member-id="${CSS.escape(String(id))}"]`)
  const nameOf = id => props.names?.[id] || ''
  const out = []
  const yearAgo = new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10)
  for (const x of props.pairs) {
    const { a, b } = x
    const ea = find(a), eb = find(b)
    if (!ea || !eb) continue
    const ra = ea.getBoundingClientRect(), rb = eb.getBoundingClientRect()
    const ca = { x: ra.left + ra.width / 2, y: ra.top + ra.height / 2 }
    const cb = { x: rb.left + rb.width / 2, y: rb.top + rb.height / 2 }
    const p1 = edgePoint(ra, cb), p2 = edgePoint(rb, ca)
    const x1 = p1.x - base.left, y1 = p1.y - base.top, x2 = p2.x - base.left, y2 = p2.y - base.top
    // gentle curve, bowed sideways so lines between neighbours don't sit on the cards
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2
    const len = Math.hypot(x2 - x1, y2 - y1) || 1
    const bow = Math.min(40, len * 0.15)
    const qx = mx - ((y2 - y1) / len) * bow, qy = my + ((x2 - x1) / len) * bow
    const races = x.races || 1
    out.push({
      key: `${a}-${b}`, d: `M ${x1} ${y1} Q ${qx} ${qy} ${x2} ${y2}`, x1, y1, x2, y2,
      width: Math.min(6, 1.5 + Math.log2(races) * 1.2),
      recent: !x.last || x.last >= yearAgo,
      // the label sits on the curve's midpoint
      lx: (x1 + 2 * qx + x2) / 4, ly: (y1 + 2 * qy + y2) / 4,
      races,
      names: [nameOf(a), nameOf(b)],
      list: x.list || []
    })
  }
  lines.value = out
}
const schedule = () => { if (!frame) frame = requestAnimationFrame(draw) }

function observe(el) {
  resizeObs?.disconnect(); mutationObs?.disconnect()
  if (!el) return
  resizeObs = new ResizeObserver(schedule)
  resizeObs.observe(el)
  mutationObs = new MutationObserver(schedule)
  mutationObs.observe(el, { childList: true, subtree: true })
  schedule()
}

onMounted(() => {
  window.addEventListener('resize', schedule)
  observe(props.container)
})
onBeforeUnmount(() => {
  window.removeEventListener('resize', schedule)
  resizeObs?.disconnect(); mutationObs?.disconnect()
  if (frame) cancelAnimationFrame(frame)
})
watch(() => props.container, el => observe(el))

// the list stays up while the mouse moves from the number onto it (to scroll a long one)
let hideTimer = 0
function show(l) {
  clearTimeout(hideTimer)
  hover.value = { x: l.lx, y: l.ly, line: l }
}
const keep = () => clearTimeout(hideTimer)
function hideSoon() {
  hideTimer = setTimeout(() => { hover.value = null }, 200)
}

// "1st of 6", "4th of 8"; no place (DNF etc.): "finished"
function place(r) {
  if (!r.pos) return 'finished'
  const n = r.pos
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? 'th' : { 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th'
  return `${n}${suffix}${r.of ? ' of ' + r.of : ''}`
}
watch(() => props.pairs, () => nextTick(schedule), { deep: true })
</script>

<template>
  <div class="pairs-wrap">
  <svg class="pairs" :width="size.w" :height="size.h" aria-hidden="true">
    <g v-for="l in lines" :key="l.key">
      <path :d="l.d" class="pairs__line" :class="{ 'pairs__line--old': !l.recent }" :style="{ strokeWidth: l.width }" />
      <g
        v-if="l.races > 1 || l.list.length"
        class="pairs__count"
        :class="{ 'pairs__count--one': l.races === 1 }"
        :tabindex="l.list.length ? 0 : -1"
        @mouseenter="show(l)"
        @mouseleave="hideSoon"
        @focus="show(l)"
        @blur="hover = null"
      >
        <circle :cx="l.lx" :cy="l.ly" :r="l.races === 1 ? 7 : 9" />
        <text :x="l.lx" :y="l.ly">{{ l.races }}</text>
      </g>
      <circle :cx="l.x1" :cy="l.y1" r="3" class="pairs__dot" />
      <circle :cx="l.x2" :cy="l.y2" r="3" class="pairs__dot" />
    </g>
  </svg>
  <!-- the races the pair did together, for the number under the mouse -->
  <div
    v-if="hover && hover.line.list.length"
    class="pairs__tip"
    :class="{ 'pairs__tip--left': hover.x > size.w - 400, 'pairs__tip--up': hover.y > size.h - 280 && hover.y > 280 }"
    :style="{ left: hover.x + 'px', top: hover.y + 'px' }"
    role="tooltip"
    @mouseenter="keep"
    @mouseleave="hover = null"
  >
    <strong>{{ hover.line.names.filter(Boolean).join(' & ') || 'K2' }}: {{ hover.line.races }} K2 race{{ hover.line.races === 1 ? '' : 's' }}</strong>
    <ol>
      <li v-for="(r, i) in hover.line.list.slice(0, 30)" :key="i">
        <span class="tip__year">{{ r.date.slice(0, 4) }}</span>
        <span class="tip__race">{{ r.race }}<template v-if="r.venue"> ({{ r.venue }})</template> · {{ r.event }}</span>
        <span class="tip__place" :class="{ 'tip__place--win': r.pos === 1 }">{{ place(r) }}</span>
      </li>
    </ol>
    <p v-if="hover.line.list.length > 30" class="tip__more">and {{ hover.line.list.length - 30 }} more</p>
  </div>
  </div>
</template>

<style scoped>
.pairs-wrap { position: absolute; inset: 0; pointer-events: none; z-index: 2; }
.pairs {
  position: absolute;
  inset: 0;
  pointer-events: none; /* never gets in the way of clicks or drag and drop */
  z-index: 2;
  overflow: visible;
}
.pairs__line {
  fill: none;
  stroke: var(--heading);
  stroke-width: 2;
  stroke-linecap: round;
  opacity: 0.55;
}
/* not raced together in the last year: dashed and fainter */
.pairs__line--old { stroke-dasharray: 5 4; opacity: 0.3; }
.pairs__count { pointer-events: auto; cursor: help; outline: none; }
.pairs__count circle { fill: var(--surface); stroke: var(--heading); stroke-width: 1.2; opacity: 0.95; }
.pairs__count:hover circle, .pairs__count:focus circle { fill: var(--heading); }
.pairs__count:hover text, .pairs__count:focus text { fill: var(--surface); }
.pairs__count--one circle { opacity: 0.75; }
.pairs__count--one text { font-size: 9px; }
.pairs__tip {
  position: absolute;
  z-index: 40;
  transform: translate(14px, -14px); /* below and to the right of the number */
  width: 380px;
  max-height: 360px;
  overflow: auto;
  padding: 10px 12px;
  border-radius: 6px;
  background: var(--teal-deep);
  color: #fff;
  font-size: 0.78rem;
  line-height: 1.35;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
  pointer-events: auto;
}
.pairs__tip--left { transform: translate(calc(-100% - 14px), -14px); }
.pairs__tip--up { transform: translate(14px, calc(-100% + 14px)); }
.pairs__tip--left.pairs__tip--up { transform: translate(calc(-100% - 14px), calc(-100% + 14px)); }
.pairs__tip strong { display: block; margin-bottom: 6px; font-size: 0.82rem; }
.pairs__tip ol { list-style: none; margin: 0; padding: 0; display: grid; gap: 3px; }
.pairs__tip li { display: grid; grid-template-columns: 38px 1fr auto; gap: 8px; align-items: baseline; }
.tip__year { opacity: 0.7; font-variant-numeric: tabular-nums; }
.tip__place { white-space: nowrap; font-weight: 600; }
.tip__place--win { color: #ffd400; }
.tip__more { margin: 6px 0 0; opacity: 0.7; }
.pairs__count text { font: 600 10px var(--font-body); fill: var(--heading); text-anchor: middle; dominant-baseline: central; }
.pairs__dot { fill: var(--heading); opacity: 0.7; }
</style>
