<script setup>
// Your training (/my-training/): a paddler's charts of their training from Strava, from either
//   - their Strava download (the archive Strava emails them), read in their browser: works for
//     everyone, nothing uploaded (stravaExport.js), remembered in this browser only; or
//   - connecting their Strava account (needs the club's Strava app, which Strava limits to a
//     few athletes until it reviews it).
// The charts: hours a week by kind (paddling, ergo, gym...), paddling speed over time,
// and km a month. Only the person who connected sees their data (Strava's API terms): the
// page asks /api/strava/activities, which answers only the browser that connected
// (netlify/functions/strava.js). ?demo shows made-up example data.
import { computed, onMounted, ref } from 'vue'
import SiteNav from '../shared/SiteNav.vue'
import KayakDash from '../shared/KayakDash.vue'
import BarChart from './BarChart.vue'
import DotChart from './DotChart.vue'
import DownloadHelp from './DownloadHelp.vue'
import { readStravaFile } from './stravaExport.js'
import { GROUPS, groupOf, inRange, weekly, monthly, paddleSpeeds, heartRates, summary, fmtHours, demoActivities } from './stats.js'

const params = new URLSearchParams(location.search)
const demo = params.has('demo')
const ERRORS = {
  'not-set-up': 'Strava isn’t set up on the club site yet (the club’s Strava app details are missing).',
  expired: 'That took too long or came from another browser: try connecting again.',
  denied: 'Strava wasn’t connected (access was declined).',
  scope: 'To draw the charts, tick “View data about your activities” when Strava asks.',
  strava: 'Strava didn’t answer properly: try again in a minute.'
}
const problem = ref(ERRORS[params.get('error')] || '')
if (params.has('error')) history.replaceState(null, '', location.pathname)

const state = ref('loading') // loading | out | in
const canConnect = ref(false) // the club's Strava app is set up
const source = ref(demo ? 'demo' : '') // demo | strava | file
const fileInfo = ref(null) // { file, loadedAt } for a Strava download
const athlete = ref(null)
const activities = ref([])
const reading = ref(false)
const note = ref('')
const now = Date.now()

// a Strava download, kept in this browser only (so it's there next time), never sent anywhere
const SAVED = 'bscc-training-download'
function savedDownload() {
  try { return JSON.parse(localStorage.getItem(SAVED) || 'null') } catch { return null }
}
function showDownload(d) {
  activities.value = d.activities
  athlete.value = d.name ? { name: d.name } : null
  fileInfo.value = { file: d.file, loadedAt: d.loadedAt }
  source.value = 'file'
  state.value = 'in'
}

async function load(refresh = false) {
  if (demo) {
    activities.value = demoActivities(now)
    athlete.value = { name: 'Example paddler' }
    state.value = 'in'
    return
  }
  let body = {}
  try {
    const res = await fetch(`/api/strava/activities${refresh ? '?refresh=1' : ''}`, { credentials: 'same-origin' })
    body = await res.json().catch(() => ({}))
  } catch {}
  canConnect.value = body.error !== 'not-set-up' && body.connected !== undefined
  if (!body.connected) {
    const saved = savedDownload()
    if (saved?.activities?.length) return showDownload(saved)
    state.value = 'out'
    if (body.error && body.error !== 'not-set-up') problem.value = body.error
    return
  }
  source.value = 'strava'
  athlete.value = body.athlete
  activities.value = body.activities || []
  note.value = body.stale ? `Couldn’t bring this up to date: ${body.error}` : ''
  state.value = 'in'
  // the first read is done a few pages at a time: keep going until it's all in
  reading.value = !!body.more
  if (body.more) setTimeout(() => load(), 400)
}

