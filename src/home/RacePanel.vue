<script setup>
// Race mode's display: place, speed and rhythm while racing, the starter's calls, the results,
// and (for phones and tablets) on-screen buttons. A separate component so the ten-times-a-second
// updates only redraw this, not the river.
import { computed } from 'vue'
const props = defineProps({ ui: { type: Object, required: true } })
const emit = defineEmits(['again', 'exit', 'stroke', 'steer', 'brake'])
const h = computed(() => props.ui.hud || {})
const ord = n => n + (['th', 'st', 'nd', 'rd'][(n % 100 > 10 && n % 100 < 14) ? 0 : n % 10 < 4 ? n % 10 : 0])
const secs = t => (t == null ? '—' : t.toFixed(1) + 's')
const me = computed(() => (props.ui.results || []).find(r => r.you))
const headline = computed(() => {
  if (!me.value) return ''
  if (me.value.fell) return 'You fell in!'
  if (me.value.time == null) return 'Did not finish'
  return me.value.place === 1 ? 'You won!' : me.value.place <= 3 ? `${ord(me.value.place)} place: on the podium` : `${ord(me.value.place)} place`
})
</script>

<template>
  <div class="race" aria-live="off">
    <div class="race__bar">
      <div class="race__cell"><span>PLACE</span><b>{{ h.place || 1 }}<small>/{{ h.of || 5 }}</small></b></div>
      <div class="race__cell"><span>TIME</span><b>{{ h.phase === 'racing' || h.finished ? (h.finished && ui.myTime != null ? ui.myTime : h.raceT || 0).toFixed(1) : '0.0' }}</b></div>
      <div class="race__cell race__cell--wide"><span>SPEED</span><i class="race__meter"><u :style="{ width: Math.round((h.speed || 0) * 100) + '%' }" /></i></div>
      <div class="race__cell race__cell--wide"><span>RHYTHM</span><i class="race__meter race__meter--r" :class="{ good: (h.rhythm || 0) > 0.95 }"><u :style="{ width: Math.round((h.rhythm || 0) * 100) + '%' }" /></i></div>
      <div class="race__cell race__cell--wide"><span>BALANCE</span><i class="race__meter race__meter--b" :class="{ warn: (h.balance || 0) > 0.6 }"><u :style="{ width: Math.round((1 - (h.balance || 0)) * 100) + '%' }" /></i></div>
      <div class="race__cell"><span>BEST</span><b>{{ ui.best ? ui.best.toFixed(1) : '—' }}</b></div>
      <button type="button" class="race__exit" @click="emit('exit')">✕ Leave race</button>
    </div>

    <div v-if="h.call && !ui.results" :key="h.call" class="race__call" :class="{ go: h.call === 'GO!' }" role="status">{{ h.call }}</div>
    <p v-if="h.hint && !ui.results" class="race__hint" role="status">{{ h.hint }}</p>
    <p v-if="h.penalty && !ui.results" class="race__hint race__hint--bad">+{{ h.penalty }}s penalty</p>
    <p v-if="h.phase === 'lineup' && !ui.results" class="race__keys">
      Paddle by alternating <kbd>Z</kbd> and <kbd>X</kbd> (left, right, left… about 3 a second) &nbsp; <kbd>←</kbd> <kbd>→</kbd> steer &nbsp; <kbd>↓</kbd> brake
    </p>

    <div v-if="ui.results" class="race__results" role="dialog" aria-label="Race results">
      <h2>{{ headline }}</h2>
      <ol>
        <li v-for="r in ui.results" :key="r.name" :class="{ me: r.you }">
          <span>{{ r.place }}</span><span>{{ r.name }}{{ r.you ? ' (you)' : '' }}</span>
          <span>{{ secs(r.time) }}</span><span>{{ r.gap ? '+' + r.gap.toFixed(1) : '' }}</span>
        </li>
      </ol>
      <p v-if="ui.newBest" class="race__newbest">★ New personal best ★</p>
      <p class="race__tip">Alternate left and right in a steady beat. The same side twice, splashing and hitting banks rock the boat: too many mistakes and you fall in! Stay behind the line at the start!</p>
      <div class="race__btns">
        <button type="button" @click="emit('again')">RACE AGAIN</button>
        <button type="button" class="alt" @click="emit('exit')">BACK TO THE RIVER</button>
      </div>
    </div>

    <!-- touch controls (only shown on devices with a touch screen) -->
    <div v-if="!ui.results" class="race__touch">
      <div>
        <button type="button" aria-label="Steer left" @pointerdown.prevent="emit('steer', -1)" @pointerup.prevent="emit('steer', 0)" @pointercancel="emit('steer', 0)" @pointerleave="emit('steer', 0)">◀</button>
        <button type="button" aria-label="Steer right" @pointerdown.prevent="emit('steer', 1)" @pointerup.prevent="emit('steer', 0)" @pointercancel="emit('steer', 0)" @pointerleave="emit('steer', 0)">▶</button>
      </div>
      <div>
        <button type="button" class="alt" aria-label="Brake" @pointerdown.prevent="emit('brake', true)" @pointerup.prevent="emit('brake', false)" @pointercancel="emit('brake', false)" @pointerleave="emit('brake', false)">STOP</button>
        <button type="button" class="big" aria-label="Paddle left" @pointerdown.prevent="emit('stroke', -1)">PADDLE L</button>
        <button type="button" class="big" aria-label="Paddle right" @pointerdown.prevent="emit('stroke', 1)">PADDLE R</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.race { position: absolute; inset: 0; z-index: 20; pointer-events: none; font-family: 'Press Start 2P', ui-monospace, monospace; color: #fff; }
.race > * { pointer-events: auto; }
.race__bar { position: absolute; top: 116px; left: 50%; transform: translateX(-50%); display: flex; gap: 8px; align-items: stretch; flex-wrap: wrap; justify-content: center; max-width: calc(100% - 24px); }
.race__cell { background: rgba(6, 22, 36, 0.78); border: 2px solid #ffe600; border-radius: 8px; padding: 6px 10px; min-width: 64px; text-align: center; }
.race__cell span { display: block; font-size: 0.5rem; color: #ffe600; margin-bottom: 4px; }
.race__cell b { font-size: 0.95rem; }
.race__cell small { font-size: 0.55rem; opacity: 0.8; }
.race__cell--wide { min-width: 110px; }
.race__meter { display: block; height: 12px; border-radius: 6px; background: rgba(255, 255, 255, 0.18); overflow: hidden; }
.race__meter u { display: block; height: 100%; background: linear-gradient(90deg, #5fd0a0, #ffe600); transition: width 0.12s; }
.race__meter--r u { background: #ff9a3c; }
.race__meter--r.good u { background: #5fe08a; }
.race__meter--b u { background: #5fd0ff; }
.race__meter--b.warn u { background: #ff5a5a; }
.race__exit { align-self: center; font: inherit; font-size: 0.5rem; padding: 8px 10px; border-radius: 8px; border: 2px solid #fff; background: rgba(6, 22, 36, 0.78); color: #fff; cursor: pointer; }
.race__call { position: absolute; top: 38%; left: 50%; transform: translateX(-50%); font-size: clamp(1.4rem, 5vw, 3rem); text-shadow: 0 4px 0 #000, 0 0 18px #ffe600; animation: race-pop 0.5s ease-out; white-space: nowrap; pointer-events: none; }
.race__call.go { color: #5fe08a; }
@keyframes race-pop { from { transform: translateX(-50%) scale(1.8); opacity: 0; } to { transform: translateX(-50%) scale(1); opacity: 1; } }
.race__hint { position: absolute; top: 200px; left: 50%; transform: translateX(-50%); margin: 0; padding: 8px 12px; background: rgba(6, 22, 36, 0.8); border-radius: 8px; font-size: 0.6rem; text-align: center; max-width: calc(100% - 24px); line-height: 1.5; pointer-events: none; }
.race__hint--bad { top: 246px; color: #ff6b6b; }
.race__keys { position: absolute; bottom: 24px; left: 50%; transform: translateX(-50%); margin: 0; padding: 8px 12px; background: rgba(6, 22, 36, 0.8); border-radius: 8px; font-size: 0.5rem; line-height: 1.9; text-align: center; max-width: calc(100% - 24px); pointer-events: none; }
.race__keys kbd { font: inherit; border: 1px solid #fff; border-radius: 4px; padding: 1px 5px; background: #123; }
.race__results { position: absolute; z-index: 13; top: 50%; left: 50%; transform: translate(-50%, -50%); width: min(560px, calc(100% - 32px)); max-height: calc(100% - 32px); overflow: auto; box-sizing: border-box; padding: 24px; text-align: center; border-radius: 12px; background: rgba(6, 22, 36, 0.92); border: 3px solid #ffe600; box-shadow: 0 0 30px rgba(255, 230, 0, 0.5); display: flex; flex-direction: column; align-items: center; }
.race__results h2 { margin: 0 0 12px; font-size: clamp(1rem, 4vw, 1.6rem); font-weight: 400; color: #ffe600; }
.race__results ol { list-style: none; margin: 8px 0; padding: 0; width: min(520px, 90vw); }
.race__results li { display: grid; grid-template-columns: 2em 1fr 5em 4em; gap: 8px; padding: 6px 8px; font-size: 0.7rem; border-bottom: 1px solid rgba(255, 255, 255, 0.2); }
.race__results li.me { background: rgba(255, 230, 0, 0.22); color: #ffe600; }
.race__newbest { color: #ffe600; font-size: 0.7rem; }
.race__tip { font-size: 0.55rem; line-height: 1.8; max-width: 440px; opacity: 0.85; }
.race__btns { display: flex; gap: 10px; flex-wrap: wrap; justify-content: center; }
.race__btns button, .race__touch button {
  box-shadow: 0 4px 0 #8a4a00; font: inherit; font-size: 0.7rem; padding: 12px 16px; border-radius: 10px; border: 2px solid #fff; background: linear-gradient(#ffb347, #ff7b00); color: #3a1b00; cursor: pointer; }
.race__btns button.alt, .race__touch button.alt { background: rgba(6, 22, 36, 0.8); color: #fff; }
.race__touch { display: none; position: absolute; left: 12px; right: 12px; bottom: 14px; justify-content: space-between; align-items: flex-end; }
.race__touch > div { display: flex; gap: 10px; }
.race__touch button { min-width: 64px; min-height: 64px; touch-action: none; user-select: none; }
.race__touch button.big { min-width: 96px; font-size: 0.6rem; }
@media (pointer: coarse) { .race__touch { display: flex; } .race__keys { display: none; } }
@media (max-width: 640px) { .race__bar { top: 62px; } .race__cell { min-width: 52px; padding: 4px 6px; } .race__cell--wide { min-width: 80px; } .race__hint { top: 150px; } .race__hint--bad { top: 205px; } .race__touch { bottom: 70px; } }
</style>
