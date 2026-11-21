import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath } from 'node:url'
import { kayakDashHtml, kayakDashCss } from './src/shared/kayakDash.js'

// The site has eleven pages, each its own HTML entry with its own Vue app and styles:
//   /                 index.html                  Kayak Swarm (src/home)
//   /paddlers/        paddlers/index.html         paddler detail: the coaching groups board (src/coaching)
//   /paddlers/paddler/  paddlers/paddler/index.html  one paddler: results and coaching ideas, no password (src/paddler)
//   /my-racing/       my-racing/index.html        a paddler's own page, from a link a coach shares (src/paddler)
//   /my-training/     my-training/index.html      your own Strava training charts (src/training)
//   /race-planner/    race-planner/index.html     K1 / K2 race line-up, public (src/raceplan)
//   /bscc-stars/      bscc-stars/index.html       BSCC Star Awards certificates (src/stars)
//   /resources/       resources/index.html        Resources: coaching videos (src/resources)
//   /on-the-water/    on-the-water/index.html     On the water: a looping kayak video (src/water)
//   /club-race/       club-race/index.html        How the club did at its latest race, public (src/clubrace)
//   /roles/           roles/index.html            Roles: who may sign in with Google as a coach etc., admins only (src/roles)
const PAGES = ['paddlers', 'paddlers/paddler', 'race-planner', 'my-racing', 'my-training', 'bscc-stars', 'resources', 'on-the-water', 'club-race', 'roles']
const page = p => fileURLToPath(new URL(p, import.meta.url))

// Locally, send /paddlers to /paddlers/ (Vite would otherwise 404 it).
// On Netlify this happens by itself.
const trailingSlash = () => ({
  name: 'page-trailing-slash',
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      const [path, query] = req.url.split('?')
      if (PAGES.includes(path.replace(/^\/|\/$/g, '')) && !path.endsWith('/')) {
        res.statusCode = 301
        res.setHeader('Location', path + '/' + (query ? '?' + query : ''))
        return res.end()
      }
      next()
    })
  }
})

// Every page: kayaks dashing about until its app starts (src/shared/kayakDash.js). It sits
// inside <div id="app">, so the app replaces it as soon as it's running.
const pageLoading = () => ({
  name: 'page-loading',
  transformIndexHtml(html) {
    // ?kayaks on any page: keep it showing (tap to close), to see what it looks like
    const preview = `<script>if (/[?&]kayaks\\b/.test(location.search)) { var a = document.getElementById('app'), d = document.createElement('div');
      d.innerHTML = a.innerHTML.replace('Loading…', 'Loading… (preview: tap to close)'); d.querySelector('.kd').style.pointerEvents = 'auto';
      d.onclick = function () { d.remove() }; document.body.appendChild(d) }</script>`
    return html.replace('<div id="app"></div>', `<div id="app"><style>${kayakDashCss}</style>${kayakDashHtml()}</div>${preview}`)
  }
})

export default defineConfig({
  plugins: [vue(), trailingSlash(), pageLoading()],
  appType: 'mpa', // several pages, no single-page fallback
  build: {
    rollupOptions: {
      input: {
        home: page('./index.html'),
        coaching: page('./paddlers/index.html'),
        paddler: page('./paddlers/paddler/index.html'),
        raceplan: page('./race-planner/index.html'),
        myracing: page('./my-racing/index.html'),
        training: page('./my-training/index.html'),
        stars: page('./bscc-stars/index.html'),
        resources: page('./resources/index.html'),
        water: page('./on-the-water/index.html'),
        clubrace: page('./club-race/index.html'),
        roles: page('./roles/index.html')
      }
    }
  },
  // Fixed port: if it's taken (e.g. an older copy of the app still running), Vite stops with
  // an error instead of quietly moving to another port while `netlify dev` shows the old app.
  server: { port: 5190, strictPort: true }
})
