<script setup>
// How a paddler's racing has changed over time: each race as a dot on the division
// ladder (quicker is higher), a smoothed trend line, and the division they raced in.
// Hover (or tab to) a dot for the race. The results table below the chart has the same
// numbers for anyone who can't use the chart.
//
// On a phone (narrow) the chart is drawn at a fixed width per month, so it's bigger than
// the screen and scrolls sideways (swipe), starting at the newest race; the division labels
// stay put on the left. There's no mouse, so a tap picks the nearest race and its details
// show in a panel under the chart, with buttons to step race by race (the chart follows).
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ownDivision, divLabel, divRank, COURSES, describeForm } from './insights.js'

const props = defineProps({
  words: { type: Object, default: () => ({ one: 'K1', two: 'K2' }) }, // C1 / C2 for canoe results
  points: { type: Array, required: true }, // [{ date, level, k2, odd, race, pos, of, t, div, partner }]
  trend: { type: Array, required: true }, // [{ date, level }]
  describe: { type: Function, required: true },
  notes: { type: Object, default: () => ({}) }, // comments on their results: a list for each result (rid)
  // where each division sits on the ladder (children's divisions below div 9: insights.js scaleFor)
  scale: { type: Object, default: null },
  place: { type: Function, required: true }
})

const ts = d => Date.parse(d)

// how wide the chart has to fit: a phone gets the scrolling chart
const root = ref(null)
const boxWidth = ref(800)
let ro = null
onMounted(() => {
  if (typeof ResizeObserver === 'undefined' || !root.value) return
  ro = new ResizeObserver(([e]) => { boxWidth.value = e.contentRect.width })
  ro.observe(root.value)
  boxWidth.value = root.value.getBoundingClientRect().width || 800
})
onBeforeUnmount(() => ro?.disconnect())
const compact = computed(() => boxWidth.value < 640)
const AXIS_W = 64 // the fixed division labels on a phone
const PER_MONTH = 46 // px per month on a phone
const span = computed(() => {
  const xs = props.points.map(p => ts(p.date))
  return { a: Math.min(...xs), b: Math.max(...xs) }
})
const M = computed(() => (compact.value ? { left: 10, right: 22, top: 26, bottom: 44 } : { left: 74, right: 18, top: 16, bottom: 48 }))
const W = computed(() => {
  if (!compact.value) return 760
  const months = (span.value.b - span.value.a) / (30.4 * 864e5) + 2
  return Math.max(boxWidth.value - AXIS_W, Math.round(months * PER_MONTH) + M.value.left + M.value.right)
})
const H = computed(() => (compact.value ? 330 : 320))

const domain = computed(() => {
  const xs = props.points.map(p => ts(p.date))
  const ys = [...props.points.filter(p => !p.odd).map(p => p.level), ...props.trend.map(p => p.level),
    ...props.points.map(p => rankY(ownDivision(p))).filter(d => d != null)]
  const x0 = Math.min(...xs), x1 = Math.max(...xs)
  const pad = Math.max(30 * 864e5, (x1 - x0) * 0.03)
  const y0 = Math.floor(Math.min(...ys) - 0.3), y1 = Math.ceil(Math.max(...ys) + 0.3)
  return { x0: x0 - pad, x1: x1 + pad, y0: Math.max(0, y0), y1: Math.min(13, y1) }
})
const x = d => M.value.left + ((ts(d) - domain.value.x0) / (domain.value.x1 - domain.value.x0)) * (W.value - M.value.left - M.value.right)
// quicker (lower level) at the top
const y = l => M.value.top + ((Math.min(domain.value.y1, Math.max(domain.value.y0, l)) - domain.value.y0) / (domain.value.y1 - domain.value.y0)) * (H.value - M.value.top - M.value.bottom)

