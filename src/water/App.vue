<script setup>
// On the water: a short, soft-focus loop from a paddler's seat, filling the window.
// Click the video (or the play button) to pause and play. Visitors who've asked their device for less
// motion get the still picture and a play button instead of it starting by itself.
import { ref, onMounted } from 'vue'
import SiteNav from '../shared/SiteNav.vue'

const video = ref(null)
const playing = ref(false)
const reduced = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

function toggle() {
  const v = video.value
  if (!v) return
  if (v.paused) v.play().catch(() => {})
  else v.pause()
}

onMounted(() => {
  const v = video.value
  v.addEventListener('play', () => { playing.value = true })
  v.addEventListener('pause', () => { playing.value = false })
  if (!reduced) v.play().catch(() => {}) // browsers allow muted autoplay
})
</script>

<template>
  <main class="water">
    <video
      ref="video"
      class="water__video"
      src="/on-the-water/loop.mp4"
      poster="/on-the-water/poster.png"
      muted
      loop
      playsinline
      preload="auto"
      aria-label="Looping video from a kayak seat: the bow and a paddle blade on calm water, with trees and sky reflected"
      @click="toggle"
    ></video>
    <button class="water__play" :class="{ 'water__play--hidden': playing }" :aria-label="playing ? 'Pause' : 'Play'" @click="toggle">
      <span aria-hidden="true">{{ playing ? '❚❚' : '▶' }}</span>
    </button>
    <SiteNav current="/on-the-water/" overlay />
  </main>
</template>

<style>
html, body, #app { margin: 0; height: 100%; background: #000; overflow: hidden; }
</style>

<style scoped>
.water { position: fixed; inset: 0; }
.water__video {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover; /* fill the window, cropping the edges if need be */
  background: #000;
  cursor: pointer;
}
.water__play {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  width: 84px;
  height: 84px;
  border: 2px solid rgba(255, 255, 255, 0.75);
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.35);
  color: #fff;
  font-size: 1.6rem;
  cursor: pointer;
  backdrop-filter: blur(4px);
  transition: opacity 0.3s ease;
}
/* while playing, the button only shows when it has keyboard focus */
.water__play--hidden { opacity: 0; }
.water__play--hidden:focus-visible { opacity: 1; }
</style>
