<script setup>
// Gaming mode's scoreboard and the "insert coin" / "time up" screens. Kept as its own component
// so the clock ticking (ten times a second) only redraws this, not the whole river.
import { ref, watch } from 'vue'
const props = defineProps({ game: { type: Object, required: true } })
defineEmits(['start', 'submit'])
const name = ref(props.game.name || '')
watch(() => props.game.name, v => { if (v && !name.value) name.value = v })
const pad = n => String(n).padStart(6, '0')
</script>

<template>
  <div class="arcade" aria-live="off">
    <div class="arcade__cell"><span>SCORE</span><b>{{ pad(game.score) }}</b></div>
    <div class="arcade__cell" :class="{ 'arcade__cell--low': game.state === 'playing' && game.time < 10 }"><span>TIME</span><b>{{ Math.ceil(game.time) }}</b></div>
    <div class="arcade__cell" :class="{ 'arcade__cell--hot': game.combo > 1 }"><span>COMBO</span><b>x{{ Math.min(5, Math.max(1, game.combo)) }}</b></div>
    <div class="arcade__cell" :class="{ 'arcade__cell--mult': game.mult > 1 }"><span>BONUS</span><b>x{{ game.mult }}</b></div>
    <div class="arcade__cell"><span>HI</span><b>{{ pad(game.hi) }}</b></div>
  </div>

  <!-- a multiplier has been awarded: a stripe sweeps across the screen -->
  <div v-if="game.award" :key="game.award.id" class="stripe" role="status">
    <div class="stripe__band"><span>★ MULTIPLIER AWARDED ★</span><b>SCORE x{{ game.award.mult }}</b><span>★ MULTIPLIER AWARDED ★</span></div>
  </div>

  <div v-if="game.state === 'idle'" class="arcade-screen" role="dialog" aria-label="Wreck the river">
    <h2>WRECK THE RIVER</h2>
    <p>Click a boat, car or tree <strong>three times</strong> to wreck it.<br />You have <strong>30 seconds</strong>. Wreck things quickly for combos.</p>
    <p>Click a floating <strong>dynamite</strong> stick once for a huge blast!</p>
    <p class="arcade-screen__pts">BOOM 100 &nbsp;·&nbsp; SPLASH 75 &nbsp;·&nbsp; LIFT-OFF 150</p>
    <p class="arcade-screen__pts">Reach 1,000 points for a x2 multiplier, then more at 2,500, 5,000 and 10,000!</p>
    <div v-if="game.boardOk && (game.board.length || game.wrecksBoard.length)" class="arcade-screen__boards">
      <div>
        <h3>HIGH SCORES</h3>
        <ol aria-label="Top five scores">
          <li v-for="(e, i) in game.board" :key="e.id" :class="{ me: game.submitted && e.id === game.myId }"><span>{{ i + 1 }}</span><span>{{ e.name }}</span><span>{{ pad(e.score) }}</span></li>
        </ol>
      </div>
      <div>
        <h3>MOST WRECKED</h3>
        <ol aria-label="Top five by things destroyed">
          <li v-for="(e, i) in game.wrecksBoard" :key="e.id" :class="{ me: game.submitted && e.id === game.myId }"><span>{{ i + 1 }}</span><span>{{ e.name }}</span><span>{{ e.wrecked }}</span></li>
        </ol>
      </div>
    </div>
    <button type="button" @click="$emit('start')">INSERT COIN ▶ START</button>
  </div>
  <div v-else-if="game.state === 'over'" class="arcade-screen" role="dialog" aria-label="Time up">
    <h2>TIME UP!</h2>
    <p class="arcade-screen__score">{{ pad(game.score) }}</p>
    <p v-if="game.newHi" class="arcade-screen__new">★ NEW HIGH SCORE ★</p>
    <form v-if="game.qualifies && !game.submitted" class="arcade-screen__name" @submit.prevent="$emit('submit', name)">
      <p class="arcade-screen__new">★ TOP FIVE! ENTER YOUR NAME ★</p>
      <input v-model="name" maxlength="14" placeholder="YOUR NAME" autocomplete="nickname" aria-label="Your name for the top five (shown to everyone)" />
      <button type="submit" :disabled="game.busy || !name.trim()">SAVE SCORE</button>
      <p v-if="game.error" class="arcade-screen__err">{{ game.error }}</p>
      <p class="arcade-screen__fine">Shown to everyone who plays. A nickname is fine.</p>
    </form>
    <p>{{ game.wrecked }} boat{{ game.wrecked === 1 ? '' : 's' }} wrecked · best combo x{{ Math.min(5, Math.max(1, game.best)) }}<template v-if="game.bestMult > 1"> · bonus x{{ game.bestMult }}</template></p>
    <div v-if="game.boardOk && (game.board.length || game.wrecksBoard.length)" class="arcade-screen__boards">
      <div>
        <h3>HIGH SCORES</h3>
        <ol aria-label="Top five scores">
          <li v-for="(e, i) in game.board" :key="e.id" :class="{ me: game.submitted && e.id === game.myId }"><span>{{ i + 1 }}</span><span>{{ e.name }}</span><span>{{ pad(e.score) }}</span></li>
        </ol>
      </div>
      <div>
        <h3>MOST WRECKED</h3>
        <ol aria-label="Top five by things destroyed">
          <li v-for="(e, i) in game.wrecksBoard" :key="e.id" :class="{ me: game.submitted && e.id === game.myId }"><span>{{ i + 1 }}</span><span>{{ e.name }}</span><span>{{ e.wrecked }}</span></li>
        </ol>
      </div>
    </div>
    <button type="button" @click="$emit('start')">PLAY AGAIN ▶</button>
  </div>
