<script setup>
// The sweeping banner from the homepage game (when a multiplier is won), reused for a welcome
// after signing in and for congratulating a paddler on a new award. Plays once, then removes itself.
import { ref, onMounted } from 'vue'
const props = defineProps({
  top: { type: String, default: 'ALSO' },
  headline: { type: String, required: true },
  ms: { type: Number, default: 2400 }
})
const open = ref(true)
onMounted(() => setTimeout(() => { open.value = false }, props.ms + 300))
</script>

<template>
  <div v-if="open" class="stripe" role="status"><div class="stripe__band"><span>★ {{ top }} ★</span><b>{{ headline }}</b><span>★ {{ top }} ★</span></div></div>
</template>

<style scoped>
.stripe { position: fixed; left: 0; right: 0; top: 38%; z-index: 60; height: 110px; pointer-events: none; overflow: hidden; }
.stripe__band {
  position: absolute; inset: 0; display: flex; align-items: center; justify-content: space-around; gap: 1rem; padding: 0 2rem;
  background: linear-gradient(90deg, #ff2bd6, #ffe600 50%, #00e5ff); border-block: 4px solid #fff;
  box-shadow: 0 0 24px rgba(255, 43, 214, 0.7), 0 0 48px rgba(0, 229, 255, 0.5);
  font-family: 'Press Start 2P', ui-monospace, monospace; color: #1a0033; text-align: center;
  transform: translateX(-110%) skewX(-12deg); animation: stripe-sweep 2.2s cubic-bezier(0.2, 0.8, 0.2, 1) forwards;
}
.stripe__band span { font-size: 0.7rem; opacity: 0.85; }
.stripe__band b { font-size: clamp(1.1rem, 5vw, 2.2rem); color: #fff; text-shadow: 3px 3px 0 #1a0033; animation: stripe-pulse 0.3s steps(2) 6; }
@keyframes stripe-sweep { 0% { transform: translateX(-110%) skewX(-12deg); } 18% { transform: translateX(0) skewX(-12deg); } 82% { transform: translateX(0) skewX(-12deg); } 100% { transform: translateX(110%) skewX(-12deg); } }
@keyframes stripe-pulse { 50% { transform: scale(1.12); } }
@media (max-width: 720px) { .stripe__band span { display: none; } .stripe__band { justify-content: center; } }
@media (prefers-reduced-motion: reduce) { .stripe__band { animation-duration: 0.01s; transform: none; } }
</style>