// a dropped or chosen Strava download
const reading2 = ref(false)
const dragging = ref(false)
async function useFile(file) {
  if (!file) return
  problem.value = ''
  note.value = ''
  reading2.value = true
  try {
    const { activities: acts, name } = await readStravaFile(file)
    if (!acts.length) throw new Error('No activities in that file')
    const d = { activities: acts, name, file: file.name, loadedAt: new Date().toISOString() }
    try { localStorage.setItem(SAVED, JSON.stringify(d)) } catch {} // too big, or storage off: just this visit
    showDownload(d)
  } catch (e) {
    problem.value = `Couldn’t read that file: ${e.message}`
  } finally {
    reading2.value = false
  }
}
const onDrop = e => { dragging.value = false; useFile(e.dataTransfer?.files?.[0]) }
const onPick = e => { useFile(e.target.files?.[0]); e.target.value = '' }
function forgetDownload() {
  try { localStorage.removeItem(SAVED) } catch {}
  activities.value = []
  athlete.value = null
  fileInfo.value = null
  source.value = ''
  state.value = 'out'
  note.value = 'Forgotten: your Strava download has been removed from this browser.'
}
// the club's Strava page, and (for someone who has connected) its latest activities. Asked for only
// when they press the button, so opening this page doesn't call Strava or the server for it.
const CLUB_URL = 'https://www.strava.com/clubs/stortcanoe'
const club = ref({ state: 'idle', activities: [], member: true, error: '' })
async function loadClub() {
  club.value = { ...club.value, state: 'loading', error: '' }
  try {
    const res = await fetch('/api/strava/club', { credentials: 'same-origin' })
    const body = await res.json()
    if (!body.connected) { club.value = { state: 'idle', activities: [], member: true, error: body.error || 'Connect your Strava first' }; return }
    club.value = { state: 'done', activities: body.activities || [], member: body.member !== false, error: body.error || '', fetchedAt: body.fetchedAt }
  } catch {
    club.value = { state: 'done', activities: [], member: true, error: 'Couldn’t reach the club site: try again' }
  }
}
const clubTotals = computed(() => {
  const a = club.value.activities
  return { people: new Set(a.map(x => x.who)).size, km: a.filter(x => /kayak|canoe|row|paddle/i.test(x.type)).reduce((n, x) => n + x.distance, 0) / 1000 }
})
const fmtWhen = d => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
onMounted(() => load())

async function disconnect() {
  if (demo) return
  await fetch('/api/strava/disconnect', { method: 'POST', credentials: 'same-origin' }).catch(() => {})
  activities.value = []
  athlete.value = null
  state.value = 'out'
  problem.value = ''
  note.value = 'Disconnected: your Strava data has been deleted from the club site.'
}

// how far back to look
const RANGES = [
  { key: '3m', label: '3 months', days: 91 },
  { key: '1y', label: '12 months', days: 365 },
  { key: '2y', label: '2 years', days: 730 },
  { key: 'all', label: 'Everything', days: null }
]
const range = ref(params.get('range') && RANGES.some(r => r.key === params.get('range')) ? params.get('range') : '1y')
const from = computed(() => {
  const r = RANGES.find(x => x.key === range.value)
  if (r.days) return now - r.days * 864e5
  const first = activities.value.reduce((m, a) => (a.date < m ? a.date : m), '9999')
  return first === '9999' ? now - 365 * 864e5 : Date.parse(first.slice(0, 10))
})
const shown = computed(() => inRange(activities.value, from.value))

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const fmtDay = d => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })

