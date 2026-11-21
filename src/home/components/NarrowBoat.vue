<script setup>
// A narrowboat seen from above, bow up, in a 120 x 520 box (same box as TYPES.narrowboat
// in swarm.js, whose collision footprint follows the longest hull). Each one is different:
// see makeBoatLook() in ../narrowboatLook.js for the paint, length, stern and roof clutter.
import { computed } from 'vue'

const props = defineProps({
  hull: { type: String, default: '#1f4d3a' }, // painted cabin sides
  panel: { type: String, default: '#b8322c' }, // contrasting coachline / bow panels
  roof: { type: String, default: '#e9dfc4' },
  trim: { type: String, default: '#c9a227' },
  len: { type: Number, default: 500 }, // bow to stern, in box units
  stern: { type: String, default: 'trad' }, // trad, semi (trad), or cruiser
  deck: { type: Number, default: 30 }, // length of the stern deck
  cratch: { type: Boolean, default: false },
  cratchColour: { type: String, default: '#d8d2bf' },
  roses: { type: Boolean, default: false },
  items: { type: Array, default: () => [] },
  moving: { type: Boolean, default: false } // bow wave and wake only when under way
})

// the boat is drawn from y = 10 (bow) to E (stern), centred in the box
const E = computed(() => 10 + props.len)
const shift = computed(() => (500 - props.len) / 2)
const hullPath = computed(() => {
  const e = E.value
  return `M60 10 C82 30 93 60 93 90 L93 ${e - 20} Q93 ${e} 73 ${e} L47 ${e} Q27 ${e} 27 ${e - 20} L27 90 C27 60 38 30 60 10 Z`
})
const sidePath = computed(() => {
  const e = E.value - 8
  return `M60 22 C78 40 87 64 87 92 L87 ${e - 16} Q87 ${e} 71 ${e} L49 ${e} Q33 ${e} 33 ${e - 16} L33 92 C33 64 42 40 60 22 Z`
})
const roofEnd = computed(() => E.value - props.deck - 14)
const deckTop = computed(() => roofEnd.value + 4)
</script>