// a division's place on the ladder: div 1-9 at 1-9; GSA, GSB, GSC below, where the scale puts them
const noteText = rid => props.notes[rid].map(c => (c.unfair ? 'Not a fair result. ' : '') + c.text).filter(Boolean).join(' · ')
const rankY = r => (r == null ? null : r <= 9 ? r : props.scale ? props.scale.rankLevel(r) : r)
// the division lines (and labels) in view: { y, label }
const divLines = computed(() => {
  const out = []
  for (let r = 1; r <= 12; r++) {
    const v = rankY(r)
    if (v >= domain.value.y0 - 0.01 && v <= domain.value.y1 + 0.01) out.push({ y: v, label: r <= 9 ? 'Div ' + r : divLabel(r) })
  }
  return out
})
const years = computed(() => {
  const out = []
  const a = new Date(domain.value.x0).getUTCFullYear() + 1, b = new Date(domain.value.x1).getUTCFullYear()
  const step = b - a > 8 ? 2 : 1
  for (let yr = a; yr <= b; yr += step) out.push(yr)
  return out
})
// month ticks: every month for a short history, every 3 or 6 months for longer ones
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const months = computed(() => {
  const span = (domain.value.x1 - domain.value.x0) / (30.4 * 864e5)
  const step = compact.value || span <= 18 ? 1 : span <= 48 ? 3 : 6
  const out = []
  const d = new Date(domain.value.x0)
  let yr = d.getUTCFullYear(), m = d.getUTCMonth() + 1
  for (;;) {
    if (m > 11) { m = 0; yr++ }
    const date = `${yr}-${String(m + 1).padStart(2, '0')}-01`
    if (Date.parse(date) > domain.value.x1) break
    if (m % step === 0 && m !== 0) out.push({ date, label: MONTHS[m] })
    m++
  }
  return out
})
const trendPath = computed(() => props.trend.map((p, i) => `${i ? 'L' : 'M'}${x(p.date).toFixed(1)} ${y(p.level).toFixed(1)}`).join(' '))
// the division raced in, as steps
const divPath = computed(() => {
  let d = ''
  let prev = null
  let left = null // the division just promoted out of: a later result can still list it
  for (const p of props.points) {
    const r = ownDivision(p)
    if (r != null && r === left) continue
    left = null
    const v = rankY(r)
    if (v == null) continue
    const px = x(p.date).toFixed(1), py = y(v).toFixed(1)
    d += prev == null ? `M${px} ${py}` : `H${px} V${py}`
    prev = v
    // promoted at this race: up to the new division from here
    const up = p.promo && !p.promo.inferred ? rankY(divRank(p.promo.to)) : null
    if (up != null) { d += `V${y(up).toFixed(1)}`; prev = up; left = r }
  }
  if (prev != null) d += `H${(W.value - M.value.right).toFixed(1)}`
  return d
})

const hover = ref(null)
const svg = ref(null)
const scroller = ref(null)
// dot size shows the course length (other races: in between)
const R = { short: 3.3, medium: 4.6, long: 6, other: 4 }
const radius = p => R[p.course] || R.other
// the dot nearest the pointer (within a few px, more for a finger), in chart units
function nearestTo(e, reach) {
  const m = svg.value?.getScreenCTM()
  if (!m) return null
  const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse())
  let best = null, bestD = reach * reach
  for (const p of props.points) {
    const dx = x(p.date) - pt.x, dy = y(p.level) - pt.y
    const d = dx * dx + dy * dy
    if (d < bestD) { bestD = d; best = p }
  }
  return best
}
// a tap that misses every dot still picks the closest race along the time axis
function nearestInTime(e) {
  const m = svg.value?.getScreenCTM()
  if (!m || !props.points.length) return null
  const px = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse()).x
  let best = null, bestD = Infinity
  for (const p of props.points) {
    const d = Math.abs(x(p.date) - px)
    if (d < bestD) { bestD = d; best = p }
  }
  return best
}
function nearest(e) {
  if (compact.value || e.pointerType === 'touch') return
  hover.value = nearestTo(e, 14)
}
function onTap(e) {
  if (compact.value || e.pointerType === 'touch') {
    // a phone: a tap picks the nearest race; its details are under the chart
    const p = nearestTo(e, 34) || nearestInTime(e)
    if (p) { pick(props.points.indexOf(p), false); nextTick(maybeHint) }
    return
  }
  const url = hover.value && resultUrl(hover.value)
  if (url) window.open(url, '_blank', 'noopener')
}

