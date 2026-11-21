<script setup>
// Club at the last race: how the club's paddlers did at the latest race the club went to (or
// another of the last ten, picked from the list). The numbers come from /api/club-race, which
// reads the club's saved results: the same public results as the marathon results site.
// "Against their form" is each result against that paddler's own earlier results (- = quicker).
import { ref, computed, onMounted } from 'vue'
import SiteNav from '../shared/SiteNav.vue'
import SkyBackground from '../shared/SkyBackground.vue'
import { CLUB_CODE } from '../coaching/data/paddlers.js'

const BASE = 'https://entries.canoemarathon.org.uk'
const params = new URLSearchParams(location.search)
const data = ref(null)
const state = ref('loading') // loading | ok | pending | error
const message = ref('')
const chosen = ref(params.get('race') || '')

async function load() {
  state.value = 'loading'
  try {
    const res = await fetch(`/api/club-race?club=${CLUB_CODE}${chosen.value ? '&race=' + encodeURIComponent(chosen.value) : ''}`)
    const body = await res.json()
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`)
    if (body.pending) { state.value = 'pending'; return }
    data.value = body
    state.value = body.race ? 'ok' : 'none'
  } catch (e) {
    message.value = String(e.message || e)
    state.value = 'error'
  }
}
onMounted(load)
function pick() {
  const u = new URL(location.href)
  if (chosen.value && chosen.value !== data.value?.races?.[0]?.key) u.searchParams.set('race', chosen.value)
  else u.searchParams.delete('race')
  history.replaceState(null, '', u)
  load()
}

const fmtDate = d => (d ? new Date(d).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : '')
const fmtShort = d => (d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '')
const fmtTime = s => (s ? `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(Math.round(s % 60)).padStart(2, '0')}` : '')
const ord = n => n + (['th', 'st', 'nd', 'rd'][(n % 100 > 10 && n % 100 < 14) || n % 10 > 3 ? 0 : n % 10])
const place = c => (c.pos && c.of > 1 ? `${ord(c.pos)} of ${c.of}` : c.pos && c.of === 1 ? 'Only crew' : '')
const pct = v => (v == null ? '' : (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(1) + '%')
const words = v => (v == null ? '' : v <= -1 ? 'quicker than usual' : v >= 1 ? 'slower than usual' : 'about usual')
const cls = v => (v == null ? '' : v <= -1 ? 'good' : v >= 1 ? 'bad' : '')
const resultUrl = c => (data.value?.race?.url ? BASE + data.value.race.url + (c?.tab ? '#race-' + c.tab : '') : '')
const medal = c => (c.of > 1 && c.pos === 1 ? '🥇' : c.of > 1 && c.pos === 2 ? '🥈' : c.of > 1 && c.pos === 3 ? '🥉' : '')
const t = computed(() => data.value?.totals)
const headline = computed(() => {
  const x = t.value
  if (!x) return ''
  const bits = []
  if (x.wins) bits.push(`${x.wins} win${x.wins === 1 ? '' : 's'}`)
  if (x.podiums - x.wins > 0) bits.push(`${x.podiums - x.wins} more podium${x.podiums - x.wins === 1 ? '' : 's'}`)
  return `${x.paddlers} paddler${x.paddlers === 1 ? '' : 's'} raced in ${x.crews} crew${x.crews === 1 ? '' : 's'}` + (bits.length ? `, with ${bits.join(' and ')}.` : '.')
})
</script>

<template>
  <SkyBackground />
  <SiteNav current="/club-race/" />
  <main class="cr">
    <h1>Club at the last race</h1>

    <p v-if="state === 'loading'" class="cr__status loading-note"><span class="spin" /> Loading the results…</p>
    <p v-else-if="state === 'pending'" class="cr__status">The club’s results are being put together: try again in a few minutes.</p>
    <p v-else-if="state === 'none'" class="cr__status">No race results found for the club yet.</p>
    <p v-else-if="state === 'error'" class="cr__status cr__status--warn">Couldn’t load the results: {{ message }}</p>

    <template v-if="state === 'ok'">
      <header class="cr__race">
        <h2><a v-if="data.race.url" :href="BASE + data.race.url" target="_blank" rel="noopener">{{ data.race.name }}</a><template v-else>{{ data.race.name }}</template></h2>
        <p>{{ fmtDate(data.race.date) }}</p>
        <label v-if="data.races.length > 1" class="cr__pick">Another race
          <select v-model="chosen" @change="pick">
            <option value="">Latest: {{ data.races[0].name }}</option>
            <option v-for="r in data.races.slice(1)" :key="r.key" :value="r.key">{{ fmtShort(r.date) }} · {{ r.name }} ({{ r.n }})</option>
          </select>
        </label>
      </header>

      <p class="cr__headline">{{ headline }}</p>

      <section class="tiles" aria-label="Summary">
        <div class="tile"><span class="tile__label">Paddlers</span><span class="tile__value">{{ t.paddlers }}</span></div>
        <div class="tile"><span class="tile__label">Crews</span><span class="tile__value">{{ t.crews }}</span><span class="tile__note">a K2 counts once</span></div>
        <div class="tile"><span class="tile__label">Wins</span><span class="tile__value">{{ t.wins }}</span></div>
        <div class="tile"><span class="tile__label">Podiums</span><span class="tile__value">{{ t.podiums }}</span><span class="tile__note">top three, wins included</span></div>
        <div class="tile"><span class="tile__label">Quicker than usual</span><span class="tile__value up">{{ t.quicker }}<small v-if="t.rated"> of {{ t.rated }}</small></span><span class="tile__note">at least 1% up on their form</span></div>
        <div v-if="t.promotions" class="tile"><span class="tile__label">Promotions</span><span class="tile__value">{{ t.promotions }}</span></div>
      </section>

      <section v-if="t.best.length" class="card" aria-label="Best days">
        <h2>Best days against form</h2>
        <ol class="cr__best">
          <li v-for="(b, i) in t.best" :key="i"><strong>{{ b.name }}</strong> <span>{{ b.event }}</span> <em class="good">{{ pct(b.vs) }}</em></li>
        </ol>
      </section>

      <section class="card" aria-label="All the club's results">
        <h2>Every result</h2>
        <div class="table-wrap">
          <table class="cr__table">
            <thead><tr><th>Crew</th><th>Place</th><th>Time</th><th>Against their form</th></tr></thead>
            <tbody>
              <tr v-for="(c, i) in data.crews" :key="i">
                <td>
                  <strong>{{ c.members.map(m => m.name).join(' & ') }}</strong><template v-if="c.partner"> with {{ c.partner }}</template>
                  <small>{{ c.event }}<template v-if="c.members.some(m => m.pd)">
                    <template v-for="m in c.members.filter(m => m.pd)" :key="m.key"> · <span :class="/^P/i.test(m.pd) ? 'good' : ''">{{ /^P/i.test(m.pd) ? 'Promotion' : /^D/i.test(m.pd) ? 'Demotion offered' : m.pd }}<template v-if="c.members.length > 1"> ({{ m.name.split(' ')[0] }})</template></span></template></template></small>
                </td>
                <td class="cr__place"><span v-if="medal(c)" aria-hidden="true">{{ medal(c) }} </span>{{ place(c) }}</td>
                <td class="cr__time">{{ fmtTime(c.t) }}</td>
                <td class="cr__form">
                  <template v-if="c.members.some(m => m.vs != null)">
                    <span v-for="m in c.members.filter(m => m.vs != null)" :key="m.key" :class="cls(m.vs)" class="cr__vs">
                      <strong>{{ pct(m.vs) }}</strong> <small>{{ words(m.vs) }}<template v-if="c.members.length > 1"> ({{ m.name.split(' ')[0] }})</template></small>
                    </span>
                  </template>
                  <small v-else class="cr__none">not enough earlier results</small>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p class="note">
          “Against their form” compares each result with the middle of that paddler’s own earlier results over the last two years (a minus is quicker). In a K2 it is each paddler’s own share, so it isn’t a measure of the crew’s partner.
          Results are the public ones on <a :href="BASE + '/results/races'" target="_blank" rel="noopener">the marathon results site</a>; a recent race can still change while it is marked provisional.
          <template v-if="data.ratingsAt">Worked out on {{ fmtShort(data.ratingsAt) }}.</template>
        </p>
      </section>
    </template>
  </main>
</template>

<style scoped>
.cr { max-width: 1080px; margin: 0 auto; padding: 18px 24px 60px; }
h1 { font: 700 clamp(2rem, 6vw, 3.4rem) / 1 var(--font-display); color: var(--heading); margin: 22px 0 14px; }
.cr__status { margin: 30px 0; color: var(--muted); font-size: 1.05rem; }
.cr__status--warn { color: var(--clay); }
.cr__race h2 { font: 700 clamp(1.4rem, 4vw, 2rem) / 1.1 var(--font-display); color: var(--heading); margin: 0; }
.cr__race h2 a { color: inherit; }
.cr__race p { margin: 4px 0 10px; color: var(--muted); }
.cr__pick { display: grid; gap: 4px; max-width: 460px; font-size: 0.8rem; color: var(--muted); font-weight: 600; margin-bottom: 8px; }
.cr__pick select { padding: 9px 10px; border: 1.5px solid var(--line); border-radius: 6px; background: var(--surface); color: var(--ink); font: 0.95rem var(--font-body); }
.cr__headline { font-size: 1.1rem; color: var(--heading); font-weight: 600; margin: 8px 0 16px; }
.tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin-bottom: 18px; }
.tile { display: grid; gap: 4px; padding: 14px 16px; background: var(--surface); border: 1.5px solid var(--line); border-radius: 6px; }
.tile__label { font-size: 0.8rem; color: var(--muted); }
.tile__value { font: 700 1.6rem var(--font-display); color: var(--heading); }
.tile__value small { font: 500 0.9rem var(--font-body); color: var(--muted); }
.tile__value.up { color: var(--teal); }
.tile__note { font-size: 0.78rem; color: var(--muted); min-height: 1em; }
.card { padding: 18px 20px; margin-bottom: 18px; background: var(--surface); border: 1.5px solid var(--line); border-radius: 6px; }
.card h2 { font: 700 1.5rem var(--font-display); color: var(--heading); margin: 0 0 12px; }
.cr__best { margin: 0; padding-left: 22px; display: grid; gap: 6px; }
.cr__best span { color: var(--muted); }
.cr__best em { font-style: normal; font-weight: 700; }
.table-wrap { overflow-x: auto; }
.cr__table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
.cr__table th { text-align: left; font-weight: 600; color: var(--muted); border-bottom: 1.5px solid var(--line); padding: 6px 8px; white-space: nowrap; }
.cr__table td { padding: 8px; border-bottom: 1px solid var(--mist); vertical-align: top; }
.cr__table small { display: block; color: var(--muted); font-size: 0.78rem; line-height: 1.3; }
.cr__place, .cr__time { white-space: nowrap; font-variant-numeric: tabular-nums; }
.cr__vs { display: block; }
.cr__vs small { display: inline; }
.good { color: var(--teal); font-weight: 600; }
.bad { color: var(--clay); }
.cr__none { font-style: italic; }
.note { margin: 12px 0 0; font-size: 0.82rem; color: var(--muted); line-height: 1.45; }
.note a { color: var(--heading); }
@media (max-width: 640px) {
  .cr { padding: 12px 12px 40px; }
  .card { padding: 14px 12px; }
  .cr__table { font-size: 0.85rem; }
  .cr__table th:nth-child(3), .cr__table td:nth-child(3) { display: none; } /* the time: the place says enough on a phone */
}
</style>
