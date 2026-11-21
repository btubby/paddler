// Page-wide loading feedback: a thin bar across the top while any request to this site is in flight
// (shown only if it takes more than 200ms, so quick answers don't flicker). Import once per page.
import './feedback.css'

if (typeof window !== 'undefined' && !window.__fbBar) {
  window.__fbBar = true
  let pending = 0
  let timer = 0
  let bar = null
  const show = on => {
    if (!bar) {
      bar = document.createElement('div')
      bar.id = 'fb-bar'
      bar.setAttribute('aria-hidden', 'true')
      document.body.appendChild(bar)
    }
    bar.classList.toggle('on', on)
  }
  const start = () => { if (++pending === 1) timer = setTimeout(() => show(true), 200) }
  const stop = () => { if (--pending <= 0) { pending = 0; clearTimeout(timer); if (bar) show(false) } }
  const real = window.fetch.bind(window)
  window.fetch = (input, init) => {
    let own = true
    try { own = new URL(typeof input === 'string' ? input : input.url, location.href).origin === location.origin } catch {}
    if (!own) return real(input, init)
    start()
    return real(input, init).finally(stop)
  }
}