// weekly hours; over longer ranges, weeks are grouped into months so the bars stay readable
const volume = computed(() => {
  const v = volumeBars()
  return { ...v, bars: withYears(v.bars) }
})
function volumeBars() {
  const weeks = weekly(shown.value, from.value, now)
  if (weeks.length <= 60) {
    return {
      per: 'week',
      bars: weeks.map((w, i) => {
        const d = new Date(w.start)
        const newMonth = i === 0 || new Date(weeks[i - 1].start).getUTCMonth() !== d.getUTCMonth()
        return { key: w.start, label: `Week of ${fmtDay(w.start)} · ${w.sessions} session${w.sessions === 1 ? '' : 's'}`, tick: newMonth && (weeks.length <= 20 || d.getUTCMonth() % 2 === 0) ? MONTHS[d.getUTCMonth()] : '', values: w.hours }
      })
    }
  }
  const byMonth = new Map()
  for (const w of weeks) {
    const k = w.start.slice(0, 7)
    if (!byMonth.has(k)) byMonth.set(k, Object.fromEntries(GROUPS.map(g => [g.key, 0])))
    for (const g of GROUPS) byMonth.get(k)[g.key] += w.hours[g.key]
  }
  return {
    per: 'month',
    bars: [...byMonth].map(([k, values]) => {
      const m = +k.slice(5) - 1
      return { key: k, label: `${MONTHS[m]} ${k.slice(0, 4)}`, tick: m % 3 === 0 ? MONTHS[m] : '', values }
    })
  }
}
// the year under the first labelled bar, and under the first one of each new year
function withYears(bars) {
  let last = null
  return bars.map(b => {
    if (!b.tick) return b
    const yr = b.key.slice(0, 4)
    const out = yr !== last ? { ...b, year: yr } : b
    last = yr
    return out
  })
}
const usedGroups = computed(() => GROUPS.filter(g => shown.value.some(a => groupOf(a) === g.key)))
const speeds = computed(() => paddleSpeeds(shown.value))
const speedDots = computed(() => speeds.value.points.map(p => ({
  id: p.id, date: p.date, y: p.kmh, size: Math.min(1, Math.sqrt(p.km) / 5.5), color: 'var(--teal)',
  tip: [p.name, `${fmtDay(p.date)} · ${p.km.toFixed(1)} km in ${fmtHours(p.moving / 3600)}`, `${p.kmh.toFixed(1)} km/h${p.hr ? ` · average heart rate ${Math.round(p.hr)}` : ''}`]
})))
const speedTrend = computed(() => speeds.value.trend.map(t => ({ date: t.date, y: t.kmh })))

// heart rate
const hr = computed(() => heartRates(shown.value))
const colorOf = g => GROUPS.find(x => x.key === g).color
const hrDots = computed(() => hr.value.points.map(p => ({
  id: p.id, date: p.date, y: p.hr, size: Math.min(1, p.moving / 7200), color: colorOf(p.group),
  tip: [p.name, `${fmtDay(p.date)} · ${GROUPS.find(g => g.key === p.group).label} · ${fmtHours(p.moving / 3600)}`,
    `Average ${Math.round(p.hr)} bpm${p.maxHr ? ` · highest ${Math.round(p.maxHr)}` : ''}${p.kmh && p.group === 'paddle' ? ` · ${p.kmh.toFixed(1)} km/h` : ''}`]
})))
const hrTrend = computed(() => hr.value.trend.map(t => ({ date: t.date, y: t.hr })))
const hrLegend = computed(() => hr.value.byGroup.map(g => ({ label: g.label, color: g.color })))
const paddlesShown = computed(() => shown.value.filter(a => groupOf(a) === 'paddle' && (a.moving || 0) >= 600).length)
const distance = computed(() => withYears(monthly(shown.value, from.value, now).map(m => {
  const i = +m.month.slice(5) - 1
  return { key: m.month, label: `${MONTHS[i]} ${m.month.slice(0, 4)}`, tick: (range.value === '3m' || range.value === '1y' || i % 3 === 0) ? MONTHS[i] : '', values: { paddle: m.paddle, ergo: m.ergo } }
})))
const distSeries = [GROUPS[0], GROUPS[1]]
const stats = computed(() => summary(activities.value, now))
const speedChange = computed(() => {
  const t = speeds.value.trend
  if (t.length < 2) return null
  return ((t[t.length - 1].kmh - t[0].kmh) / t[0].kmh) * 100
})
const recent = computed(() => [...activities.value].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 12))
const groupLabel = a => GROUPS.find(g => g.key === groupOf(a)).label
</script>

