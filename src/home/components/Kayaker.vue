<script setup>
import { computed } from 'vue'

const props = defineProps({
  // k1: everyday single kayak; racer: longer, thinner racing K1; k2: two-person kayak;
  // c1: high-kneeling racing canoe; canoe: open (Canadian) canoe for two;
  // oc1: outrigger canoe (a slim hull with a float on arms out to its left)
  type: { type: String, default: 'k1' },
  // canoes: which side the (front) paddler paddles on, 1 right or -1 left; they swap
  // now and then (the page flips this, with `swapping` set while the blades come across)
  side: { type: Number, default: 1 },
  swapping: { type: Boolean, default: false },
  hull: { type: String, default: '#e63946' },
  deck: { type: String, default: '#ffd166' },
  shirt: { type: String, default: '#1d3557' },
  helmet: { type: String, default: '#f1faee' },
  // seconds for one sweep of the paddle (a full left+right cycle takes twice this)
  stroke: { type: Number, default: 0.7 },
  // negative delay so every boat is out of step with its neighbours
  delay: { type: Number, default: 0 },
  // a paint job (see DESIGNS): private racing K1s, and some K2s
  design: { type: String, default: '' },
})

// Drawn in a box 120 wide, bow up; the height depends on the boat. The collision
// footprints in swarm.js (TYPES) are measured from the centre of these same boxes.
const SHAPES = {
  k1: {
    box: 170,
    hull: 'M60 4 C76 40 78 118 60 162 C42 118 44 40 60 4 Z',
    deck: 'M60 16 C70 48 71 112 60 150 C49 112 50 48 60 16 Z',
    cockpit: [9.5, 15],
    seats: [88],
    wake: ['M54 156 Q49 172 41 188', 'M66 156 Q71 172 79 188'],
  },
  racer: {
    box: 200,
    hull: 'M60 4 C71 44 72 140 60 196 C48 140 49 44 60 4 Z',
    deck: 'M60 18 C67 52 68 136 60 182 C52 136 53 52 60 18 Z',
    cockpit: [7.5, 13],
    seats: [112],
    wake: ['M56 190 Q51 206 43 222', 'M64 190 Q69 206 77 222'],
  },
  k2: {
    box: 240,
    hull: 'M60 4 C77 48 79 180 60 236 C41 180 43 48 60 4 Z',
    deck: 'M60 18 C72 56 73 172 60 222 C47 172 48 56 60 18 Z',
    cockpit: [9.5, 14],
    seats: [86, 158],
    wake: ['M53 230 Q48 246 40 262', 'M67 230 Q72 246 80 262'],
  },
  // high kneeler: a narrow decked racing canoe; the paddler kneels on one knee in the
  // long cockpit and paddles on one side with a single blade
  c1: {
    box: 210,
    canoe: true,
    hull: 'M60 4 C74 50 75 156 60 206 C45 156 46 50 60 4 Z',
    deck: 'M60 20 C69 60 70 150 60 192 C50 150 51 60 60 20 Z',
    opening: [[60, 120, 9, 24]],
    seats: [118],
    blade: 20,
    wake: ['M55 200 Q50 216 42 232', 'M65 200 Q70 216 78 232'],
  },
  // outrigger canoe: a long slim hull, the paddler sitting, single blade; the ama (float)
  // rides out on the left on two curved arms (iako), making the whole craft about three
  // times as wide as a club K1. Drawn beyond the 120-wide box on the left (x down to -6).
  oc1: {
    box: 230,
    canoe: true,
    hull: 'M60 4 C70 50 71 170 60 226 C49 170 50 50 60 4 Z',
    deck: 'M60 18 C67 56 68 164 60 212 C52 164 53 56 60 18 Z',
    opening: [[60, 128, 7, 15]],
    seats: [126],
    blade: 20,
    ama: 'M0 40 C7 70 7 150 0 182 C-7 150 -7 70 0 40 Z',
    iako: ['M56 78 Q28 68 1 80', 'M56 150 Q28 140 1 152'],
    wake: ['M55 220 Q50 236 42 252', 'M65 220 Q70 236 78 252', 'M-3 178 Q-6 192 -11 204'],
  },
  // open canoe: wide, no deck, two paddlers on opposite sides, a yoke across the middle
  canoe: {
    box: 230,
    canoe: true,
    open: true,
    hull: 'M60 6 C84 44 85 186 60 224 C35 186 36 44 60 6 Z',
    deck: 'M60 14 C80 48 81 182 60 216 C39 182 40 48 60 14 Z',
    thwarts: [[92, 16], [116, 17.5], [140, 16]], // y, half-length (inside the gunwales)
    seats: [62, 176],
    blade: 27,
    wake: ['M53 218 Q48 234 40 250', 'M67 218 Q72 234 80 250'],
  },
}
const shape = computed(() => SHAPES[props.type] || SHAPES.k1)
// Canoe paddlers: one paddler paddles on `side`; in a two-person canoe the second
// paddles on the opposite side (when they swap, both change over)
const paddleSide = i => (i % 2 === 0 ? props.side : -props.side)

