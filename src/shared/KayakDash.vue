<script setup>
// Kayaks dashing about in a box, while something on the page loads (src/shared/kayakDash.js)
import { computed } from 'vue'
import { kayakDashCss, kayakDashHtml } from './kayakDash.js'

const props = defineProps({ message: { type: String, default: 'Loading…' } })
const html = computed(() => kayakDashHtml({ inline: true, message: props.message }))
// the styles once per page, shared by every box
if (typeof document !== 'undefined' && !document.getElementById('kd-css')) {
  const s = document.createElement('style')
  s.id = 'kd-css'
  s.textContent = kayakDashCss
  document.head.appendChild(s)
}
</script>

<template>
  <div v-html="html" />
</template>