<template>
  <SiteNav current="/my-training/" />
  <main class="tr">
    <header class="tr__head">
      <p class="tr__kicker">Your training · BSCC</p>
      <h1>{{ state === 'in' && athlete?.name ? athlete.name : 'Your training' }}</h1>
      <p class="tr__lede">Charts of your training from Strava: how much, what kind, and whether your paddling is getting quicker.</p>
    </header>

    <p v-if="demo" class="banner">Example data, made up to show what the page looks like. <a href="/my-training/">Connect your own Strava</a></p>
    <p v-if="problem" class="banner banner--warn">{{ problem }}</p>
    <p v-if="note" class="banner">{{ note }}</p>

    <KayakDash v-if="state === 'loading'" message="Loading your training…" />

    <template v-else-if="state === 'out'">
      <section class="card upload">
        <h2>Use your Strava download</h2>
        <p>Works with any Strava account, free or paid. Ask Strava for a copy of your data, then drop the file it sends you here.
          <strong>It stays on your computer:</strong> the page reads it in your browser and nothing is uploaded.</p>
        <DownloadHelp />
        <label class="drop" :class="{ on: dragging }" @dragover.prevent="dragging = true" @dragleave="dragging = false" @drop.prevent="onDrop">
          <input type="file" accept=".zip,.csv,application/zip,text/csv" class="drop__input" @change="onPick" />
          <strong>{{ reading2 ? 'Reading your activities…' : 'Drop your Strava zip here' }}</strong>
          <span>or click to choose it (or activities.csv, if your computer unzipped it into a folder)</span>
        </label>
      </section>

      <section v-if="canConnect" class="card connect">
        <h2>Or connect your Strava</h2>
        <p>Strava asks you to sign in and allow the club site to read your activities, and the charts then keep up to date by themselves.
          The club’s Strava connection only has room for a few paddlers, so it may say no: if so, use your download above.</p>
        <ul class="connect__points">
          <li><strong>Only you see them.</strong> Your Strava data is shown only in the browser you connect from: not to coaches and not to anyone else.</li>
          <li><strong>Only the summaries are kept</strong> (date, type, distance, time, speed, heart rate): no GPS tracks, maps or photos.</li>
          <li><strong>Disconnect any time</strong> here (everything kept is deleted), or in Strava under Settings → My Apps.</li>
        </ul>
        <a class="strava-btn" href="/api/strava/connect">Connect with Strava</a>
      </section>
      <p class="connect__demo"><a href="/my-training/?demo">See an example of the charts</a></p>
      <section class="card club">
        <h2>Our club on Strava</h2>
        <p>Bishops Stortford Canoe Club has a Strava club. Join it to share your paddles with the rest of us; Strava only shows what members have shared, to members.</p>
        <a class="strava-btn" :href="CLUB_URL" target="_blank" rel="noopener">Join the club on Strava</a>
      </section>
    </template>

    <template v-else>
      <div class="tr__bar">
        <div class="ranges" role="group" aria-label="How far back">
          <button v-for="r in RANGES" :key="r.key" type="button" :class="{ on: range === r.key }" :aria-pressed="range === r.key" @click="range = r.key">{{ r.label }}</button>
        </div>
        <span v-if="reading" class="tr__status">Reading your older activities from Strava… ({{ activities.length }} so far)</span>
      </div>

      <div class="tiles">
        <div class="tile"><span>Last 4 weeks</span><strong>{{ fmtHours(stats.hours4) }}</strong><small>{{ stats.sessions4 }} sessions</small></div>
        <div class="tile"><span>A typical week lately</span><strong>{{ fmtHours(stats.perWeek12) }}</strong><small>average over 12 weeks</small></div>
        <div class="tile"><span>Paddled this year</span><strong>{{ Math.round(stats.paddleKmYear) }} km</strong><small>on the water</small></div>
        <div class="tile"><span>Paddling speed</span><strong>{{ speedChange == null ? '–' : (speedChange >= 0 ? '+' : '') + speedChange.toFixed(1) + '%' }}</strong><small>{{ speedChange == null ? 'not enough paddles yet' : 'trend over ' + RANGES.find(r => r.key === range).label.toLowerCase() }}</small></div>
      </div>

      <section v-if="!shown.length" class="card"><p>No activities in this time. Try a longer range.</p></section>
      <template v-else>
        <section class="card">
          <h2>Training each {{ volume.per }}</h2>
          <p class="card__sub">Hours of moving time, by kind of training. Ergo: kayak sessions marked as indoor, or with “ergo” in the name.</p>
          <BarChart :bars="volume.bars" :series="usedGroups" :unit="fmtHours" :title="`Hours of training each ${volume.per}`" />
        </section>

        <section class="card">
          <h2>Paddling speed</h2>
          <p class="card__sub">Average moving speed of each paddle on the water (2 km or more). Wind, flow and the kind of session all change it, so the trend matters more than any one dot.</p>
          <DotChart v-if="speedDots.length >= 2" :points="speedDots" :trend="speedTrend" unit="km/h" title="Paddling speed over time" :legend="[{ label: 'A paddle (bigger: further)', color: 'var(--teal)' }]" />
          <p v-else class="tr__status">Not enough paddles in this time to draw a chart.</p>
        </section>

        <section class="card">
          <h2>Heart rate</h2>
          <p class="card__sub">The average heart rate of each session (bigger dots: longer sessions), by kind of training. The trend line is paddling on the water.</p>
          <template v-if="hrDots.length >= 2">
            <div class="hr-stats">
              <div v-for="g in hr.byGroup" :key="g.key"><i :style="{ background: g.color }" /><span>{{ g.label }}</span><strong>{{ Math.round(g.avg) }} bpm</strong><small>typical average · {{ g.n }} session{{ g.n === 1 ? '' : 's' }}</small></div>
              <div v-if="hr.highest"><i style="background: var(--heading)" /><span>Highest recorded</span><strong>{{ Math.round(hr.highest) }} bpm</strong><small>in this time</small></div>
            </div>
            <DotChart :points="hrDots" :trend="hrTrend" unit="bpm" title="Average heart rate of each session" :legend="hrLegend" />
            <p class="card__note">
              Heart rates differ a lot from person to person, so there’s no “right” number: what matters is how yours changes. A watch on the wrist often reads low or patchy in a kayak
              (the wrist flexes and grips the paddle), so a chest strap gives far steadier numbers on the water.
              <template v-if="hr.paddlesWithHr < paddlesShown"> {{ paddlesShown - hr.paddlesWithHr }} of {{ paddlesShown }} paddles in this time have no heart rate.</template>
            </p>
          </template>
          <p v-else class="tr__status">No sessions with a heart rate in this time.</p>
        </section>

        <section class="card">
          <h2>Distance paddled each month</h2>
          <BarChart :bars="distance" :series="distSeries" :unit="v => `${Math.round(v)} km`" title="Kilometres paddled each month" />
        </section>
      </template>

      <section class="card">
        <h2>Latest activities</h2>
        <table class="acts">
          <thead><tr><th>Date</th><th>Activity</th><th>Kind</th><th class="num">Distance</th><th class="num">Time</th><th class="num">Speed</th><th></th></tr></thead>
          <tbody>
            <tr v-for="a in recent" :key="a.id">
              <td>{{ fmtDay(a.date.slice(0, 10)) }}</td>
              <td>{{ a.name }}</td>
              <td>{{ groupLabel(a) }}</td>
              <td class="num">{{ a.distance ? (a.distance / 1000).toFixed(1) + ' km' : '' }}</td>
              <td class="num">{{ fmtHours(a.moving / 3600) }}</td>
              <td class="num">{{ a.speed && a.distance ? (a.speed * 3.6).toFixed(1) + ' km/h' : '' }}</td>
              <td><a v-if="source !== 'demo'" class="view" :href="`https://www.strava.com/activities/${a.id}`" target="_blank" rel="noopener">View on Strava</a></td>
            </tr>
          </tbody>
        </table>
      </section>

      <section class="card club">
        <h2>Our club on Strava</h2>
        <template v-if="source === 'strava'">
          <p class="card__sub">What members of Bishops Stortford Canoe Club have lately shared in the Strava club. Only people who have connected here can see this, and Strava shows only first names and last initials.</p>
          <button v-if="club.state === 'idle' || club.state === 'loading'" type="button" class="strava-btn strava-btn--plain" :disabled="club.state === 'loading'" :aria-busy="club.state === 'loading'" @click="loadClub">{{ club.state === 'loading' ? 'Asking Strava…' : 'Show the club’s latest activities' }}</button>
          <p v-if="club.error" class="card__note">{{ club.error }}</p>
          <p v-if="club.state === 'done' && !club.member" class="card__note">Strava only shows the club’s activities to its members, and you aren’t one yet. <a :href="CLUB_URL" target="_blank" rel="noopener">Join the club on Strava</a>, then come back.</p>
          <template v-else-if="club.state === 'done' && club.activities.length">
            <p class="card__note">{{ club.activities.length }} latest activities from {{ clubTotals.people }} {{ clubTotals.people === 1 ? 'member' : 'members' }}<template v-if="clubTotals.km"> · {{ Math.round(clubTotals.km) }} km on the water</template>.</p>
            <table class="acts">
              <thead><tr><th>Who</th><th>Activity</th><th class="num">Distance</th><th class="num">Time</th></tr></thead>
              <tbody>
                <tr v-for="(a, i) in club.activities" :key="i">
                  <td>{{ a.who }}</td>
                  <td>{{ a.name }}<small class="club__kind"> · {{ a.type }}</small></td>
                  <td class="num">{{ a.distance ? (a.distance / 1000).toFixed(1) + ' km' : '' }}</td>
                  <td class="num">{{ fmtHours(a.moving / 3600) }}</td>
                </tr>
              </tbody>
            </table>
            <p class="card__note"><a :href="CLUB_URL" target="_blank" rel="noopener">Open the club on Strava</a> for more.</p>
          </template>
          <p v-else-if="club.state === 'done' && club.member && !club.error" class="card__note">Nothing shared lately. <a :href="CLUB_URL" target="_blank" rel="noopener">Open the club on Strava</a>.</p>
        </template>
        <template v-else>
          <p>Bishops Stortford Canoe Club has a Strava club: join it to share your paddles with the rest of us. To see the club’s latest activities here, connect your Strava account instead of using a download.</p>
          <a class="strava-btn" :href="CLUB_URL" target="_blank" rel="noopener">Join the club on Strava</a>
        </template>
      </section>

      <footer class="tr__foot">
        <span class="powered">Powered by Strava</span>
        <span v-if="source === 'file'">
          From your Strava download, read {{ fmtWhen(fileInfo.loadedAt) }} (kept in this browser only) ·
          <label class="link">Use a newer download<input type="file" accept=".zip,.csv,application/zip,text/csv" class="drop__input" @change="onPick" /></label> ·
          <button type="button" class="link" @click="forgetDownload">Forget it</button>
        </span>
        <span v-else-if="source === 'strava'">
          <button type="button" class="link" @click="load(true)">Bring up to date</button> ·
          <button type="button" class="link" @click="disconnect">Disconnect Strava (deletes your data here)</button>
        </span>
      </footer>
    </template>
  </main>