// Privately owned boats: five racing designs, all thinner and faster than the club's
// yellow K1s. Each hull sits inside the racer outline above (so inside its collision
// footprint in swarm.js); the paint is clipped to the hull.
const DESIGNS = {
  // black carbon with a red pinstripe and a grey deck panel ahead of the cockpit
  carbon: {
    hull: 'M60 4 C71 44 72 140 60 196 C48 140 49 44 60 4 Z',
    fill: '#1f2327',
    edge: '#e63946',
    paint: [
      { d: 'M60 66 C67 82 68 100 65 112 L55 112 C52 100 53 82 60 66 Z', fill: '#4a525a' },
      { d: 'M59.3 10 H60.7 V64 H59.3 Z', fill: '#e63946' },
      { d: 'M59.3 128 H60.7 V190 H59.3 Z', fill: '#e63946' },
    ],
  },
  // white with blue chevrons at the bow and a blue stern
  arrow: {
    hull: 'M60 6 C70 46 71 140 60 194 C49 140 50 46 60 6 Z',
    fill: '#f4f6f8',
    edge: 'rgba(0,0,0,0.3)',
    paint: [
      { d: 'M48 34 L60 22 L72 34 L72 40 L60 28 L48 40 Z', fill: '#1d6fd1' },
      { d: 'M48 50 L60 38 L72 50 L72 56 L60 44 L48 56 Z', fill: '#1d6fd1' },
      { d: 'M48 66 L60 54 L72 66 L72 72 L60 60 L48 72 Z', fill: '#1d6fd1' },
      { d: 'M40 150 H80 V200 H40 Z', fill: '#1d6fd1' },
    ],
  },
  // red with a yellow-orange flame licking back from the bow
  flame: {
    hull: 'M60 4 C69 44 70 140 60 196 C50 140 51 44 60 4 Z',
    fill: '#c1121f',
    edge: 'rgba(0,0,0,0.3)',
    paint: [
      { d: 'M60 4 C66 26 69 48 64 76 C63 62 61 54 61 46 C58 58 58 68 59 80 C54 60 52 40 55 26 Z', fill: '#f77f00' },
      { d: 'M60 8 C63 24 65 40 62 58 C61 48 60 42 60 36 C58 44 58 50 58 56 C55 42 56 28 60 8 Z', fill: '#fcbf49' },
    ],
  },
  // two-tone: lime front, navy back, split on the slant behind the cockpit
  split: {
    hull: 'M60 5 C71 44 72 140 60 195 C48 140 49 44 60 5 Z',
    fill: '#8ac926',
    edge: 'rgba(0,0,0,0.3)',
    paint: [
      { d: 'M40 140 L80 118 V200 H40 Z', fill: '#14213d' },
      { d: 'M40 136 L80 114 V118 L40 140 Z', fill: '#ffffff' },
    ],
  },
  // dark teal with a silver deck and yellow safety tips at bow and stern
  stealth: {
    hull: 'M60 4 C68 44 69 140 60 196 C51 140 52 44 60 4 Z',
    fill: '#0b3c49',
    edge: 'rgba(0,0,0,0.35)',
    paint: [
      { d: 'M60 30 C64 60 65 92 63 112 L57 112 C55 92 56 60 60 30 Z', fill: '#c0c7cc' },
      { d: 'M40 0 H80 V16 H40 Z', fill: '#ffd60a' },
      { d: 'M40 186 H80 V200 H40 Z', fill: '#ffd60a' },
    ],
  },
}
// K2 paint jobs: same hull as the plain K2, so the same collision footprint
const K2_HULL = 'M60 4 C77 48 79 180 60 236 C41 180 43 48 60 4 Z'
const K2_DESIGNS = {
  // black carbon with gold pinstripes and a grey deck panel between the cockpits
  carbon: {
    hull: K2_HULL,
    fill: '#1f2327',
    edge: '#d4a017',
    paint: [
      { d: 'M53 104 H67 V140 H53 Z', fill: '#4a525a' },
      { d: 'M59.3 12 H60.7 V68 H59.3 Z', fill: '#d4a017' },
      { d: 'M59.3 176 H60.7 V228 H59.3 Z', fill: '#d4a017' },
    ],
  },
  // white with a blue wave across the middle
  wave: {
    hull: K2_HULL,
    fill: '#f4f6f8',
    edge: 'rgba(0,0,0,0.3)',
    paint: [
      { d: 'M30 112 C42 100 52 124 64 112 C74 102 84 104 92 108 V142 C82 136 72 152 60 144 C48 136 38 148 30 152 Z', fill: '#1d6fd1' },
      { d: 'M30 104 C42 92 52 116 64 104 C74 94 84 96 92 100 V106 C84 102 74 100 64 110 C52 122 42 98 30 110 Z', fill: '#7fb3ef' },
    ],
  },
  // orange front, pink back, split on a slant with a white line
  sunset: {
    hull: K2_HULL,
    fill: '#f77f00',
    edge: 'rgba(0,0,0,0.3)',
    paint: [
      { d: 'M30 140 L90 110 V240 H30 Z', fill: '#d62869' },
      { d: 'M30 135 L90 105 V110 L30 140 Z', fill: '#ffffff' },
    ],
  },
  // racing green with twin white stripes and a yellow bow
  green: {
    hull: K2_HULL,
    fill: '#1b5e3b',
    edge: 'rgba(0,0,0,0.35)',
    paint: [
      { d: 'M53.5 20 H55.5 V224 H53.5 Z', fill: '#ffffff' },
      { d: 'M64.5 20 H66.5 V224 H64.5 Z', fill: '#ffffff' },
      { d: 'M30 0 H90 V22 H30 Z', fill: '#ffd60a' },
    ],
  },
}
const design = computed(() => (props.type === 'racer' && DESIGNS[props.design]) || (props.type === 'k2' && K2_DESIGNS[props.design]) || null)
// each boat's own clip path id (several boats share a page)
const clipId = 'hull-' + Math.random().toString(36).slice(2, 10)
</script>