</template>

<style scoped>
.arcade {
  position: absolute; top: 124px; left: 50%; transform: translateX(-50%); z-index: 13;
  display: flex; gap: 10px; padding: 10px 14px; border-radius: 10px;
  background: rgba(14, 0, 36, 0.82); border: 2px solid #ff2bd6; box-shadow: 0 0 18px #ff2bd6, inset 0 0 12px rgba(255, 43, 214, 0.35);
  font-family: 'Press Start 2P', ui-monospace, 'Courier New', monospace; color: #fff; pointer-events: none;
}
.arcade__cell { display: grid; gap: 6px; text-align: center; min-width: 74px; }
.arcade__cell span { font-size: 0.55rem; color: #00e5ff; letter-spacing: 0.08em; }
.arcade__cell b { font-size: 0.95rem; font-weight: 400; color: #ffe600; text-shadow: 0 0 8px #ffb300; }
.arcade__cell--low b { color: #ff3b3b; text-shadow: 0 0 8px #ff0000; animation: blink 0.5s steps(2) infinite; }
.arcade__cell--hot b { color: #ff2bd6; text-shadow: 0 0 10px #ff2bd6; }
.arcade__cell--mult b { color: #00ff9d; text-shadow: 0 0 10px #00ff9d; }
/* the multiplier stripe: slides in from the left, holds, shoots out to the right */
.stripe { position: absolute; left: 0; right: 0; top: 38%; z-index: 14; pointer-events: none; overflow: hidden; height: 110px; }
.stripe__band {
  position: absolute; inset: 14px 0; display: flex; align-items: center; justify-content: space-around; gap: 16px;
  font-family: 'Press Start 2P', ui-monospace, 'Courier New', monospace; white-space: nowrap; color: #14002a;
  background: linear-gradient(90deg, #ff2bd6, #ffe600 50%, #00e5ff); border-block: 4px solid #fff;
  box-shadow: 0 0 36px #ff2bd6, 0 0 60px rgba(255, 230, 0, 0.7);
  transform: translateX(-110%) skewX(-12deg); animation: stripe-sweep 2.2s cubic-bezier(0.2, 0.8, 0.2, 1) forwards;
}
.stripe__band span { font-size: 0.7rem; opacity: 0.85; }
.stripe__band b { font-size: clamp(1.4rem, 6vw, 2.6rem); font-weight: 400; color: #fff; text-shadow: 3px 3px 0 #14002a, 0 0 14px #14002a; animation: stripe-pulse 0.3s steps(2) 6; }
@keyframes stripe-sweep {
  0% { transform: translateX(-110%) skewX(-12deg); }
  18% { transform: translateX(0) skewX(-12deg); }
  82% { transform: translateX(0) skewX(-12deg); }
  100% { transform: translateX(110%) skewX(-12deg); }
}
@keyframes stripe-pulse { 50% { transform: scale(1.12); } }
@media (max-width: 720px) { .stripe__band span { display: none; } .stripe__band { justify-content: center; } }
.arcade-screen {
  position: absolute; z-index: 13; top: 50%; left: 50%; transform: translate(-50%, -50%);
  width: min(560px, calc(100% - 32px)); max-height: calc(100% - 32px); overflow: auto; box-sizing: border-box; padding: 26px 24px; text-align: center; border-radius: 12px;
  background: rgba(14, 0, 36, 0.9); border: 3px solid #00e5ff; box-shadow: 0 0 30px #00e5ff, inset 0 0 20px rgba(0, 229, 255, 0.3);
  font-family: 'Press Start 2P', ui-monospace, 'Courier New', monospace; color: #fff;
}
.arcade-screen h2 { margin: 0 0 16px; font-size: clamp(1.1rem, 4vw, 1.8rem); font-weight: 400; color: #ff2bd6; text-shadow: 0 0 14px #ff2bd6; }
.arcade-screen p { margin: 0 0 14px; font-size: 0.7rem; line-height: 1.9; }
.arcade-screen__pts { color: #ffe600; font-size: 0.6rem !important; }
.arcade-screen__score { font-size: 1.8rem !important; color: #ffe600; text-shadow: 0 0 12px #ffb300; }
.arcade-screen__new { color: #00ff9d; animation: blink 0.6s steps(2) infinite; }
.arcade-screen__boards { display: flex; flex-wrap: wrap; gap: 14px 22px; justify-content: center; margin: 0 0 16px; }
.arcade-screen__boards > div { flex: 1 1 220px; min-width: 0; }
.arcade-screen__boards h3 { margin: 0 0 8px; font-size: 0.6rem; font-weight: 400; color: #ff2bd6; text-shadow: 0 0 8px #ff2bd6; }
.arcade-screen__boards ol { list-style: none; margin: 0; padding: 0; font-size: 0.55rem; text-align: left; }
.arcade-screen__boards li { display: grid; grid-template-columns: 2ch 1fr auto; gap: 12px; padding: 6px 4px; color: #00e5ff; border-bottom: 1px dashed rgba(0, 229, 255, 0.3); }
.arcade-screen__boards li span:last-child { color: #ffe600; }
.arcade-screen__boards li.me { color: #00ff9d; animation: blink 0.8s steps(2) infinite; }
.arcade-screen__name { margin-bottom: 14px; }
.arcade-screen__name input { width: min(280px, 100%); box-sizing: border-box; padding: 12px; margin-bottom: 10px; text-align: center; text-transform: uppercase; font: 400 0.85rem 'Press Start 2P', ui-monospace, 'Courier New', monospace; color: #ffe600; background: #14002a; border: 2px solid #ff2bd6; border-radius: 6px; outline: none; }
.arcade-screen__name input:focus { box-shadow: 0 0 14px #ff2bd6; }
.arcade-screen__err { color: #ff3b3b; }
.arcade-screen__fine { font-size: 0.5rem !important; color: #9fb3c8; margin: 8px 0 0 !important; }
.arcade-screen button:disabled { opacity: 0.4; animation: none; cursor: default; }
.arcade-screen button {
  margin-top: 6px; padding: 16px 22px; border: 0; border-radius: 8px; cursor: pointer;
  font: 400 0.85rem 'Press Start 2P', ui-monospace, 'Courier New', monospace; color: #14002a;
  background: linear-gradient(#ffe600, #ffb300); box-shadow: 0 0 18px #ffb300, 0 5px 0 #b36b00; animation: blink 1.1s steps(2) infinite;
}
.arcade-screen button:hover { animation: none; filter: brightness(1.1); }
@keyframes blink { 50% { opacity: 0.35; } }
@media (max-width: 720px) {
  .arcade { top: 62px; gap: 6px; padding: 8px 10px; }
  .arcade__cell { min-width: 56px; }
  .arcade__cell b { font-size: 0.75rem; }
}
</style>