</template>

<style scoped>
.tr { max-width: 1080px; margin: 0 auto; padding: 18px 24px 60px; }
.tr__head { margin: 22px 0 18px; }
.tr__kicker { margin: 0; font-size: 0.78rem; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--clay); }
.tr__head h1 { font-size: clamp(2rem, 5vw, 3rem); color: var(--heading); margin: 2px 0 6px; }
.tr__lede { margin: 0; color: var(--muted); max-width: 60ch; }
.tr__status { color: var(--muted); font-size: 0.9rem; }
.banner { padding: 10px 14px; border-radius: 6px; background: var(--surface); border: 1.5px solid var(--line); border-left: 5px solid var(--teal); }
.banner--warn { border-left-color: var(--clay); }
.card { background: var(--surface); border: 1.5px solid var(--line); border-radius: 8px; padding: 18px 20px; margin: 0 0 18px; }
.card h2 { margin: 0 0 4px; color: var(--heading); font: 700 1.5rem var(--font-display); }
.card__sub { margin: 0 0 12px; color: var(--muted); font-size: 0.88rem; }
.card__note { margin: 12px 0 0; color: var(--muted); font-size: 0.84rem; line-height: 1.5; }
.hr-stats { display: flex; flex-wrap: wrap; gap: 10px 26px; margin: 0 0 12px; }
.hr-stats div { display: grid; grid-template-columns: auto 1fr; column-gap: 8px; align-items: baseline; }
.hr-stats i { width: 10px; height: 10px; border-radius: 50%; grid-row: span 3; align-self: start; margin-top: 4px; }
.hr-stats span, .hr-stats small { color: var(--muted); font-size: 0.82rem; }
.hr-stats strong { font: 700 1.5rem var(--font-display); color: var(--heading); }
.connect__points { padding-left: 18px; line-height: 1.5; }
.connect__demo { margin: 0 0 18px; font-size: 0.9rem; }
.drop { display: grid; gap: 4px; place-items: center; text-align: center; margin-top: 16px; padding: 28px 16px; border: 2px dashed var(--teal); border-radius: 8px; background: var(--paper); cursor: pointer; color: var(--muted); font-size: 0.88rem; }
.drop strong { color: var(--heading); font-size: 1.05rem; }
.drop.on, .drop:hover { background: var(--mist); }
.drop:focus-within { outline: 3px solid var(--gold); outline-offset: 2px; }
.drop__input { position: absolute; width: 1px; height: 1px; opacity: 0; overflow: hidden; }
label.link { position: relative; }
/* Strava's brand orange, for the button that goes to Strava */
.strava-btn { display: inline-block; background: #fc4c02; color: #fff; font: 600 1rem var(--font-body); padding: 11px 20px; border-radius: 4px; text-decoration: none; }
.strava-btn:hover { background: #e34402; }
.strava-btn:focus-visible { outline: 3px solid var(--gold); outline-offset: 2px; }
.tr__bar { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; margin: 0 0 14px; }
.ranges { display: flex; flex-wrap: wrap; gap: 8px; }
.ranges button { padding: 7px 14px; border: 1.5px solid var(--teal); border-radius: 999px; background: var(--surface); color: var(--heading); font: 600 0.9rem var(--font-body); cursor: pointer; }
.ranges button.on { background: var(--teal); color: var(--white); }
.tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 14px; margin: 0 0 18px; }
.tile { background: var(--surface); border: 1.5px solid var(--line); border-radius: 8px; padding: 14px 16px; display: grid; gap: 2px; }
.tile span, .tile small { color: var(--muted); font-size: 0.85rem; }
.tile strong { font: 700 1.9rem var(--font-display); color: var(--heading); }
.acts { width: 100%; border-collapse: collapse; font-size: 0.88rem; }
.acts th, .acts td { text-align: left; padding: 7px 8px; border-bottom: 1px solid var(--line); }
.acts th { color: var(--muted); font-weight: 600; }
.acts .num { text-align: right; white-space: nowrap; }
.club__kind { color: var(--muted); }
.club .strava-btn { display: inline-block; }
.club .strava-btn--plain { border: 0; cursor: pointer; font: inherit; }
.club .strava-btn:disabled { opacity: 0.6; }
.view { color: #fc4c02; font-weight: 600; white-space: nowrap; }
.tr__foot { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 10px; color: var(--muted); font-size: 0.85rem; }
.powered { font-weight: 700; color: #fc4c02; }
.link { background: none; border: 0; padding: 0; color: var(--heading); text-decoration: underline; font: inherit; cursor: pointer; }
@media (max-width: 640px) {
  .tr { padding: 12px 16px 40px; }
  .acts th:nth-child(3), .acts td:nth-child(3), .acts th:nth-child(6), .acts td:nth-child(6) { display: none; }
}
</style>
