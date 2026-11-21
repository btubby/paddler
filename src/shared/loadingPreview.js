// Add ?loading to a page's address to see the loading animation (LoadingRiver.vue) without
// waiting for the results to be read: the lead boat paddles the course in about 8 seconds,
// then the portage for 4, then it goes. Pages show it alongside their real loading state.
import { reactive } from 'vue'

export function useLoadingPreview() {
  const preview = reactive({ on: false, progress: 0, working: false })
  if (typeof location === 'undefined' || !new URLSearchParams(location.search).has('loading')) return preview
  preview.on = true
  const start = Date.now()
  const timer = setInterval(() => {
    const t = (Date.now() - start) / 1000
    if (t < 8) preview.progress = t / 8
    else if (t < 12) { preview.progress = 1; preview.working = true }
    else { preview.on = false; clearInterval(timer) }
  }, 250)
  return preview
}
