<script setup>
// While the race results are read for the first time (a few minutes) and the ratings
// worked out: a strip of the homepage river. The lead boat (a club racer, bright yellow)
// paddles towards the finish buoy as the races are read: halfway down the course is
// halfway through the races. Other boats paddle along either side of it. Once every race is
// read and the ratings are being worked out, the lead boat keeps doing laps of the course.
// Every boat keeps to its own lane, with its paddles clear of the banks. Tap the water for ripples,
// like on the homepage. With reduced motion: a still picture and a progress bar.
// Used on the paddler page, the race planner and the board (K2 pairs).
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import Kayaker from '../home/components/Kayaker.vue'

const props = defineProps({
  progress: { type: Number, default: null }, // 0-1, or null when not known yet
  working: { type: Boolean, default: false }, // all read: working out the ratings
  message: { type: String, default: '' }
})

const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
const box = ref(null)
const width = ref(640)
const H = 150 // strip height; the water runs from y 34 to 116
// the water runs from about y 22 to 127; boats are about 42 wide across the paddles, so
// lanes at 48 and 104 keep the blades off the banks, and the lead boat has 76 to itself
const LANES = [48, 76, 104]

// the other boats
const LOOKS = [
  { type: 'k1', hull: '#e63946', deck: '#ffd166', shirt: '#1d3557', helmet: '#f1faee' },
  { type: 'k2', hull: '#3a86ff', deck: '#fb8500', shirt: '#023047', helmet: '#e63946', design: 'wave' },
  { type: 'racer', hull: '#ffffff', deck: '#e63946', shirt: '#3a86ff', helmet: '#ffbe0b', design: 'carbon' },
  { type: 'c1', hull: '#06d6a0', deck: '#ffffff', shirt: '#ef476f', helmet: '#ffd166' }
]
const LENGTH = { k1: 58, racer: 70, k2: 80, c1: 66 }
const BOX = { k1: 170, racer: 200, k2: 240, c1: 210 }
// two lanes either side of the lead boat's; boats in a lane keep the same speed and spacing,
// so they never run into each other (the lead boat has the middle of the river to itself)
const boats = ref(LOOKS.map((look, i) => ({
  id: i,
  look: { ...look, stroke: 0.55 + i * 0.07, delay: -i * 0.3 },
  dir: 1,
  y: [LANES[0], LANES[2], LANES[0], LANES[2]][i],
  x: [40, 120, 420, 520][i],
  speed: [30, 22, 30, 22][i]
})))
const lead = { type: 'racer', hull: '#ffd400', deck: '#ffd400', shirt: '#1f5c56', helmet: '#ffffff', stroke: 0.5 }
const lap = ref(40) // while the ratings are worked out: the lead boat doing laps
const leadX = computed(() => {
  if (props.working) return lap.value
  const start = 40
  const finish = width.value - 70
  const p = Math.max(0, Math.min(1, props.progress ?? 0.02))
  return start + p * (finish - start)
})
const pct = computed(() => (props.progress == null ? null : Math.round(props.progress * 100)))

// a boat drawn bow-first in the direction it's going (Kayaker draws bow up)
const boatStyle = (type, x, y, dir) => {
  const len = LENGTH[type]
  const w = (len * 120) / BOX[type]
  return { left: x + 'px', top: y + 'px', width: w + 'px', height: len + 'px', transform: `translate(-50%, -50%) rotate(${dir > 0 ? 90 : -90}deg)` }
}

// ripples where the water is tapped
const ripples = ref([])
let rid = 0
function tap(e) {
  const r = box.value?.getBoundingClientRect()
  if (!r) return
  const x = e.clientX - r.left
  const y = e.clientY - r.top
  if (y < 24 || y > 126) return
  const id = ++rid
  ripples.value.push({ id, x, y })
  setTimeout(() => { ripples.value = ripples.value.filter(p => p.id !== id) }, 1600)
}

let raf = 0
let last = 0
function frame(t) {
  const dt = last ? Math.min(0.05, (t - last) / 1000) : 0
  last = t
  for (const b of boats.value) {
    b.x += b.dir * b.speed * dt
    if (b.dir > 0 && b.x > width.value + 60) b.x = -60
    if (b.dir < 0 && b.x < -60) b.x = width.value + 60
  }
  if (props.working) {
    lap.value += 70 * dt
    if (lap.value > width.value + 50) lap.value = -50
  }
  raf = requestAnimationFrame(frame)
}
let ro = null
onMounted(() => {
  if (box.value) {
    width.value = box.value.clientWidth || 640
    ro = new ResizeObserver(() => { width.value = box.value?.clientWidth || width.value })
    ro.observe(box.value)
  }
  if (!reduced) raf = requestAnimationFrame(frame)
})
onBeforeUnmount(() => { cancelAnimationFrame(raf); ro?.disconnect() })
</script>