<template>
  <svg
    class="kayaker"
    :viewBox="`0 0 120 ${shape.box}`"
    aria-hidden="true"
    :style="{ '--stroke': stroke + 's', '--delay': delay + 's' }"
  >
    <!-- foam trailing off the stern -->
    <g class="wake">
      <path v-for="(w, i) in shape.wake" :key="i" :d="w" />
    </g>

    <!-- soft shadow on the water -->
    <path :d="shape.hull" transform="translate(5 8)" fill="rgba(0, 25, 45, 0.28)" />

    <!-- outrigger: the float (ama) and its two arms (iako), under everything else -->
    <g v-if="shape.ama">
      <path :d="shape.ama" transform="translate(5 8)" fill="rgba(0, 25, 45, 0.22)" />
      <path v-for="(d, i) in shape.iako" :key="'i' + i" :d="d" fill="none" stroke="#2b2f33" stroke-width="4" stroke-linecap="round" />
      <path :d="shape.ama" :fill="deck" stroke="rgba(0,0,0,0.3)" stroke-width="1.2" />
    </g>

    <!-- hull + deck stripe (or a private boat's paint job) + cockpit(s) -->
    <template v-if="design">
      <clipPath :id="clipId"><path :d="design.hull" /></clipPath>
      <path :d="design.hull" :fill="design.fill" />
      <g :clip-path="`url(#${clipId})`">
        <path v-for="(p, i) in design.paint" :key="i" :d="p.d" :fill="p.fill" />
      </g>
      <path :d="design.hull" fill="none" :stroke="design.edge" stroke-width="1.2" />
    </template>
    <template v-else>
      <path :d="shape.hull" :fill="hull" stroke="rgba(0,0,0,0.25)" stroke-width="1.2" />
      <path :d="shape.deck" :fill="deck" />
    </template>

    <!-- canoes: a long kneeling cockpit (C1) or an open hull with yoke and seats -->
    <template v-if="shape.canoe">
      <ellipse v-for="(o, i) in shape.opening || []" :key="'o' + i" :cx="o[0]" :cy="o[1]" :rx="o[2]" :ry="o[3]" fill="#1b2430" />
      <line v-for="[y, w] in shape.thwarts || []" :key="'t' + y" :x1="60 - w" :y1="y" :x2="60 + w" :y2="y" stroke="rgba(60, 35, 15, 0.55)" stroke-width="3" stroke-linecap="round" />
      <g v-for="(y, i) in shape.seats" :key="'cp' + y">
        <g class="torso torso--canoe" :style="{ transformOrigin: `60px ${y}px` }">
          <ellipse cx="60" :cy="y + 2" rx="12.5" ry="6.5" :fill="shirt" />
          <circle cx="60" :cy="y - 2" r="5.6" fill="#e8b48f" />
          <path :d="`M54.4 ${y - 2} A5.6 5.6 0 0 1 65.6 ${y - 2} Z`" :fill="helmet" />
        </g>
        <!-- single-bladed paddle: grip hand near the body, blade in the water alongside,
             drawn back along the hull each stroke; mirrored for the left-hand side -->
        <g :transform="paddleSide(i) < 0 ? 'translate(120 0) scale(-1 1)' : null" class="side" :class="{ 'side--swapping': swapping }">
          <g class="cpaddle" :style="{ transformOrigin: `60px ${y}px` }">
            <line x1="50" :y1="y - 3" :x2="60 + shape.blade" :y2="y" stroke="#262b33" stroke-width="2.4" stroke-linecap="round" />
            <line x1="48" :y1="y - 7" x2="52" :y2="y + 1" stroke="#262b33" stroke-width="2.6" stroke-linecap="round" />
            <ellipse :cx="60 + shape.blade + 2" :cy="y" rx="3.5" ry="8" fill="#262b33" />
            <circle cx="52" :cy="y - 3" r="2.5" fill="#e8b48f" />
            <circle :cx="60 + shape.blade - 12" :cy="y - 1" r="2.5" fill="#e8b48f" />
          </g>
        </g>
      </g>
    </template>

    <template v-else>
    <ellipse v-for="y in shape.seats" :key="'c' + y" cx="60" :cy="y" :rx="shape.cockpit[0]" :ry="shape.cockpit[1]" fill="#1b2430" />

    <!-- one paddler per seat; in a K2 both paddle in time -->
    <g v-for="y in shape.seats" :key="'p' + y">
      <!-- torso twists with each stroke -->
      <g class="torso" :style="{ transformOrigin: `60px ${y}px` }">
        <ellipse cx="60" :cy="y + 2" rx="12.5" ry="6.5" :fill="shirt" />
        <circle cx="60" :cy="y - 2" r="5.6" fill="#e8b48f" />
        <path :d="`M54.4 ${y - 2} A5.6 5.6 0 0 1 65.6 ${y - 2} Z`" :fill="helmet" />
      </g>

      <!-- double-bladed paddle sweeping side to side; plain dark blades like the shaft -->
      <g class="paddle" :style="{ transformOrigin: `60px ${y}px` }">
        <line x1="29" :y1="y" x2="91" :y2="y" stroke="#262b33" stroke-width="2" stroke-linecap="round" />
        <ellipse cx="30" :cy="y" rx="3" ry="7.5" fill="#262b33" />
        <ellipse cx="90" :cy="y" rx="3" ry="7.5" fill="#262b33" />
        <circle cx="51" :cy="y" r="2.4" fill="#e8b48f" />
        <circle cx="69" :cy="y" r="2.4" fill="#e8b48f" />
      </g>
    </g>
    </template>
  </svg>
</template>

<style scoped>
.kayaker {
  display: block;
  width: 100%;
  height: 100%;
  overflow: visible;
}

.paddle,
.torso {
  animation-duration: var(--stroke);
  animation-delay: var(--delay);
  animation-timing-function: ease-in-out;
  animation-iteration-count: infinite;
  animation-direction: alternate;
}

.paddle {
  animation-name: sweep;
}

/* swapping sides: the blade lifts out of the water, comes across, goes back in */
.side {
  transition: opacity 0.3s ease;
}

.side--swapping {
  opacity: 0;
}

/* a canoe stroke: the blade is drawn back along the hull, then carried forward again */
.cpaddle {
  animation: pull calc(var(--stroke) * 1.3) ease-in-out var(--delay) infinite alternate;
}

.torso--canoe {
  animation-name: lean;
  animation-duration: calc(var(--stroke) * 1.3);
}

@keyframes pull {
  from {
    transform: translateY(-20px) rotate(-6deg);
  }
  to {
    transform: translateY(16px) rotate(4deg);
  }
}

@keyframes lean {
  from {
    transform: translateY(-2px);
  }
  to {
    transform: translateY(2px);
  }
}

.torso {
  animation-name: twist;
}

@keyframes sweep {
  from {
    transform: rotate(-24deg);
  }
  to {
    transform: rotate(24deg);
  }
}

@keyframes twist {
  from {
    transform: rotate(-9deg);
  }
  to {
    transform: rotate(9deg);
  }
}

.wake path {
  fill: none;
  stroke: rgba(255, 255, 255, 0.45);
  stroke-width: 2.6;
  stroke-linecap: round;
  stroke-dasharray: 12 9;
  animation: drift 0.9s linear infinite;
}

@keyframes drift {
  to {
    stroke-dashoffset: -21;
  }
}
</style>