// ---- a nudge when the details have appeared below the screen -----------------------------
const pickPanel = ref(null)
const hint = ref(false)
let hintTimer = null
function hideHint() { hint.value = false; clearTimeout(hintTimer) }
function maybeHint() {
  const el = pickPanel.value
  if (!el) return
  const r = el.getBoundingClientRect()
  // the top of the details is below the bottom of the screen (or nearly): say so
  if (r.top > window.innerHeight - 90) {
    hint.value = true
    clearTimeout(hintTimer)
    hintTimer = setTimeout(hideHint, 6000)
  } else hideHint()
}
function showDetails() {
  const still = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
  pickPanel.value?.scrollIntoView({ behavior: still ? 'auto' : 'smooth', block: 'center' })
  hideHint()
}
// the hint goes once the person scrolls down to the details themselves
function onPageScroll() { if (hint.value && pickPanel.value && pickPanel.value.getBoundingClientRect().top < window.innerHeight - 90) hideHint() }
onMounted(() => window.addEventListener('scroll', onPageScroll, { passive: true }))
onBeforeUnmount(() => { window.removeEventListener('scroll', onPageScroll); clearTimeout(hintTimer) })

// ---- the phone's picked race ------------------------------------------------------------
const picked = ref(null) // index into points
const sel = computed(() => (picked.value != null ? props.points[picked.value] : null))
function pick(i, follow = true) {
  if (i < 0 || i >= props.points.length) return
  picked.value = i
  if (follow) nextTick(() => centre(props.points[i]))
}
// scroll the chart so a race is in view (in the middle where it can be)
function centre(p, smooth = true) {
  const el = scroller.value
  if (!el || !p) return
  const want = x(p.date) - el.clientWidth / 2
  const still = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
  el.scrollTo({ left: Math.max(0, want), behavior: smooth && !still ? 'smooth' : 'auto' })
}
// start at the newest race, with it picked
watch([compact, () => props.points], async ([c]) => {
  if (!c) return
  picked.value = props.points.length ? props.points.length - 1 : null
  await nextTick()
  if (scroller.value) scroller.value.scrollLeft = scroller.value.scrollWidth
  onScroll()
}, { immediate: true })
// older races are off to the left: a fade and a hint say so while there is more to see
const moreLeft = ref(false)
function onScroll() {
  const el = scroller.value
  moreLeft.value = !!el && compact.value && el.scrollLeft > 12
}

// a plain-words summary for anyone using a screen reader (and under the chart for everyone)
const summary = computed(() => {
  const pts = props.points
  if (!pts.length) return ''
  const last = pts[pts.length - 1]
  const tr = props.trend
  let trend = ''
  if (tr.length > 1) {
    const d = tr[tr.length - 1].level - tr[0].level // a lower level is quicker
    trend = Math.abs(d) < 0.3 ? 'The trend is level.' : d < 0 ? 'The trend is getting quicker.' : 'The trend is getting slower.'
  }
  const promos = pts.filter(p => p.promo).length
  return `${pts.length} race${pts.length === 1 ? '' : 's'} from ${fmtDate(pts[0].date)} to ${fmtDate(last.date)}. ${trend} Latest: ${last.race}, ${fmtDate(last.date)}, raced like ${props.describe(last.level)}.${promos ? ` Promoted ${promos === 1 ? 'once' : promos + ' times'}.` : ''}`
})