<template>
  <figure class="lr" :class="{ 'lr--still': reduced }" role="status" aria-live="polite">
    <div ref="box" class="lr__scene" @pointerdown="tap">
      <svg class="lr__land" :viewBox="`0 0 ${width} ${H}`" preserveAspectRatio="none" aria-hidden="true">
        <!-- banks, the water, and reeds along the edges -->
        <rect x="0" y="0" :width="width" :height="H" fill="#7fae5a" />
        <path :d="`M0 22 Q ${width * 0.25} 17 ${width * 0.5} 22 T ${width} 20 V 129 Q ${width * 0.7} 134 ${width * 0.45} 128 T 0 130 Z`" fill="#3f8fc7" />
        <path :d="`M0 22 Q ${width * 0.25} 17 ${width * 0.5} 22 T ${width} 20`" stroke="#cbe3b0" stroke-width="3" fill="none" opacity="0.7" />
        <g fill="#4f7d36">
          <circle v-for="n in Math.ceil(width / 46)" :key="'r' + n" :cx="n * 46 - 20" :cy="9 + (n % 3) * 2" :r="4 + (n % 2) * 2" />
          <circle v-for="n in Math.ceil(width / 58)" :key="'s' + n" :cx="n * 58 - 31" :cy="140 + (n % 2) * 3" :r="5 + (n % 3)" />
        </g>
        <!-- the finish: a buoy and a flag on the bank -->
        <g :transform="`translate(${width - 52} 0)`">
          <line x1="20" y1="1" x2="20" y2="19" stroke="#5b4a3a" stroke-width="2" />
          <path d="M20 2 L36 6 L20 10 Z" fill="#c1602e" />
          <!-- the finish line across the river, between two buoys -->
          <line x1="12" y1="34" x2="12" y2="118" stroke="#ffffff" stroke-width="1.5" stroke-dasharray="4 5" opacity="0.6" />
          <circle cx="12" cy="31" r="6" fill="#ff7a00" stroke="#fff" stroke-width="2" />
          <circle cx="12" cy="121" r="6" fill="#ff7a00" stroke="#fff" stroke-width="2" />
        </g>
      </svg>
      <div class="lr__waves" aria-hidden="true"></div>

      <div v-for="r in ripples" :key="r.id" class="lr__ripple" :style="{ left: r.x + 'px', top: r.y + 'px' }" aria-hidden="true"></div>

      <!-- the other boats -->
      <div v-for="b in boats" :key="b.id" class="lr__boat" :style="boatStyle(b.look.type, b.x, b.y, b.dir)" aria-hidden="true">
        <Kayaker v-bind="b.look" />
      </div>

      <!-- the lead boat: how far through the races; once they're all read, doing laps -->
      <div class="lr__boat lr__boat--lead" :class="{ 'lr__boat--laps': working }" :style="boatStyle('racer', leadX, LANES[1], 1)" aria-hidden="true">
        <Kayaker v-bind="lead" />
      </div>
    </div>

    <figcaption class="lr__text">
      <span class="lr__msg">{{ message || (working ? 'Working out everyone\'s ratings: a few more laps…' : 'Reading the race results…') }}</span>
      <span v-if="!working && pct != null" class="lr__pct">{{ pct }}%</span>
    </figcaption>
    <div v-if="reduced && !working && pct != null" class="lr__bar" aria-hidden="true"><span :style="{ width: pct + '%' }"></span></div>
  </figure>
</template>

<style scoped>
.lr { margin: 12px 0 18px; }
.lr__scene { position: relative; height: 150px; overflow: hidden; border-radius: 8px; border: 1.5px solid var(--line, #d8d2c2); cursor: pointer; touch-action: manipulation; }
.lr__land { position: absolute; inset: 0; width: 100%; height: 100%; }
.lr__waves {
  position: absolute; left: 0; right: 0; top: 26px; height: 98px; opacity: 0.35; pointer-events: none;
  background: repeating-linear-gradient(100deg, transparent 0 34px, rgba(255, 255, 255, 0.55) 34px 36px, transparent 36px 70px);
  animation: lr-flow 6s linear infinite;
}
@keyframes lr-flow { from { background-position: 0 0; } to { background-position: -140px 0; } }
.lr__boat { position: absolute; pointer-events: none; }
.lr__boat--laps { transition: none !important; }
.lr__boat--lead { transition: left 1.2s ease-out; z-index: 2; filter: drop-shadow(0 0 4px rgba(255, 255, 255, 0.7)); }
.lr__ripple { position: absolute; width: 10px; height: 10px; margin: -5px 0 0 -5px; border: 2px solid rgba(255, 255, 255, 0.85); border-radius: 50%; animation: lr-ripple 1.6s ease-out forwards; pointer-events: none; }
@keyframes lr-ripple { to { transform: scale(9); opacity: 0; } }
.lr__text { display: flex; justify-content: space-between; gap: 12px; margin-top: 6px; font-size: 0.86rem; color: var(--muted, #5b6662); }
.lr__pct { font-weight: 700; color: var(--heading, #123430); font-variant-numeric: tabular-nums; }
.lr__bar { height: 6px; margin-top: 6px; border-radius: 3px; background: var(--mist, #e7e2d4); overflow: hidden; }
.lr__bar span { display: block; height: 100%; background: var(--teal, #1f5c56); }
.lr--still .lr__waves, .lr--still :deep(*) { animation: none !important; transition: none !important; }
</style>