<template>
  <svg class="narrowboat" viewBox="0 0 120 520" aria-hidden="true">
    <g :transform="`translate(0 ${shift})`">
      <g v-if="moving" class="water-marks">
        <!-- bow wave -->
        <path d="M44 34 Q30 58 14 70" />
        <path d="M76 34 Q90 58 106 70" />
        <!-- wake -->
        <path :d="`M40 ${E + 2} Q34 ${E + 30} 22 ${E + 56}`" />
        <path :d="`M80 ${E + 2} Q86 ${E + 30} 98 ${E + 56}`" />
      </g>

      <!-- shadow on the water -->
      <path :d="hullPath" transform="translate(6 9)" fill="rgba(0, 25, 45, 0.3)" />

      <!-- black hull, painted cabin sides with a contrasting coachline, trim line -->
      <path :d="hullPath" fill="#1c1f22" />
      <path :d="sidePath" :fill="hull" />
      <path :d="sidePath" fill="none" :stroke="panel" stroke-width="3.2" />
      <path :d="sidePath" fill="none" :stroke="trim" stroke-width="1.2" />

      <!-- front well deck (wood), or a canvas cratch cover over it -->
      <path d="M60 30 C75 46 82 66 82 92 L82 108 L38 108 L38 92 C38 66 45 46 60 30 Z" fill="#9c6b3b" />
      <template v-if="!cratch">
        <line x1="41" y1="70" x2="79" y2="70" stroke="#80542c" stroke-width="1.2" />
        <line x1="39" y1="90" x2="81" y2="90" stroke="#80542c" stroke-width="1.2" />
      </template>
      <template v-else>
        <path d="M60 34 L80 106 L40 106 Z" :fill="cratchColour" stroke="rgba(0,0,0,0.25)" stroke-width="1" />
        <line x1="60" y1="34" x2="60" y2="106" stroke="rgba(0,0,0,0.25)" stroke-width="1.2" />
      </template>
      <!-- painted diamonds on the bow -->
      <g v-if="roses">
        <path d="M60 40 L66 52 L60 64 L54 52 Z" :fill="panel" :stroke="trim" stroke-width="1" />
        <circle cx="60" cy="52" r="2.4" :fill="trim" />
      </g>

      <!-- cabin roof -->
      <rect x="37" y="114" width="46" :height="roofEnd - 114" rx="5" :fill="roof" />
      <rect x="37" y="114" width="46" :height="roofEnd - 114" rx="5" fill="none" stroke="rgba(0,0,0,0.18)" stroke-width="1" />

      <!-- what's on the roof -->
      <g v-for="(it, n) in items" :key="n" :transform="`translate(${60 + (it.x || 0)} ${it.y})`">
        <template v-if="it.kind === 'chimney'">
          <circle r="6" fill="#2a2a2a" />
          <circle r="3" fill="#555" />
          <circle r="1.5" cx="0" cy="0" fill="#b0471f" opacity="0.8" />
        </template>
        <template v-else-if="it.kind === 'vent'">
          <circle cy="5" r="4.5" fill="#8a8f94" />
          <circle cy="5" r="2" fill="#b7bcc1" />
        </template>
        <template v-else-if="it.kind === 'pots'">
          <g v-for="(p, i) in it.pots" :key="i" :transform="`translate(${p.dx} ${p.dy + p.r})`">
            <circle :r="p.r + 1.2" :fill="p.pot" />
            <circle :r="p.r" :fill="p.green" />
            <circle v-for="(f, j) in p.flowers" :key="j" :cx="f.dx" :cy="f.dy" r="1.8" :fill="f.c" />
          </g>
        </template>
        <template v-else-if="it.kind === 'planter'">
          <rect x="-10" y="0" width="20" :height="it.size" rx="2" fill="#6e4a2a" />
          <rect x="-8" y="2" width="16" :height="it.size - 4" rx="2" :fill="it.green" />
          <circle v-for="(f, j) in it.flowers" :key="j" :cx="f.dx * 0.7" :cy="f.dy" r="2" :fill="f.c" />
        </template>
        <template v-else-if="it.kind === 'solar'">
          <rect x="-15" y="0" width="30" :height="it.size" rx="1.5" fill="#1d2b4a" stroke="#9aa6b8" stroke-width="1" />
          <line x1="0" y1="0" x2="0" :y2="it.size" stroke="#5d6f8f" stroke-width="0.8" />
          <line v-for="k in 3" :key="k" x1="-15" :y1="(it.size * k) / 4" x2="15" :y2="(it.size * k) / 4" stroke="#5d6f8f" stroke-width="0.8" />
        </template>
        <template v-else-if="it.kind === 'logs'">
          <rect v-for="k in 4" :key="k" :x="-14 + (k % 2) * 2" :y="(k - 1) * 8" width="26" height="7" rx="3.5" fill="#8b5a2b" stroke="#5e3b1a" stroke-width="0.8" />
        </template>
        <template v-else-if="it.kind === 'bike'">
          <circle cy="12" r="10" fill="none" stroke="#333" stroke-width="2" />
          <circle cy="50" r="10" fill="none" stroke="#333" stroke-width="2" />
          <path d="M0 12 L0 50 M-6 22 L6 22" :stroke="it.c" stroke-width="2.6" stroke-linecap="round" fill="none" />
        </template>
        <template v-else-if="it.kind === 'rope'">
          <circle cy="10" r="8" fill="none" stroke="#c8b285" stroke-width="3" />
          <circle cy="10" r="3.5" fill="none" stroke="#c8b285" stroke-width="2" />
        </template>
        <template v-else-if="it.kind === 'can'">
          <rect x="-7" y="2" width="14" height="18" rx="2" :fill="it.c" />
          <line x1="0" y1="2" x2="0" y2="-4" stroke="#444" stroke-width="2" />
        </template>
        <template v-else-if="it.kind === 'buoy'">
          <circle cy="11" r="9" fill="none" :stroke="it.c" stroke-width="4.5" />
          <circle cy="11" r="9" fill="none" stroke="#fff" stroke-width="4.5" stroke-dasharray="7 7.1" />
        </template>
      </g>

      <!-- stern: a short trad deck, a semi-trad with side rails, or a cruiser's open deck -->
      <rect x="37" :y="deckTop" width="46" :height="E - 12 - deckTop" rx="4" fill="#9c6b3b" />
      <template v-if="stern !== 'trad'">
        <rect x="37" :y="deckTop" width="46" :height="E - 12 - deckTop" rx="4" fill="none" :stroke="trim" stroke-width="2" />
        <line v-for="k in Math.floor((E - 14 - deckTop) / 12)" :key="k" x1="39" :y1="deckTop + k * 12" x2="81" :y2="deckTop + k * 12" stroke="#80542c" stroke-width="1" />
      </template>
      <template v-if="stern === 'cruiser'">
        <!-- a couple of folding chairs out on the back -->
        <rect x="42" :y="deckTop + 14" width="12" height="12" rx="2" :fill="panel" />
        <rect x="66" :y="deckTop + 22" width="12" height="12" rx="2" :fill="trim" />
      </template>
      <line x1="60" :y1="E - 14" x2="60" :y2="E + 8" stroke="#2a2a2a" stroke-width="3" stroke-linecap="round" />
      <line x1="60" :y1="E - 30" x2="74" :y2="E - 50" stroke="#d9b56a" stroke-width="3" stroke-linecap="round" />
    </g>
  </svg>
</template>

<style scoped>
.narrowboat {
  display: block;
  width: 100%;
  height: 100%;
  overflow: visible;
}

.water-marks path {
  fill: none;
  stroke: rgba(255, 255, 255, 0.45);
  stroke-width: 3;
  stroke-linecap: round;
  stroke-dasharray: 14 10;
  animation: drift 1.6s linear infinite;
}

@keyframes drift {
  to {
    stroke-dashoffset: -24;
  }
}

@media (prefers-reduced-motion: reduce) {
  .water-marks path {
    animation: none;
  }
}
</style>