const BASE = 'https://entries.canoemarathon.org.uk'
const resultUrl = p => (p.url ? BASE + p.url + (p.tab ? '#race-' + p.tab : '') : undefined)
const fmtTime = s => `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
const fmtDate = d => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
const divText = d => divLabel(d)
</script>

<template>
  <figure ref="root" class="chart" :class="{ 'chart--compact': compact }">
    <div class="chart__legend">
      <span><svg width="14" height="14"><circle cx="7" cy="7" r="4.5" class="dot" /></svg> {{ words.one }} race</span>
      <span><svg width="14" height="14"><circle cx="7" cy="7" r="4" class="dot dot--k2" /></svg> {{ words.two }} race</span>
      <span><svg width="22" height="14"><path d="M1 7 H21" class="trend" /></svg> Trend</span>
      <span v-if="points.some(p => p.promo)"><svg width="16" height="16"><circle cx="8" cy="9" r="5.5" class="promo-ring" /><path d="M8 0.5 L11 4 H5 Z" class="promo-arrow" /></svg> Promoted</span>
      <span><svg width="22" height="14"><path d="M1 7 H21" class="divline" /></svg> Division raced</span>
      <span class="chart__sizes" title="Dot size shows the course: Hasler divisions 7–9 race the short course, 4–6 the medium, 1–3 the long one">
        <svg width="46" height="16"><circle cx="5" cy="8" :r="R.short" class="dot" /><circle cx="18" cy="8" :r="R.medium" class="dot" /><circle cx="35" cy="8" :r="R.long" class="dot" /></svg>
        Short / medium / long course
      </span>
    </div>
    <div class="chart__frame">
      <!-- a phone: the division labels stay put while the chart scrolls -->
      <svg v-if="compact" class="chart__axis" :width="AXIS_W" :height="H" aria-hidden="true">
        <text v-for="d in divLines" :key="'a' + d.label" :x="AXIS_W - 6" :y="y(d.y)" class="axis axis--y">{{ d.label }}</text>
        <text :x="AXIS_W - 6" :y="10" class="axis axis--y axis--quick">quicker ↑</text>
      </svg>
      <div ref="scroller" class="chart__box" :class="{ 'chart__box--scroll': compact, 'chart__box--more': moreLeft }" @scroll.passive="onScroll">
        <svg ref="svg" :viewBox="`0 0 ${W} ${H}`" class="chart__svg" :style="compact ? { width: W + 'px', height: H + 'px' } : null" role="group" aria-label="Race results over time on the division ladder: each dot is one race, quicker is higher">
          <!-- axis title: the lines are speeds (a typical paddler of each division), not the division raced -->
          <text v-if="!compact" :transform="`translate(14 ${(M.top + H - M.bottom) / 2}) rotate(-90)`" class="axis axis--title">Speed (typical division) · quicker ↑</text>
          <!-- division grid: quicker at the top -->
          <g v-for="d in divLines" :key="'d' + d.label">
            <line :x1="M.left" :x2="W - M.right" :y1="y(d.y)" :y2="y(d.y)" class="grid" />
            <text v-if="!compact" :x="M.left - 8" :y="y(d.y)" class="axis axis--y">{{ d.label }}</text>
          </g>
          <g v-for="mo in months" :key="mo.date">
            <line :x1="x(mo.date)" :x2="x(mo.date)" :y1="H - M.bottom" :y2="H - M.bottom + 4" class="tick" />
            <text :x="x(mo.date)" :y="H - M.bottom + 15" class="axis axis--x axis--month">{{ mo.label }}</text>
          </g>
          <g v-for="yr in years" :key="'y' + yr">
            <line :x1="x(`${yr}-01-01`)" :x2="x(`${yr}-01-01`)" :y1="M.top" :y2="H - M.bottom + 6" class="grid grid--x" />
            <text :x="x(`${yr}-01-01`)" :y="H - M.bottom + 15" class="axis axis--x axis--jan">Jan</text>
            <text :x="x(`${yr}-01-01`)" :y="H - M.bottom + 31" class="axis axis--x axis--year">{{ yr }}</text>
          </g>
          <path :d="divPath" class="divline" />
          <path :d="trendPath" class="trend" />
          <!-- the picked race (phone): a line down to the axis -->
          <line v-if="compact && sel" :x1="x(sel.date)" :x2="x(sel.date)" :y1="M.top - 8" :y2="H - M.bottom" class="pickline" />
          <!-- each dot links to that race's result on the marathon results site (keyboard: Tab, Enter) -->
          <a
            v-for="(p, i) in points"
            :key="i"
            class="hit"
            :href="resultUrl(p)"
            target="_blank"
            rel="noopener"
            :aria-label="`${p.race}, ${fmtDate(p.date)}: open the result`"
            @focus="compact ? pick(i) : (hover = p)"
            @blur="hover = null"
          >
            <circle :cx="x(p.date)" :cy="y(p.level)" :r="radius(p) + (hover === p || sel === p ? (compact ? 3 : 1.5) : 0)" class="dot" :class="{ 'dot--k2': p.k2, 'dot--odd': p.odd, 'dot--picked': compact && sel === p }" />
            <!-- a note on this result: a small dark mark beside the dot -->
            <circle v-if="notes[p.rid]" :cx="x(p.date) + radius(p) + 1" :cy="y(p.level) - radius(p) - 1" r="3" class="note-mark" aria-hidden="true" />
            <!-- promoted at this race: a gold ring, and an arrow above -->
            <g v-if="p.promo" class="promo" :class="{ 'promo--inferred': p.promo.inferred }" aria-hidden="true">
              <circle :cx="x(p.date)" :cy="y(p.level)" :r="radius(p) + 3.5" class="promo-ring" />
              <path :d="`M${x(p.date)} ${y(p.level) - radius(p) - 13} l4.5 6 h-9 Z`" class="promo-arrow" />
            </g>
          </a>
          <!-- the pointer: the dot nearest it is the one shown and opened (dots close
               together would otherwise catch each other's clicks); on a phone, the one picked -->
          <rect
            :x="M.left" :y="0" :width="W - M.left - M.right" :height="H - M.bottom + 4"
            class="overlay" :class="{ 'overlay--on': hover }"
            @pointermove="nearest"
            @pointerleave="hover = null"
            @click="onTap"
          />
        </svg>
        <div
          v-if="hover && !compact"
          class="chart__tip"
          :style="{ left: (x(hover.date) / W) * 100 + '%', top: (y(hover.level) / H) * 100 + '%' }"
          :class="{ 'chart__tip--left': x(hover.date) > W * 0.6 }"
          role="tooltip"
        >
          <strong>{{ hover.race }}</strong>
          <span>{{ fmtDate(hover.date) }} · {{ hover.event }}<template v-if="hover.partner"> with {{ hover.partner }}</template></span>
          <span v-if="hover.course">{{ COURSES[hover.course].label }} ({{ COURSES[hover.course].divs }})<template v-if="hover.t"> · {{ fmtTime(hover.t) }}</template></span>
          <span v-else-if="hover.t">{{ fmtTime(hover.t) }}</span>
          <span>{{ place(hover) }}<template v-if="hover.div"> in {{ divLabel(hover.div) }}</template></span>
          <span v-if="hover.promo" class="chart__promo">▲ Promoted to {{ divText(hover.promo.to) }}<template v-if="hover.promo.inferred"> (worked out: their next K1 was in {{ divText(hover.promo.to) }})</template></span>
          <span>Raced like {{ describe(hover.level) }}<template v-if="hover.odd"> (well off their usual: counts little in the trend)</template></span>
          <span v-if="hover.vsForm != null" class="chart__form" :class="{ good: hover.vsForm <= -1, bad: hover.vsForm >= 1 }">{{ describeForm(hover.vsForm) }}</span>
          <span v-if="notes[hover.rid]" class="chart__note">📝 {{ noteText(hover.rid) }}</span>
          <em v-if="hover.url">Click to see the result</em>
        </div>
      </div>
    </div>

    <!-- a tap picked a race but its details are below the screen: a nudge to scroll down -->
    <Transition name="hint">
      <button v-if="hint && compact" type="button" class="hint" @click="showDetails">Race details are below ↓</button>
    </Transition>

    <p v-if="summary" class="chart__summary"><span class="chart__sumtext">{{ summary }}</span> <a href="#all-results">See every result in the table</a></p>

    <!-- a phone: the picked race, and stepping from race to race -->
    <div v-if="compact && sel" ref="pickPanel" class="pick" aria-live="polite">
      <div class="pick__nav">
        <button type="button" class="pick__btn" :disabled="picked === 0" aria-label="Older race" @click="pick(picked - 1)">‹</button>
        <span class="pick__count">Race {{ picked + 1 }} of {{ points.length }}<small>{{ moreLeft ? '← swipe for older races · tap a dot' : 'tap a dot or swipe the chart' }}</small></span>
        <button type="button" class="pick__btn" :disabled="picked === points.length - 1" aria-label="Newer race" @click="pick(picked + 1)">›</button>
      </div>
      <strong class="pick__race">{{ sel.race }}</strong>
      <span class="pick__line">{{ fmtDate(sel.date) }} · {{ sel.event }}<template v-if="sel.partner"> with {{ sel.partner }}</template></span>
      <div class="pick__facts">
        <span><small>Result</small>{{ place(sel) }}<template v-if="sel.div"> in {{ divLabel(sel.div) }}</template></span>
        <span v-if="sel.t"><small>Time</small>{{ fmtTime(sel.t) }}</span>
        <span><small>Raced like</small>{{ describe(sel.level) }}</span>
        <span v-if="sel.course"><small>Course</small>{{ COURSES[sel.course].label }}</span>
      </div>
      <span v-if="sel.promo" class="pick__promo">▲ Promoted to {{ divText(sel.promo.to) }}<template v-if="sel.promo.inferred"> (worked out: their next K1 was in {{ divText(sel.promo.to) }})</template></span>
      <span v-if="sel.vsForm != null" class="pick__form" :class="{ good: sel.vsForm <= -1, bad: sel.vsForm >= 1 }">{{ describeForm(sel.vsForm) }}</span>
      <span v-if="notes[sel.rid]" class="pick__note">📝 {{ noteText(sel.rid) }}</span>
      <span v-if="sel.odd" class="pick__odd">Well off their usual: counts little in the trend</span>
      <a v-if="resultUrl(sel)" :href="resultUrl(sel)" target="_blank" rel="noopener" class="pick__open">See the full result ↗</a>
    </div>
  </figure>
</template>

<style scoped>
.chart { margin: 0; }
.chart__legend { display: flex; flex-wrap: wrap; gap: 6px 18px; font-size: 0.82rem; color: var(--muted); margin-bottom: 6px; }
.chart__legend span { display: inline-flex; align-items: center; gap: 6px; }
.chart__frame { display: flex; }
.chart__box { position: relative; flex: 1; min-width: 0; }
.chart__box--scroll { overflow-x: auto; overflow-y: hidden; -webkit-overflow-scrolling: touch; overscroll-behavior-x: contain; scrollbar-width: thin; }
.chart__axis { flex: none; display: block; background: var(--surface); box-shadow: 4px 0 6px -4px rgba(0, 0, 0, 0.18); position: relative; z-index: 1; }
.chart__svg { display: block; width: 100%; height: auto; overflow: visible; }
.chart__box--scroll .chart__svg { max-width: none; overflow: hidden; }
.grid { stroke: var(--line); stroke-width: 1; }
.grid--x { stroke-dasharray: 2 4; }
.axis { font: 500 11px var(--font-body); fill: var(--muted); }
.chart--compact .axis { font-size: 12.5px; }
.axis--y { text-anchor: end; dominant-baseline: central; }
.axis--quick { font-size: 9.5px; font-weight: 600; }
.chart--compact .axis--quick { font-size: 11px; }
.axis--x { text-anchor: middle; }
.axis--month, .axis--jan { font-size: 10px; }
.chart--compact .axis--month, .chart--compact .axis--jan { font-size: 11.5px; }
.axis--year { font-weight: 600; fill: var(--ink); }
.tick { stroke: var(--line); stroke-width: 1; }
.axis--title { text-anchor: middle; dominant-baseline: central; font-weight: 600; }
.trend { fill: none; stroke: var(--clay); stroke-width: 2.5; stroke-linejoin: round; stroke-linecap: round; }
.divline { fill: none; stroke: var(--muted); stroke-width: 1.5; stroke-dasharray: 5 4; opacity: 0.8; }
.dot { fill: var(--teal); stroke: var(--surface); stroke-width: 2; }
.dot--k2 { fill: var(--surface); stroke: var(--teal); stroke-width: 2; }
.dot--odd { opacity: 0.35; }
.dot--picked { stroke: var(--heading); stroke-width: 3; }
.pickline { stroke: var(--heading); stroke-width: 1; stroke-dasharray: 2 3; opacity: 0.6; }
.hit { outline: none; }
.overlay { fill: transparent; touch-action: pan-x pan-y; }
.overlay--on { cursor: pointer; }
.hit:focus-visible .dot { stroke: var(--heading); stroke-width: 3; }
.chart__tip {
  position: absolute;
  transform: translate(14px, -50%);
  display: grid;
  gap: 2px;
  min-width: 220px;
  max-width: 300px;
  padding: 8px 10px;
  border-radius: 6px;
  background: var(--teal-deep);
  color: #fff;
  font-size: 0.8rem;
  line-height: 1.35;
  pointer-events: none;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.25);
  z-index: 5;
}
.chart__tip--left { transform: translate(calc(-100% - 14px), -50%); }
.chart__tip span { opacity: 0.9; }
.chart__tip em { font-style: normal; font-size: 0.74rem; opacity: 0.7; margin-top: 2px; }
.chart__form { font-weight: 600; }
.chart__form.good { color: #8fe3c8; }
.chart__form.bad { color: #f5b59a; }
.note-mark { fill: var(--heading); stroke: #fff; stroke-width: 1; }
.chart__note, .pick__note { font-style: italic; }
.promo-ring { fill: none; stroke: var(--gold); stroke-width: 2.2; }
.promo--inferred .promo-ring { stroke-dasharray: 3 2.5; }
.promo-arrow { fill: var(--gold); stroke: none; }
.chart__promo { font-weight: 700; color: #ffd166; }

/* the nudge: floats at the bottom of the screen for a few seconds */
.hint { position: fixed; left: 50%; bottom: 18px; transform: translateX(-50%); z-index: 20; padding: 12px 20px; border: 0; border-radius: 999px; background: var(--gold); color: var(--heading); font: 700 0.95rem var(--font-body); box-shadow: 0 6px 18px rgba(0, 0, 0, 0.3); cursor: pointer; }
.hint:focus-visible { outline: 3px solid var(--heading); outline-offset: 2px; }
.hint-enter-active, .hint-leave-active { transition: opacity 0.2s, transform 0.2s; }
.hint-enter-from, .hint-leave-to { opacity: 0; transform: translate(-50%, 10px); }
@media (prefers-reduced-motion: reduce) { .hint-enter-active, .hint-leave-active { transition: none; } }

/* a phone */
.chart--compact .chart__legend { gap: 4px 12px; font-size: 0.8rem; }
.chart__box--more { -webkit-mask-image: linear-gradient(to right, transparent 0, #000 28px); mask-image: linear-gradient(to right, transparent 0, #000 28px); }
.chart__summary { margin: 8px 0 0; font-size: 0.82rem; color: var(--muted); line-height: 1.4; }
.chart__summary a { color: var(--heading); font-weight: 600; white-space: nowrap; }
.chart--compact .chart__sizes { display: none; }
.pick { display: grid; gap: 4px; margin-top: 10px; padding: 12px 14px; border-radius: 8px; background: var(--teal-deep); color: #fff; }
.pick__nav { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 4px; }
.pick__btn { width: 52px; height: 46px; border-radius: 8px; border: 1.5px solid rgba(255, 255, 255, 0.35); background: rgba(255, 255, 255, 0.08); color: #fff; font: 700 1.5rem/1 var(--font-body); cursor: pointer; }
.pick__btn:disabled { opacity: 0.3; }
.pick__btn:focus-visible { outline: 3px solid var(--gold); outline-offset: 2px; }
.pick__count { display: grid; text-align: center; font-size: 0.8rem; font-weight: 600; opacity: 0.9; }
.pick__count small { font-weight: 400; opacity: 0.75; font-size: 0.72rem; }
.pick__race { font-size: 1.02rem; line-height: 1.25; }
.pick__line { font-size: 0.84rem; opacity: 0.85; }
.pick__facts { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 12px; margin: 6px 0 2px; }
.pick__facts span { display: grid; font-size: 0.9rem; font-weight: 600; }
.pick__facts small { font-size: 0.7rem; font-weight: 500; opacity: 0.7; text-transform: uppercase; letter-spacing: 0.05em; }
.pick__promo { font-weight: 700; color: #ffd166; font-size: 0.88rem; }
.pick__form { font-weight: 600; font-size: 0.88rem; }
.pick__form.good { color: #8fe3c8; }
.pick__form.bad { color: #f5b59a; }
.pick__odd { font-size: 0.8rem; opacity: 0.75; }
.pick__open { justify-self: start; margin-top: 4px; color: #fff; font-weight: 600; font-size: 0.88rem; }
</style>
