<script setup>
// The sky-blue look: a pale blue field with a big sweep of brighter blue in the bottom right
// (a huge ellipse of the pale colour, top left, over a full-window blue layer), and a matching
// blue palette for the page. Put <SkyBackground /> at the top of a page's template.
// Not for the night and high-contrast colour schemes, which keep their own colours.
import { onMounted, onBeforeUnmount } from 'vue'
onMounted(() => document.documentElement.classList.add('sky'))
onBeforeUnmount(() => document.documentElement.classList.remove('sky'))
</script>

<template>
  <div class="sky-bg" aria-hidden="true"></div>
</template>

<style>
.sky-bg { position: fixed; inset: 0; z-index: -1; overflow: hidden; background: #5dcbf9; pointer-events: none; }
.sky-bg::before { content: ''; position: absolute; left: -75vw; top: -119vh; width: 150vw; height: 238vh; border-radius: 50%; background: #e9f6fc; }
:root[data-theme="night"] .sky-bg, :root[data-theme="contrast"] .sky-bg { display: none; }
:root.sky:not([data-theme="night"]):not([data-theme="contrast"]) {
  --paper: #e9f6fc; --mist: #d2ebf8; --line: #b9dff2; --pool: #d9eefa; --heading: #0c2b3d; --teal: #0b7bb0;
  --gold: #5dcbf9; --on-clay: #0c2b3d;
}
</style>
