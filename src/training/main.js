import '../shared/feedback.js'
import { createApp } from 'vue'
import App from './App.vue'
import '../coaching/style.css'

try {
  const theme = JSON.parse(localStorage.getItem('bscc-coaching-app-v3') || '{}')?.options?.theme
  if (theme) document.documentElement.dataset.theme = theme
} catch {}

createApp(App).mount('#app')
