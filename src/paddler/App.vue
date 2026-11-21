<script setup>
// Paddler page (/paddlers/paddler/?name=...): look up a club paddler, see how their
// racing has changed over the years (from the public marathon results), and get ideas for
// the coaching most likely to make them quicker. Coaches only (behind the coach role,
// like the board). Their MemberMojo page is linked from here.
//
// The same page is what a paddler sees from a link a coach shares with them
// (/my-racing/?t=<token>, not behind a sign-in): only their own results, with no search
// and no MemberMojo. The server only answers for the paddler the signed token names
// (netlify/functions/lib/share.js).
import { ref, computed, watch, onMounted } from 'vue'
import SiteNav from '../shared/SiteNav.vue'
import SkyBackground from '../shared/SkyBackground.vue'
import StripeBanner from '../shared/StripeBanner.vue'
import ProgressChart from './ProgressChart.vue'
import LoadingRiver from '../shared/LoadingRiver.vue'
import KayakDash from '../shared/KayakDash.vue'
import { useLoadingPreview } from '../shared/loadingPreview.js'
const preview = useLoadingPreview() // ?loading: show the loading animation
import { analyse, partnersOf, REGULAR_CREW, crewAvgWords, crewChangeWords, boatWords, describeLevel, describeForm, formShort, fmtDuration, ownDivision, divLabel, rankName, GAP, COURSES } from './insights.js'
import { loadCrews, crews } from '../coaching/data/crews.js'
import { photoUrl } from '../coaching/data/photos.js'
import { CLUB_CODE } from '../coaching/data/paddlers.js'
import { sameRacer } from '../../netlify/functions/lib/match.js'

const params = new URLSearchParams(location.search)
const token = params.get('t') // a shared link: this paddler only
const shared = !!token
const withName = shared ? params.get('with') || '' : '' // a shared link, opened on one of their K2 partners
const mine = shared && !withName // the page is the paddler's own
const query = ref(params.get('name') || '') // the search box, as typed
// the paddler being shown: from the link (id from the board, and name), then each search.
// Reactive, so the photo, MemberMojo link and header follow a new search (the search box
// alone isn't enough: it changes with every key press).
const shown = ref({ id: params.get('id'), name: params.get('name') || '', in: params.get('in') || '' }) // in: a club, when the same name races for more than one
const members = ref([]) // from MemberMojo: { id, name, url, photo, junior, coach }
// anyone in the results can be looked up and sent a share link; club members also get their
// photo and MemberMojo link
// opened by the race coordinator (from the race planner): back to the planner, no share
// links (the server says who's looking; until then, the link they came from)
const coordinator = computed(() => (data.value?.viewer ? data.value.viewer === 'coordinator' : params.get('from') === 'planner'))
const ownClub = computed(() => !data.value?.club || data.value.club === CLUB_CODE)
const member = computed(() => {
  if (!ownClub.value) return null
  const { id, name } = shown.value
  return members.value.find(m => id && String(m.id) === id) || members.value.find(m => name && sameRacer(m.name, name)) || null
})
const status = ref({ state: 'idle', message: '' })
const starLevel = ref(0) // their highest star award (0 = none), shown by the name
const award = ref(null) // { who, award, date }: a star award from the last week (even with no race results)
const data = ref(null) // /api/paddler answer: { name, names, kayak, canoe } (each null if no results)
// kayak and canoe are rated separately (a paddler has a division in each): which one is shown
const boat = ref(params.get('boat') === 'canoe' ? 'canoe' : 'kayak')
const boats = computed(() => ['kayak', 'canoe'].filter(b => data.value?.[b]?.history?.length))
const view = computed(() => data.value?.[boats.value.includes(boat.value) ? boat.value : boats.value[0]] || null)
const shownBoat = computed(() => (view.value === data.value?.canoe ? 'canoe' : 'kayak'))
const W = computed(() => boatWords(shownBoat.value))
function pickBoat(b) {
  boat.value = b
  const url = new URL(location.href)
  if (b === 'canoe') url.searchParams.set('boat', 'canoe')
  else url.searchParams.delete('boat')
  history.replaceState(null, '', url)
}
const photo = ref(null)

async function loadMembers() {
  try {
    const res = await fetch('/api/members', { credentials: 'same-origin' })
    const body = await res.json().catch(() => null)
    if (res.ok && Array.isArray(body?.members)) members.value = body.members
  } catch {}
}

// after a merge the page asks afresh (a new address, so not the copy kept a few minutes by the CDN)
let bust = ''
async function lookup(name) {
  if (!name) return
  status.value = { state: 'loading', message: 'Reading their results…' }
  data.value = null
  award.value = null
  starLevel.value = 0
  try {
    for (let round = 0; round < 4; round++) {
      const res = await fetch(shared ? `/api/paddler?t=${encodeURIComponent(token)}${withName ? '&with=' + encodeURIComponent(withName) : ''}` : `/api/paddler?club=${CLUB_CODE}&name=${encodeURIComponent(name)}${shown.value.in ? '&in=' + encodeURIComponent(shown.value.in) : ''}${bust}`, { credentials: 'same-origin' })
      const body = await res.json().catch(() => null)
      if (!res.ok) throw new Error(body?.detail || body?.error || 'HTTP ' + res.status)
      if (body.pending && shared) {
        status.value = { state: 'none', message: (mine ? 'Your' : 'Their') + ' results are still being prepared. Please try again a little later.' }
        return
      }
      if (body.pending && body.viewer === 'public') {
        // the first lookup starts the sums (the server does that); the races themselves are read when a coach opens the board
        status.value = { state: 'none', message: body.starting === 'no-races'
          ? 'The results have not been read yet. A coach needs to open the Paddler detail board once to start that; please try again later.'
          : 'The results are being prepared: that started when someone asked, and takes a few minutes. Please try again in about five minutes.' }
        return
      }
      if (body.pending) {
        // the race history hasn't been read yet: do that first (a few minutes, once)
        status.value = { state: 'loading', message: round ? 'Working out the ratings…' : 'Reading the marathon results since 2010 (only the first time; it takes a few minutes)…' }
        await loadCrews(CLUB_CODE, { force: round > 0 })
        if (crews.state === 'error') throw new Error(crews.error)
        continue
      }
      starLevel.value = body.starLevel || 0
      if (body.recentAward) award.value = { who: body.name || name, ...body.recentAward }
      if (!body.found || !(body.kayak || body.canoe)) {
        status.value = { state: 'none', message: shared ? (mine ? 'No race results found yet.' : `No race results found for ${name}.`) : `No kayak or canoe results found for ${name}.` }
        return
      }
      data.value = body
      status.value = { state: 'ok', message: '' }
      return
    }
    throw new Error('the ratings still aren\'t ready. Try again in a few minutes; if it keeps happening, check the "crews-fit" function log on Netlify')
  } catch (e) {
    status.value = { state: 'error', message: e.message }
  }
}

function search() {
  const name = query.value.trim()
  if (!name) return
  const url = new URL(location.href)
  url.searchParams.set('name', name)
  url.searchParams.delete('id')
  url.searchParams.delete('in')
  history.replaceState(null, '', url)
  params.set('name', name)
  params.delete('id')
  shown.value = { id: null, name, in: '' }
  lookup(name)
}
// the same name racing for another club: show that one instead
function showOther(o) {
  query.value = o.name
  const url = new URL(location.href)
  url.searchParams.set('name', o.name)
  url.searchParams.set('in', o.club)
  url.searchParams.delete('id')
  history.replaceState(null, '', url)
  shown.value = { id: null, name: o.name, in: o.club }
  lookup(o.name)
}

let photoFor = 0
async function loadPhoto() {
  const mine = ++photoFor // a newer search wins if photos arrive out of order
  photo.value = null
  const m = member.value
  if (!m?.photo) return
  const url = await photoUrl(m.photo)
  if (mine === photoFor) photo.value = url
}

// the club's members (for the name suggestions, photos and MemberMojo links) are for coaches and
// the race coordinator only: anyone else would just be turned away, so don't ask for them. The
// menu bar keeps who's signed in (SiteNav.vue); the first lookup says too.
const signedIn = () => { try { const r = JSON.parse(localStorage.getItem('bscc-nav-roles') || '{}'); return !!(r.coach || r.coordinator) } catch { return false } }
let membersAsked = false
function askMembers() { if (membersAsked) return; membersAsked = true; return loadMembers() }
watch(() => data.value?.viewer, v => { if (v === 'coach' || v === 'coordinator') askMembers() })
onMounted(async () => {
  if (shared) return lookup(withName || 'you')
  if (signedIn()) await askMembers()
  if (query.value) lookup(query.value)
})
// the photo follows whoever is shown (none for paddlers from other clubs)
watch(() => member.value?.id, () => loadPhoto())

const result = computed(() => (view.value ? analyse(view.value.history, view.value.k1med, { currentDiv: view.value.div, boat: shownBoat.value, group: view.value.group, gym: ownClub.value }) : null))
const stats = computed(() => result.value?.stats || null)
// Not raced for over a year: the figures are as they were at their last race, so the tiles say
// so rather than "the last year" (which is the year up to that last race, not up to today)
const stale = computed(() => !!stats.value && Date.now() - new Date(stats.value.lastRace).getTime() > 400 * 864e5)
const monthYear = d => (d ? new Date(d).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }) : '')
const pctOf = levels => (Math.abs(levels) * GAP * 100).toFixed(1) + '%'
const fmtDate = d => (d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '')
const fmtTime = s => {
  if (!s) return ''
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}
function place(r) {
  if (!r.pos) return 'Finished'
  const n = r.pos
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? 'th' : { 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th'
  return `${n}${suffix}${r.of ? ' of ' + r.of : ''}`
}
const divName = d => divLabel(d) // "div 5", or a children's division: "GSA"
// how quick a level is, in words (with the children's divisions below div 9)
const describe = level => (result.value?.scale ? result.value.scale.describe(level) : describeLevel(level))
// every promotion, oldest first: { date, race, to }
const promotions = computed(() => (result.value ? result.value.all.filter(r => r.promo).map(r => ({ date: r.date, race: r.race, to: r.promo.to, inferred: r.promo.inferred })) : []))
// ---- earlier names: possible ones to confirm (coaches only), and ones already linked ----
// (netlify/functions/lib/namelinks.js). Linking has the ratings worked out again.
const nameBusy = ref('')
const nameError = ref('')
// After results have been put together (or apart) the ratings are worked out again in the
// background, a few minutes: start that, then ask now and then until the page's numbers are the
// new ones (the server says refitting until they are), instead of showing the old ones
async function refitThenLookup(name) {
  if (canLink.value) await loadCrews(CLUB_CODE, { force: true }) // starts the work (it answers at once with the old ratings); anyone else's merge has the server start it
  status.value = { state: 'loading', message: 'Putting the results together: this takes a few minutes…' }
  for (let i = 0; i < 100; i++) {
    try {
      const res = await fetch(`/api/paddler?club=${CLUB_CODE}&name=${encodeURIComponent(name)}${shown.value.in ? '&in=' + encodeURIComponent(shown.value.in) : ''}&fresh=${Date.now()}`, { credentials: 'same-origin' })
      const body = await res.json().catch(() => null)
      if (res.ok && body && !body.pending && !body.refitting) { bust = '&fresh=' + Date.now(); return lookup(name) }
    } catch {}
    await new Promise(res => setTimeout(res, 6000))
  }
  status.value = { state: 'none', message: 'The ratings are still being worked out. Open this page again in a few minutes.' }
}
async function decideName(m, action) {
  nameBusy.value = m.key
  nameError.value = ''
  try {
    const res = await fetch(`/api/paddler-names?club=${CLUB_CODE}`, {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, from: m.key, to: data.value.key })
    })
    const body = await res.json().catch(() => null)
    if (!res.ok) throw new Error(body?.error || 'HTTP ' + res.status)
    if (action === 'reject') {
      data.value = { ...data.value, maybe: data.value.maybe.filter(x => x.key !== m.key) }
      return
    }
    // put together (or apart) again: the ratings are worked out afresh, then the page reloads
    const name = data.value.name
    status.value = { state: 'loading', message: action === 'link' ? `Putting ${m.name}'s results with ${name}'s…` : 'Separating their results again…' }
    data.value = null
    await refitThenLookup(name)
  } catch (e) {
    nameError.value = e.message
  } finally {
    nameBusy.value = ''
  }
}
// The same name racing for another club is often the same person after a move (or several).
// A coach ticks the ones that are the same person and merges them: all their results are put
// together as one paddler, under the club they raced for most recently, using the same link as
// for a changed name. Ratings are then worked out again.
const pick = ref([]) // keys of the same-name paddlers ticked to merge (all of them to begin with)
watch(() => data.value?.key, () => { pick.value = data.value?.viewer === 'coach' ? (data.value?.others || []).map(o => o.key) : [] }, { immediate: true })
const lastRaced = computed(() => [data.value?.kayak?.last, data.value?.canoe?.last].filter(Boolean).sort().pop() || '')
const picked = computed(() => (data.value?.others || []).filter(o => pick.value.includes(o.key)))
async function mergeSelected() {
  const chosen = picked.value
  if (!chosen.length) return
  const here = { key: data.value.key, name: data.value.name, club: data.value.club, last: lastRaced.value }
  // everyone goes in under whoever raced most recently
  const target = [here, ...chosen].reduce((a, b) => ((b.last || '') > (a.last || '') ? b : a))
  nameBusy.value = 'merge'
  nameError.value = ''
  try {
    for (const x of [here, ...chosen]) {
      if (x.key === target.key) continue
      const res = await fetch(`/api/paddler-names?club=${CLUB_CODE}`, {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'link', from: x.key, to: target.key })
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) throw new Error(body?.error || 'HTTP ' + res.status)
    }
    status.value = { state: 'loading', message: `Putting ${chosen.length + 1} sets of results together as ${target.name}…` }
    data.value = null
    shown.value = { id: null, name: target.name, in: target.club }
    await refitThenLookup(target.name)
  } catch (e) {
    nameError.value = e.message
  } finally {
    nameBusy.value = ''
  }
}
// A paddler merging their own results (from their shared link): the server puts them with their
// name and works the ratings out again in the background (a few minutes); meanwhile the page waits
async function waitForRefit() {
  status.value = { state: 'loading', message: 'Putting your results together: this takes a few minutes…' }
  data.value = null
  for (let i = 0; i < 100; i++) {
    await new Promise(res => setTimeout(res, 6000))
    try {
      const res = await fetch(`/api/paddler?t=${encodeURIComponent(token)}`, { credentials: 'same-origin' })
      const body = await res.json().catch(() => null)
      if (res.ok && body && !body.pending && !body.refitting) return lookup('you')
    } catch {}
  }
  status.value = { state: 'none', message: 'Your results are still being put together. Try again in a few minutes.' }
}
async function ownMerge(payload) {
  nameBusy.value = 'merge'
  nameError.value = ''
  try {
    const res = await fetch('/api/paddler-merge', {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...(shared ? { t: token } : { key: data.value.key }), ...payload })
    })
    const body = await res.json().catch(() => null)
    if (!res.ok) throw new Error(body?.error || 'HTTP ' + res.status)
    if (shared) return await waitForRefit()
    // anyone else: back to this paddler's page (under the club they raced for most recently)
    const name = data.value.name
    shown.value = { id: null, name, in: body?.key ? body.key.split('|')[1] : data.value.club }
    status.value = { state: 'loading', message: 'Putting the results together: this takes a few minutes…' }
    data.value = null
    await refitThenLookup(name)
  } catch (e) {
    nameError.value = e.message
  } finally {
    nameBusy.value = ''
  }
}
const mergeMine = () => ownMerge({ action: 'merge', keys: picked.value.map(o => o.key) })
// anyone can put same-name results together (not a partner's page opened from a shared link)
const canOwn = computed(() => !!data.value && !canLink.value && !withName && (!shared || mine))
const mergeTicked = () => (canLink.value ? mergeSelected() : mergeMine())
// one other paddler with this name whose results begin after this one's end (or end before its
// start): almost certainly a move to another club, so it's offered as one click
const firstRaced = computed(() => [data.value?.kayak?.history?.[0]?.date, data.value?.canoe?.history?.[0]?.date].filter(Boolean).sort()[0] || '')
const likelyMove = computed(() => {
  const os = data.value?.others || []
  if (os.length !== 1 || !lastRaced.value || !firstRaced.value) return null
  const o = os[0]
  if (!o.first || !o.last) return null
  if (o.first > lastRaced.value) return { o, after: true }
  if (o.last < firstRaced.value) return { o, after: false }
  return null
})
const moveDismissed = ref(false)
watch(() => data.value?.key, () => { moveDismissed.value = false })
const mergeOne = o => { pick.value = [o.key]; return mergeTicked() }
const undoMine = l => ownMerge({ action: 'unlink', from: l.key })
// "2017 – 2019" from the first and last race
const spanOf = o => (o.first && o.last ? (o.first.slice(0, 4) === o.last.slice(0, 4) ? o.last.slice(0, 4) : o.first.slice(0, 4) + ' – ' + o.last.slice(0, 4)) : o.last ? o.last.slice(0, 4) : '')
// every club they have raced for, oldest first (each result says which club they raced for that day)
const clubsRaced = computed(() => {
  const first = new Map()
  for (const b of ['kayak', 'canoe']) {
    for (const r of data.value?.[b]?.history || []) {
      if (r.club && r.date && (!first.has(r.club) || r.date < first.get(r.club))) first.set(r.club, r.date)
    }
  }
  return [...first.entries()].sort((a, b) => (a[1] < b[1] ? -1 : 1)).map(([c]) => (c === 'NONE' ? 'no club' : c))
})
// a phone: the chart comes first, and the notes start folded away
const narrow = typeof window !== 'undefined' && !!window.matchMedia?.('(max-width: 640px)').matches
const canLink = computed(() => !shared && data.value?.viewer === 'coach')

// earlier names (a name change, e.g. after marriage: lib/match.js NAME_CHANGES)
const titleCase = s => s.toLowerCase().replace(/(^|[\s'-])([a-z])/g, (m, a, b) => a + b.toUpperCase())
const otherNames = computed(() => {
  const now = String(data.value?.name || '').trim().toLowerCase().split(/\s+/).pop()
  return [...new Set((data.value?.names || []).map(n => titleCase(String(n).trim())))].filter(n => n.toLowerCase().split(/\s+/).pop() !== now)
})
// who they have raced a K2 (or C2) with, and how many races together
const ncCount = computed(() => (view.value?.history || []).filter(r => r.nc).length)
// kayak results of unknown class, whichever tab is open: they could really be canoe
const ncKayak = computed(() => (data.value?.kayak?.history || []).filter(r => r.nc).length)
const partners = computed(() => (result.value ? partnersOf(result.value.all) : []))
const k2Total = computed(() => partners.value.reduce((n, p) => n + p.races, 0))
// crews that have raced together REGULAR_CREW times or more get a closer look: how their races
// went against the paddler's own form (see insights.js crewForm)
const regulars = computed(() => partners.value.filter(p => p.races >= REGULAR_CREW))
const bestCrew = computed(() => {
  const r = regulars.value.filter(p => p.avg != null)
  if (r.length < 2) return null
  const b = r.reduce((m, p) => (p.avg < m.avg ? p : m), r[0])
  return b.avg <= -1 ? b : null
})
const crewCls = v => (v == null ? '' : v <= -1 ? 'good' : v >= 1 ? 'bad' : '')
const pct = v => (v == null ? '' : (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(1) + '%')
// a small line of the crew's races, quicker up, with a line for "their usual form"
const SPARK = { w: 96, h: 30, max: 8 }
const sparkX = (p, i) => (p.forms.length < 2 ? SPARK.w / 2 : 6 + (i / (p.forms.length - 1)) * (SPARK.w - 12))
const sparkY = v => SPARK.h / 2 + (Math.max(-SPARK.max, Math.min(SPARK.max, v)) / SPARK.max) * (SPARK.h / 2 - 4)
const sparkPath = p => p.forms.map((f, i) => `${i ? 'L' : 'M'}${sparkX(p, i).toFixed(1)} ${sparkY(f.v).toFixed(1)}`).join(' ')
const sparkText = p => `${p.forms.length} races together: ` + p.forms.map(f => (f.v <= -1 ? 'quicker ' : f.v >= 1 ? 'slower ' : 'usual ') + Math.abs(f.v).toFixed(1) + '%').join(', ')
// tap a crew's line to open every race they had together
const openCrew = ref('')
const crewKey = p => p.name.toLowerCase()
const toggleCrew = p => { openCrew.value = openCrew.value === crewKey(p) ? '' : crewKey(p) }
const barStyle = v => ({ width: Math.min(100, (Math.abs(v) / 8) * 100) / 2 + '%', [v <= 0 ? 'left' : 'right']: '50%' })
const fmtMonth = d => (d ? new Date(d).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }) : '')

// ---- comments on results: anyone can add one, everyone reads them, coaches remove them ----
const NOTE_FLAGS = [['wind', 'Windy'], ['rain', 'Rain'], ['hot', 'Hot'], ['cold', 'Cold'], ['helped', 'Stopped to help someone'], ['capsized', 'Capsized'], ['unwell', 'Ill or injured'], ['course', 'Course or start problem']]
const flagLabel = f => NOTE_FLAGS.find(x => x[0] === f)?.[1] || f
const notes = ref({}) // by result (the history row's rid): a list of comments
const canComment = computed(() => data.value?.found !== false && !!data.value?.key)
const canJudge = computed(() => mine || canLink.value) // "not a fair result": the paddler's own link, or a coach
// the secrets this browser was given for comments it wrote (so it can take them back)
const SECRETS = 'bscc-comment-secrets'
const secrets = ref({})
try { secrets.value = JSON.parse(localStorage.getItem(SECRETS) || '{}') } catch { /* no storage: the writer just can't remove it later */ }
const keepSecret = (id, secret) => { secrets.value = { ...secrets.value, [id]: secret }; try { localStorage.setItem(SECRETS, JSON.stringify(secrets.value)) } catch { /* as above */ } }
const canRemove = c => !c.about && (canLink.value || mine || !!secrets.value[c.id]) // (a partner's comment comes off their own page)
const editing = ref(null) // { rid, text, flags, unfair, saving, error }
async function loadNotes() {
  notes.value = {}
  editing.value = null
  const key = data.value?.found === false ? '' : data.value?.key
  if (!key) return
  try {
    const res = await fetch(mine ? `/api/paddler-notes?t=${encodeURIComponent(token)}` : `/api/paddler-notes?key=${encodeURIComponent(key)}`, { credentials: 'same-origin' })
    const body = await res.json().catch(() => ({}))
    if (res.ok && body.notes && data.value?.key === key) notes.value = body.notes
  } catch { /* comments are a bonus: the results show without them */ }
}
watch(() => data.value?.key, loadNotes, { immediate: true })

// ---- National sprint regattas (canoeingresults.com PDFs, read by netlify/functions/sprint-index.js) ----
const sprint = ref(null) // { indexed, entries, regattas, ambiguous, at }
const sprintMsg = ref('')
async function loadSprint() {
  sprint.value = null
  const key = data.value?.found === false ? '' : data.value?.key
  if (!key) return
  try {
    const res = await fetch(mine ? `/api/paddler-sprint?t=${encodeURIComponent(token)}` : `/api/paddler-sprint?key=${encodeURIComponent(key)}`, { credentials: 'same-origin' })
    const body = await res.json().catch(() => ({}))
    if (res.ok && data.value?.key === key) sprint.value = body
  } catch { /* a bonus: the page shows without it */ }
}
watch(() => data.value?.key, loadSprint, { immediate: true })
const sprintGroups = computed(() => {
  const groups = []
  for (const e of sprint.value?.entries || []) {
    let g = groups[groups.length - 1]
    if (!g || g.id !== e.regatta) { g = { id: e.regatta, info: sprint.value.regattas?.[e.regatta] || {}, rows: [] }; groups.push(g) }
    g.rows.push(e)
  }
  return groups
})

// compare a paddler's sprint times across regattas and distances: for each boat (K1, K2...), the
// fastest time in each regatta at each distance (a heat or the final), personal bests marked
const sprintPace = ref(false) // show the time, or the pace per 500 m (to compare 200 m with 1000 m)
const fmtSecs = t => { if (t == null) return ''; const m = Math.floor(t / 60); const r = t - m * 60; return m ? `${m}:${r.toFixed(2).padStart(5, '0')}` : r.toFixed(2) }
const sprintMonth = id => { const m = String(id).match(/(\d{4})-(\d{2})/); return m ? new Date(Number(m[1]), Number(m[2]) - 1, 1).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }) : id }
const sprintCompare = computed(() => {
  const entries = (sprint.value?.entries || []).filter(e => e.seconds > 0 && e.metres >= 100)
  if (new Set(entries.map(e => e.regatta)).size < 2) return []
  const boats = []
  for (const boat of ['K1', 'K2', 'K4']) {
    const mine = entries.filter(e => new RegExp(`\\b${boat}\\b`).test(e.event))
    const regattas = [...new Set(mine.map(e => e.regatta))].sort().reverse() // newest first
    if (regattas.length < 2 && new Set(mine.map(e => e.metres)).size < 2) continue
    const metres = [...new Set(mine.map(e => e.metres))].sort((a, b) => a - b)
    const cell = (r, d) => mine.filter(e => e.regatta === r && e.metres === d).sort((a, b) => a.seconds - b.seconds)[0] || null
    const rows = regattas.map(r => ({ id: r, label: sprintMonth(r), cells: metres.map(d => cell(r, d)) }))
    const best = metres.map((d, i) => Math.min(...rows.map(r => r.cells[i]?.seconds ?? Infinity)))
    boats.push({ boat, metres, rows, best })
  }
  return boats
})
const sprintShow = (c, d) => (c ? (sprintPace.value ? fmtSecs(c.seconds / d * 500) : fmtSecs(c.seconds)) : '')
const sprintBestShow = (t, d) => (Number.isFinite(t) ? (sprintPace.value ? fmtSecs(t / d * 500) : fmtSecs(t)) : '')
const sprintPlace = e => (e.status ? e.status : e.pos ? `${e.pos}${[, 'st', 'nd', 'rd'][e.pos % 10 > 3 || Math.floor(e.pos / 10) === 1 ? 0 : e.pos % 10] || 'th'}` : '')
async function updateSprint() {
  sprintMsg.value = 'Starting…'
  try {
    const res = await fetch('/api/sprint-index?years=5', { method: 'POST', credentials: 'same-origin' })
    sprintMsg.value = res.status === 202 || res.ok ? 'Reading the results from canoeingresults.com: this takes a few minutes. Refresh the page later to see them.' : 'Could not start that (are you signed in as a coach?)'
  } catch { sprintMsg.value = 'Could not start that: check your connection' }
}
const who = () => (mine ? { t: token } : { key: data.value.key })
function editNote(r) {
  editing.value = { rid: r.rid, text: '', flags: [], unfair: false, saving: false, error: '' }
}
async function post(payload) {
  const res = await fetch('/api/paddler-notes', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...who(), ...payload }) })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || 'Could not save that')
  return body
}
async function saveNote() {
  const e = editing.value
  e.saving = true
  e.error = ''
  try {
    const body = await post({ rid: e.rid, text: e.text, flags: e.flags, unfair: e.unfair })
    if (body.secret) keepSecret(body.note.id, body.secret)
    notes.value = { ...notes.value, [e.rid]: [...(notes.value[e.rid] || []), body.note] }
    editing.value = null
  } catch (err) { e.saving = false; e.error = err.message }
}
async function removeNote(rid, c) {
  if (!confirm('Remove this comment?')) return
  try {
    await post({ action: 'remove', rid, id: c.id, secret: secrets.value[c.id] })
    const rest = (notes.value[rid] || []).filter(x => x.id !== c.id)
    const next = { ...notes.value, [rid]: rest }
    if (!rest.length) delete next[rid]
    notes.value = next
  } catch (err) { alert(err.message) }
}
const noteText = rid => (notes.value[rid] || []).map(c => (c.unfair ? 'Not a fair result. ' : '') + c.text).filter(Boolean).join(' · ')

// ---- privacy: a copy of what is kept about a paddler, and deleting it ----
// Who people write to about their data
const PRIVACY_NAME = 'Ben Tubby'
const PRIVACY_EMAIL = 'btubby@gmail.com'
const canOwnData = computed(() => (mine || canLink.value) && !!data.value?.key)
const myDataUrl = computed(() => (mine ? `/api/paddler-notes?t=${encodeURIComponent(token)}&mydata=1` : `/api/paddler-notes?key=${encodeURIComponent(data.value?.key || '')}&mydata=1`))
const erase = ref({ busy: false, done: '', error: '' })
async function eraseMine() {
  if (!confirm('Delete every comment on these results and undo every name link put together under them? This cannot be undone. (Download your data first if you want a copy.) The public marathon results themselves stay.')) return
  erase.value = { busy: true, done: '', error: '' }
  try {
    const out = await post({ action: 'erase', confirm: true })
    erase.value = { busy: false, done: `Deleted ${out.comments} comment${out.comments === 1 ? '' : 's'} and ${out.links} name link${out.links === 1 ? '' : 's'}.${out.links ? ' The ratings are worked out again in a few minutes: refresh then.' : ''}`, error: '' }
    notes.value = {}
  } catch (err) { erase.value = { busy: false, done: '', error: err.message } }
}
const newestFirst = computed(() => (result.value ? [...result.value.all].reverse() : []))
// ---- sharing: a link for the paddler to see their own page ---------------------------
const share = ref({ state: 'idle', url: '', error: '', copied: false })
async function makeLink() {
  share.value = { state: 'loading', url: '', error: '', copied: false }
  try {
    const res = await fetch(`/api/paddler-link?club=${CLUB_CODE}&name=${encodeURIComponent(data.value?.name || shown.value.name)}${data.value?.club && data.value.club !== CLUB_CODE ? '&in=' + encodeURIComponent(data.value.club) : ''}`, { credentials: 'same-origin' })
    const body = await res.json().catch(() => null)
    if (!res.ok) throw new Error(body?.error || 'HTTP ' + res.status)
    share.value = { state: 'ok', url: body.url, error: '', copied: false }
  } catch (e) {
    share.value = { state: 'error', url: '', error: e.message, copied: false }
  }
}
async function copyLink() {
  try {
    await navigator.clipboard.writeText(share.value.url)
    share.value = { ...share.value, copied: true }
  } catch {
    document.getElementById('pd-share-url')?.select()
  }
}
const canShareNative = typeof navigator !== 'undefined' && !!navigator.share
const sendLink = () => navigator.share({ title: 'Your racing', text: `Your race results and coaching ideas from ${CLUB_CODE}`, url: share.value.url }).catch(() => {})
watch(() => data.value?.key, () => { share.value = { state: 'idle', url: '', error: '', copied: false } })

const displayName = computed(() => data.value?.name || member.value?.name || shown.value.name || (mine ? 'Your racing' : ''))
const BASE = 'https://entries.canoemarathon.org.uk'
</script>

<template>
  <SkyBackground />
  <SiteNav :current="shared ? '' : '/paddlers/paddler/'" :limited="shared" />
  <StripeBanner v-if="award" :key="award.who + award.date" top="CONGRATULATIONS" :headline="`${String(award.who).split(' ')[0].toUpperCase()}: ${award.award} STAR!`" :ms="3200" />
  <main class="pd">
    <div v-if="withName" class="pd__bar">
      <a :href="`?t=${encodeURIComponent(token)}`" class="pd__back">← Back to your page</a>
    </div>
    <div v-if="!shared" class="pd__bar">
      <a v-if="coordinator" href="/race-planner/" class="pd__back">← Race planner</a>
      <a v-else-if="data?.viewer !== 'public'" href="/paddlers/" class="pd__back">← Paddler detail board</a>
      <span v-else></span>
      <p v-if="data?.viewer === 'coach' || data?.viewer === 'coordinator'" class="pd__signed">
        Signed in as the {{ data.viewer === 'coach' ? 'coaches' : 'race coordinator' }}
        · <a :href="data.viewer === 'coach' ? '/paddlers/?leave' : '/race-planner/?leave'">Sign out</a>
      </p>
      <form class="pd__search" role="search" @submit.prevent="search">
        <input v-model="query" list="pd-members" type="search" placeholder="Look up a paddler…" aria-label="Paddler's name" />
        <datalist id="pd-members">
          <option v-for="m in members" :key="m.id" :value="m.name" />
        </datalist>
        <button class="btn" type="submit" :aria-busy="status.state === 'loading'">Look up</button>
      </form>
    </div>

    <LoadingRiver v-if="preview.on" :progress="preview.progress" :working="preview.working"
      :message="preview.working ? 'Working out everyone\'s ratings: a few more laps… (preview)' : 'Reading the marathon results since 2010… (preview)'" />
    <p v-if="!params.get('name') && status.state === 'idle'" class="pd__intro">
      Type a name to see how a paddler's racing has changed over the years, and the coaching most likely to make them quicker. Anyone in the marathon results can be looked up, from any club.
    </p>

    <template v-if="displayName && status.state !== 'idle'">
      <header class="pd__head">
        <img v-if="photo" :src="photo" alt="" class="pd__photo" />
        <span v-else class="pd__photo pd__photo--none">{{ displayName.charAt(0) }}</span>
        <div class="pd__who">
          <p class="pd__kicker">
            <template v-if="mine">Your racing · {{ data?.club || CLUB_CODE }}</template>
            <template v-else-if="shared">Your K2 partner · {{ data?.club || CLUB_CODE }}</template>
            <template v-else-if="clubsRaced.length > 1">Has raced for {{ clubsRaced.length }} clubs:
              <template v-for="(c, i) in clubsRaced" :key="c"><template v-if="i === clubsRaced.length - 1"> and </template><template v-else-if="i">, </template><em class="club">{{ c }}</em></template></template>
            <template v-else>{{ data?.club || CLUB_CODE }} paddler{{ ownClub ? '' : ' · another club' }}</template>
          </p>
          <div class="pd__namerow">
            <h1>{{ displayName }}</h1>
            <span v-if="starLevel" class="pd__star" :title="`Assessed to BSCC ${starLevel} Star`"><span aria-hidden="true">{{ '★'.repeat(starLevel) }}</span> {{ starLevel }} Star</span>
            <span v-if="!shared" class="pd__links">
              <a v-if="member?.url" :href="member.url" target="_blank" rel="noopener" class="btn btn--sm">MemberMojo</a>
              <button v-if="data?.viewer === 'coach' && share.state !== 'ok'" type="button" class="btn btn--sm btn--quiet" :disabled="share.state === 'loading'" :aria-busy="share.state === 'loading'" @click="makeLink">
                {{ share.state === 'loading' ? 'Making link…' : 'Share' }}
              </button>
            </span>
          </div>
          <p v-if="stats" class="pd__facts">
            <template v-if="view?.group">{{ { junior: 'Junior', senior: 'Senior', veteran: 'Veteran' }[view.group] }} · </template>
            <template v-for="b in boats" :key="b">{{ b === 'canoe' ? 'Canoe' : 'Kayak' }} {{ divName(data[b].div) || 'div ?' }} · </template>
            {{ stats.races }} {{ W.boat }} result{{ stats.races === 1 ? '' : 's' }} since {{ new Date(stats.since).getFullYear() }}
            ({{ stats.k1Races }} {{ W.one }}, {{ stats.k2Races }} {{ W.two }}) · last raced {{ fmtDate(stats.lastRace) }}
          </p>
          <p v-if="ncKayak && boats.length > 1" class="pd__facts pd__ncwarn">⚠ {{ ncKayak }} kayak result{{ ncKayak === 1 ? '' : 's' }} don’t say kayak or canoe (mostly older marathon results), so {{ ncKayak === 1 ? 'it is' : 'they are' }} counted as kayak and the two ratings may be slightly off.<template v-if="boat === 'kayak'"> <a href="#all-results">See which</a></template><template v-else> The Kayak tab marks them.</template></p>
          <p v-if="otherNames.length" class="pd__facts">Also raced as {{ otherNames.join(', ') }}</p>
          <!-- a phone: one line, the whole list a tap away -->
          <details v-if="promotions.length && narrow" class="pd__promos pd__promos--fold">
            <summary>▲ Promoted {{ promotions.length === 1 ? 'once' : promotions.length + ' times' }} · latest: {{ divName(promotions[promotions.length - 1].to) }} ({{ new Date(promotions[promotions.length - 1].date).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }) }})</summary>
            <ol>
              <li v-for="(pr, i) in promotions" :key="i">{{ divName(pr.to) }}{{ pr.inferred ? '*' : '' }}: {{ pr.race }}, {{ new Date(pr.date).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }) }}</li>
            </ol>
            <small v-if="promotions.some(p => p.inferred)" class="pd__promos-note">* worked out from the divisions raced: results pages before about 2023 don’t show promotions</small>
          </details>
          <p v-else-if="promotions.length" class="pd__promos">
            ▲ Promoted {{ promotions.length === 1 ? 'once' : promotions.length + ' times' }}:
            <template v-for="(pr, i) in promotions" :key="i"><template v-if="i"> → </template><span :title="pr.race + (pr.inferred ? ' (worked out from the divisions raced)' : '')">{{ divName(pr.to) }}{{ pr.inferred ? '*' : '' }} ({{ new Date(pr.date).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }) }})</span></template>
          
            <small v-if="promotions.some(p => p.inferred)" class="pd__promos-note">* worked out from the divisions raced: results pages before about 2023 don’t show promotions</small>
          </p>
        </div>
      </header>
      <section v-if="canLink && data?.maybe?.length" class="maybe" aria-label="Possible earlier names">
        <h2>Might have raced under another name before</h2>
        <p class="maybe__what">{{ data.name }} started racing in a division a newcomer wouldn’t (newcomers start in div 9), so they probably raced before under another name: a maiden name, a misspelling or a nickname. These earlier paddlers fit. Only coaches see this.</p>
        <article v-for="m in data.maybe" :key="m.key" class="maybe__one">
          <div class="maybe__who">
            <a :href="`?name=${encodeURIComponent(m.name)}&in=${encodeURIComponent(m.club)}`" @click.prevent="showOther({ name: m.name, club: m.club })"><strong>{{ m.name }}</strong></a>
            <span>{{ m.club }} · {{ m.n }} result{{ m.n === 1 ? '' : 's' }}, {{ m.from }} – {{ m.to }}<template v-if="m.lastDiv"> · last in div {{ m.lastDiv }}</template></span>
            <small>{{ m.why.join('; ') }}</small>
          </div>
          <div class="maybe__do">
            <button type="button" class="btn" :disabled="!!nameBusy" :aria-busy="nameBusy === m.key" @click="decideName(m, 'link')">{{ nameBusy === m.key ? 'Linking…' : 'Same person' }}</button>
            <button type="button" class="btn btn--quiet" :disabled="!!nameBusy" @click="decideName(m, 'reject')">Not them</button>
          </div>
        </article>
        <p v-if="nameError" class="pd__status pd__status--warn">{{ nameError }}</p>
      </section>
      <p v-if="(canLink || canOwn) && data?.linked?.length" class="pd__others">
        {{ mine ? 'Put together with yours:' : 'Linked as the same paddler:' }}
        <template v-for="(l, i) in data.linked" :key="l.key"><template v-if="i">, </template>{{ l.name }} (<em class="club">{{ l.club }}</em>)
          <button v-if="!data.refitting" type="button" class="link-btn" :disabled="!!nameBusy" @click="canLink ? decideName(l, 'unlink') : undoMine(l)">undo</button></template>
      </p>
      <p v-if="(canOwn || canLink) && data?.refitting" class="pd__status">{{ mine ? 'Your results are' : 'These results are' }} being put together: the page is updated in a few minutes (refresh to check).</p>
      <div v-if="(canLink || canOwn) && likelyMove && !moveDismissed && !data.refitting" class="move" role="region" aria-label="Looks like the same person">
        <p class="move__text">
          <strong>Looks like the same person.</strong>
          {{ likelyMove.o.name }} raced for <em class="club">{{ likelyMove.o.club === 'NONE' ? 'no club' : likelyMove.o.club }}</em> {{ spanOf(likelyMove.o) }}{{ likelyMove.o.n ? ' (' + likelyMove.o.n + ' result' + (likelyMove.o.n === 1 ? '' : 's') + ')' : '' }},
          {{ likelyMove.after ? 'after ' + (mine ? 'your' : 'these') + ' results end (' + monthYear(lastRaced) + ')' : 'before ' + (mine ? 'your' : 'these') + ' results begin (' + monthYear(firstRaced) + ')' }}: a move to another club?
        </p>
        <div class="move__do">
          <button type="button" class="btn" :disabled="!!nameBusy" :aria-busy="nameBusy === 'merge'" @click="mergeOne(likelyMove.o)">{{ nameBusy === 'merge' ? 'Putting together…' : 'Yes, put their results together' }}</button>
          <button type="button" class="btn btn--quiet" :disabled="!!nameBusy" @click="moveDismissed = true">No, someone else</button>
        </div>
      </div>
      <section v-if="(!shared || mine) && data?.others?.length && !((canLink || canOwn) && likelyMove && !moveDismissed && !data.refitting)" class="pd__others pd__same" aria-label="Same name in the results">
        <p class="pd__same-title">
          {{ mine ? 'Others in the results with your name. Are any of them you? Tick them to put their results together with yours.' : 'Same name in the results:' }}
          <template v-if="!canLink && !canOwn">
            <template v-for="(o, i) in data.others" :key="o.key || o.club + o.name"><template v-if="i">, </template>
              <a :href="`?name=${encodeURIComponent(o.name)}&in=${encodeURIComponent(o.club)}`" @click.prevent="showOther(o)">{{ o.name }} ({{ o.club === 'NONE' ? 'no club' : o.club }}{{ spanOf(o) ? ', ' + spanOf(o) : '' }})</a>
            </template>
          </template>
        </p>
        <template v-if="canLink || canOwn">
          <ul class="pd__same-list">
            <li v-for="o in data.others" :key="o.key">
              <label>
                <input type="checkbox" :value="o.key" v-model="pick" :disabled="!!nameBusy || !!data.refitting" />
                <a v-if="!mine" :href="`?name=${encodeURIComponent(o.name)}&in=${encodeURIComponent(o.club)}`" @click.prevent="showOther(o)">{{ o.name }}</a>
                <span v-else>{{ o.name }}</span>
                <em class="club">{{ o.club === 'NONE' ? 'no club' : o.club }}</em>
                <span class="pd__same-when">{{ spanOf(o) }}<template v-if="o.n"> · {{ o.n }} result{{ o.n === 1 ? '' : 's' }}</template></span>
              </label>
            </li>
          </ul>
          <div class="pd__same-do">
            <button type="button" class="btn" :disabled="!!nameBusy || !picked.length || !!data.refitting" @click="mergeTicked()">
              {{ nameBusy === 'merge' ? 'Merging…' : picked.length ? `Merge ${picked.length === data.others.length && picked.length > 1 ? 'all ' : ''}${picked.length} ticked with ${mine ? 'my results' : data.name}` : 'Tick who to merge' }}
            </button>
            <small>Ticked paddlers are put together with {{ mine ? 'you' : 'this one' }} as a single paddler, under the club {{ mine ? 'you' : 'they' }} raced for most recently. Only merge {{ mine ? 'results that are yours' : 'people who are the same person' }}: years that overlap, or results in the same race, mean {{ mine ? 'they are not' : 'it isn\'t' }}. A merge can be undone.</small>
          </div>
        </template>
      </section>
      <p v-if="(canLink || canOwn) && nameError && !data?.maybe?.length" class="pd__status pd__status--warn">{{ nameError }}</p>
      <div v-if="!shared && share.state === 'ok'" class="share" role="region" aria-label="Link for the paddler">
        <p class="share__what">
          A link for <strong>{{ data.name }}</strong>: it opens only their own page (results, chart and coaching ideas), with no
          password and no way to look anyone else up. Send it to them, or to their parent for a junior.
        </p>
        <div class="share__row">
          <input id="pd-share-url" class="share__url" :value="share.url" readonly @focus="$event.target.select()" />
          <button type="button" class="btn" @click="copyLink">{{ share.copied ? 'Copied' : 'Copy link' }}</button>
          <button v-if="canShareNative" type="button" class="btn btn--quiet" @click="sendLink">Send…</button>
        </div>
      </div>
      <p v-if="!shared && share.state === 'error'" class="pd__status pd__status--warn">Couldn't make a link: {{ share.error }}</p>

      <LoadingRiver v-if="status.state === 'loading' && crews.state === 'loading'" :progress="crews.total ? crews.read / crews.total : null" :working="crews.working"
        :message="crews.working ? 'Working out everyone\'s ratings: a few more laps…' : 'Reading the marathon results since 2010 (only the first time)…'" />
      <KayakDash v-else-if="status.state === 'loading'" :message="status.message" />
      <p v-else-if="status.state === 'none' || status.state === 'error'" class="pd__status pd__status--warn">{{ status.message }}</p>
    </template>

    <template v-if="stats">
      <div v-if="boats.length > 1" class="boat-toggle" role="group" aria-label="Kayak or canoe results">
        <button v-for="b in boats" :key="b" type="button" :aria-pressed="shownBoat === b" :class="{ on: shownBoat === b }" @click="pickBoat(b)">
          {{ b === 'canoe' ? 'Canoe (C1 / C2)' : 'Kayak (K1 / K2)' }}
        </button>
        <span class="boat-toggle__note">a separate rating and division for each</span>
      </div>
      <div class="pd__main">
      <section class="tiles" aria-label="Summary">
        <div class="tile">
          <span class="tile__label">{{ stale ? 'Last raced like' : 'Racing like' }}</span>
          <strong class="tile__value">{{ describe(stats.level) }}</strong>
          <span class="tile__note">{{ stats.div >= 10 ? 'in the children’s divisions: GSC, GSB, GSA, then div 9' : `level ${stats.level.toFixed(1)} on the division ladder` }}</span>
        </div>
        <div v-if="stats.change != null" class="tile">
          <span class="tile__label">{{ stale ? (mine ? 'In your last year of racing' : 'In their last year of racing') : 'Over the last year' }}</span>
          <strong class="tile__value" :class="stats.change < -0.05 ? 'up' : stats.change > 0.05 ? 'down' : ''">
            {{ Math.abs(stats.change) < 0.05 ? 'About the same' : (stats.change < 0 ? pctOf(stats.change) + ' quicker' : pctOf(stats.change) + ' slower') }}
          </strong>
          <span class="tile__note">{{ (stale ? 'to ' + monthYear(stats.lastRace) + (Math.abs(stats.change) < 0.05 ? '' : ': ') : '') + (Math.abs(stats.change) < 0.05 ? '' : 'about ' + fmtDuration(Math.abs(stats.change) * GAP * stats.typicalSecs) + ' over a ' + fmtDuration(stats.typicalSecs) + ' race') }}</span>
        </div>
        <div v-if="stats.best" class="tile">
          <span class="tile__label">Best form</span>
          <strong class="tile__value">{{ describe(stats.best.level) }}</strong>
          <span class="tile__note">around {{ fmtDate(stats.best.date) }}</span>
        </div>
        <div v-if="stats.toNextPct != null" class="tile">
          <span class="tile__label">To race like a{{ /^[aeiou]/i.test(stats.nextLabel) ? 'n' : '' }} {{ stats.nextLabel }}</span>
          <strong class="tile__value">{{ stats.toNextPct > 0 ? stats.toNextPct.toFixed(1) + '% quicker' : 'Already there' }}</strong>
          <span class="tile__note">{{ stats.toNextPct > 0 ? 'about ' + fmtDuration(stats.toNextPct / 100 * stats.typicalSecs) + ' a race' : 'ready for promotion' }}</span>
        </div>
      </section>

      <section class="card pd__chartcard">
        <h2>How {{ mine ? 'your' : 'their' }} {{ shownBoat === 'canoe' ? 'canoe ' : '' }}racing has changed</h2>
        <ProgressChart :points="result.points" :trend="result.trend" :describe="describe" :scale="result.scale" :place="place" :words="W" :notes="notes" />
        <details class="note" :open="!narrow">
          <summary>How to read this chart</summary>
          Each dot is a race, placed by how quick it was against the rest of that race's field (all clubs),
          on the division ladder: higher is quicker, one line is one division (about 5.8% of the time).
          Course length is already allowed for (each race is compared with others on the same course); dot
          size just shows which course it was: Hasler divisions 7–9 race the short course, 4–6 the medium, 1–3 the long.
          {{ W.two }} dots are their own rating plus half of how much quicker or slower the crew went than the two of them usually would: the crew's day is shared equally between them.
          <template v-if="shownBoat === 'canoe'">The ladder here is the canoe divisions (how quick a typical C1 in each division is). Results marked “no one to compare with” had nobody else in that class on the day, so they aren’t on the chart.</template>
        </details>
      </section>
      </div>

      <section class="card" aria-label="K2 partners">
        <h2>{{ W.two }} partners</h2>
        <template v-if="partners.length">
          <p class="partners__sum">
            {{ mine ? 'You have' : 'They have' }} raced {{ k2Total }} {{ W.two }} race{{ k2Total === 1 ? '' : 's' }}
            with {{ partners.length }} partner{{ partners.length === 1 ? '' : 's' }}.
          </p>
          <p v-if="regulars.length" class="partners__sum">
            {{ regulars.length === 1 ? 'One crew has' : regulars.length + ' crews have' }} raced together {{ REGULAR_CREW }} times or more. For those, the table shows how their races went against {{ mine ? 'your' : 'their' }} own form at the time.
            <template v-if="bestCrew"> {{ mine ? 'You go' : 'They go' }} quickest with <strong>{{ bestCrew.name }}</strong> ({{ pct(bestCrew.avg) }} on average).</template>
          </p>
          <div class="table-wrap">
            <table class="results partners">
              <thead>
                <tr><th>Partner</th><th>Races together</th><th>Against {{ mine ? 'your' : 'their' }} form</th><th>Over the races</th></tr>
              </thead>
              <tbody>
                <template v-for="p in partners" :key="p.name">
                <tr :class="{ regular: p.races >= REGULAR_CREW, open: openCrew === crewKey(p) }">
                  <td class="partners__who">
                    <a v-if="!shared" :href="`?name=${encodeURIComponent(p.name)}`" @click.prevent="query = p.name; search()">{{ p.name }}</a>
                    <a v-else-if="mine" :href="`?t=${encodeURIComponent(token)}&with=${encodeURIComponent(p.name)}`">{{ p.name }}</a>
                    <template v-else>{{ p.name }}</template>
                    <small>{{ fmtMonth(p.first) }}<template v-if="fmtMonth(p.last) !== fmtMonth(p.first)"> – {{ fmtMonth(p.last) }}</template><template v-if="p.podiums"> · {{ p.podiums }} podium{{ p.podiums === 1 ? '' : 's' }}</template></small>
                  </td>
                  <td class="partners__n">
                    <span class="partners__bar" :style="{ width: (p.races / partners[0].races * 100) + '%' }" aria-hidden="true"></span>
                    <strong>{{ p.races }}</strong>
                  </td>
                  <td class="partners__form" :class="crewCls(p.avg)">
                    <template v-if="p.races >= REGULAR_CREW && p.avg != null">
                      <strong>{{ crewAvgWords(p.avg) }}</strong>
                      <small>{{ pct(p.avg) }} on average · best {{ pct(p.best.v) }}, worst {{ pct(p.worst.v) }}</small>
                    </template>
                    <small v-else-if="p.races >= REGULAR_CREW">Not enough rated races yet</small>
                  </td>
                  <td class="partners__trend" :class="crewCls(p.change)">
                    <button v-if="p.races >= REGULAR_CREW && p.change != null" type="button" class="partners__open" :aria-expanded="openCrew === crewKey(p)" :aria-controls="'crew-' + crewKey(p).replace(/\W+/g, '-')" @click="toggleCrew(p)">
                      <svg :width="SPARK.w" :height="SPARK.h" role="img" :aria-label="sparkText(p)">
                        <title>{{ sparkText(p) }}</title>
                        <line x1="0" :x2="SPARK.w" :y1="SPARK.h / 2" :y2="SPARK.h / 2" class="spark__zero" />
                        <path :d="sparkPath(p)" class="spark__line" />
                        <circle v-for="(f, i) in p.forms" :key="i" :cx="sparkX(p, i)" :cy="sparkY(f.v)" :r="i === p.forms.length - 1 ? 3.4 : 2.2" class="spark__dot" />
                      </svg>
                      <small><strong>{{ crewChangeWords(p.change) }}</strong> · {{ openCrew === crewKey(p) ? 'hide' : 'tap for the races' }} {{ openCrew === crewKey(p) ? '▴' : '▾' }}</small>
                    </button>
                  </td>
                </tr>
                <tr v-if="openCrew === crewKey(p) && p.forms.length" :id="'crew-' + crewKey(p).replace(/\W+/g, '-')" class="crewrow">
                  <td colspan="4">
                    <p class="crewrow__head">Every race with {{ p.name }}, newest first. A bar to the right means quicker than {{ mine ? 'your' : 'their' }} usual form, to the left slower.</p>
                    <ol class="crewrow__list">
                      <li v-for="(f, i) in p.forms.slice().reverse()" :key="i" :class="crewCls(f.v)">
                        <span class="crewrow__when">{{ fmtDate(f.date) }}</span>
                        <span class="crewrow__race">
                          <a v-if="f.row.url" :href="BASE + f.row.url + (f.row.tab ? '#race-' + f.row.tab : '')" target="_blank" rel="noopener">{{ f.race || f.row.event }}</a><template v-else>{{ f.race || f.row.event }}</template>
                          <small>{{ place(f.row) }}<template v-if="f.row.t"> · {{ fmtTime(f.row.t) }}</template></small>
                        </span>
                        <span class="crewrow__bar" aria-hidden="true"><i :style="barStyle(f.v)"></i></span>
                        <span class="crewrow__v" :title="describeForm(f.v)">{{ formShort(f.v) }}</span>
                      </li>
                    </ol>
                  </td>
                </tr>
                </template>
              </tbody>
            </table>
          </div>
          <p class="note">Counted from the {{ shownBoat === 'canoe' ? 'C2' : 'K2' }} results since 2010. The same partner under a different spelling of their name may be listed separately. “Against form” compares each crew race with {{ mine ? 'your' : 'the paddler’s' }} own form at the time, not the partner’s: a crew can beat it because the partner is quicker, so read it as a guide, not proof of a good pairing. The line runs from the first race together to the latest, quicker upwards, the dashed line being usual form.</p>
        </template>
        <p v-else class="partners__none">No {{ W.two }} results yet.</p>
      </section>

      <section v-if="!withName" class="card">
        <h2>Coaching that would help most</h2>
        <div class="ideas">
          <article v-for="(i, k) in result.ideas.slice(0, 6)" :key="i.kind" class="idea" :class="{ 'idea--top': k === 0 }">
            <h3>{{ i.title }}</h3>
            <p class="idea__why">{{ i.why }}</p>
            <ul>
              <li v-for="h in i.how" :key="h">
                <template v-if="h.includes('Resources page')">
                  {{ h.split('Resources page')[0] }}<a href="/resources/">Resources page</a>{{ h.split('Resources page')[1] }}
                </template>
                <template v-else>{{ h }}</template>
              </li>
            </ul>
          </article>
        </div>
        <p v-if="shared" class="note">Ideas worked out from your race results alone: talk them through with your coach.</p>
        <p v-else class="note">Ideas worked out from the race results alone: talk them through with the paddler, who knows what the numbers don't.</p>
      </section>

      <section id="all-results" class="card">
        <h2>All results</h2>
        <p v-if="ncCount" class="note note--nc">† {{ ncCount }} of these results don’t say whether the boat was a kayak or a canoe (older marathon results, and a few newer races, leave the class out), so they are counted as kayak. For someone who races both, some may really be canoe results.</p>
        <div class="table-wrap">
          <table class="results">
            <thead>
              <tr><th>Date</th><th>Race</th><th>Event</th><th>Course</th><th>With</th><th>Div</th><th>Place</th><th>Time</th><th>Raced like</th><th>Vs their form</th></tr>
            </thead>
            <tbody>
              <template v-for="(r, i) in newestFirst" :key="i">
              <tr :class="{ odd: r.odd, promoted: r.promo }">
                <td>{{ fmtDate(r.date) }}</td>
                <td><a v-if="r.url" :href="BASE + r.url + (r.tab ? '#race-' + r.tab : '')" target="_blank" rel="noopener">{{ r.race }}</a><template v-else>{{ r.race }}</template><small v-if="r.provisional" class="prov" title="A recent race: the results may still change"> provisional</small><button v-if="canComment && r.rid" type="button" class="nbtn nbtn--add" @click="editNote(r)">+ Comment</button></td>
                <td>{{ r.event }}<sup v-if="r.nc" class="nc" title="These results don’t say whether this was a kayak or a canoe: counted as a kayak">†</sup></td>
                <td>{{ r.course ? COURSES[r.course].label.replace(' course', '') : '' }}</td>
                <td>{{ r.partner || '' }}</td>
                <td>{{ r.div || rankName(ownDivision(r)) }}<span v-if="r.promo" class="promo-tag" :class="{ 'promo-tag--inferred': r.promo.inferred }" :title="r.promo.inferred ? `Promoted to ${divName(r.promo.to)} at or after this race (the results page doesn't say: their next K1 was in ${divName(r.promo.to)})` : `Promoted to ${divName(r.promo.to)} at this race`">▲ {{ divName(r.promo.to) }}</span><small v-else-if="r.pd" :title="/^D/i.test(r.pd) ? 'Demotion offered' : ''"> {{ r.pd }}</small></td>
                <td>{{ place(r) }}</td>
                <td>{{ fmtTime(r.t) }}</td>
                <td>{{ r.level != null ? describe(r.level) : 'no one to compare with' }}</td>
                <td :title="describeForm(r.vsForm)" :class="{ good: r.vsForm <= -1, bad: r.vsForm >= 1 }">{{ formShort(r.vsForm) }}</td>
              </tr>
              <tr v-if="notes[r.rid]?.length" class="notesrow">
                <td colspan="10">
                  <div v-for="c in notes[r.rid]" :key="c.id" class="ncomment">
                    <span class="nicon" aria-hidden="true">💬</span>
                    <span v-for="f in c.flags" :key="f" class="nflag">{{ flagLabel(f) }}</span>
                    <span v-if="c.unfair" class="nflag nflag--unfair" title="Not a fair result: it hardly counts towards the ratings">Not a fair result</span>
                    <span v-if="c.about" class="nabout">{{ c.about }}:</span>
                    <span v-if="c.text" class="ntext">{{ c.text }}</span>
                    <button v-if="canRemove(c)" type="button" class="nbtn nbtn--rm" @click="removeNote(r.rid, c)">Remove</button>
                  </div>
                </td>
              </tr>
              <tr v-if="editing && editing.rid === r.rid" class="noteedit">
                <td colspan="10">
                  <div class="nform">
                    <div class="nform__flags">
                      <label v-for="[f, label] in NOTE_FLAGS" :key="f"><input v-model="editing.flags" type="checkbox" :value="f" /> {{ label }}</label>
                    </div>
                    <textarea v-model="editing.text" maxlength="280" rows="2" placeholder="A comment on this race: the conditions, the start, what happened (280 characters)"></textarea>
                    <label v-if="canJudge" class="nform__unfair"><input v-model="editing.unfair" type="checkbox" /> Not a fair result (stopped to help, capsized, wrong course...): don't count it in the rating</label>
                    <p class="nform__public">Comments are public: anyone who looks this paddler up can read them, and only coaches can remove one. Please be kind, and don't name other people.</p>
                    <p v-if="editing.error" class="nform__err">{{ editing.error }}</p>
                    <div class="nform__btns">
                      <button type="button" class="nbtn nbtn--go" :disabled="editing.saving" :aria-busy="editing.saving" @click="saveNote">{{ editing.saving ? 'Saving...' : 'Add comment' }}</button>
                      <button type="button" class="nbtn" :disabled="editing.saving" @click="editing = null">Cancel</button>
                    </div>
                  </div>
                </td>
              </tr>
              </template>
            </tbody>
          </table>
        </div>
        <p v-if="canLink" class="note">Coaches: <a href="/api/paddler-notes?export=csv" download>download every comment as a spreadsheet (CSV)</a> to keep a copy: the comments exist only in this app.</p>
        <p class="note">From the public marathon results (entries.canoemarathon.org.uk), {{ shownBoat === 'canoe' ? 'canoe (C1 and C2)' : 'kayak (K1 and K2)' }} races only<template v-if="boats.length > 1">: the toggle above switches to the {{ shownBoat === 'canoe' ? 'kayak' : 'canoe' }} results</template>; checked {{ fmtDate(data.fetchedAt) }}.</p>
      </section>
      <section v-if="sprint && (sprint.entries.length || sprint.indexed || canLink)" class="card pd__sprint" aria-label="National sprint regattas">
        <h2>National sprint regattas</h2>
        <template v-if="sprint.entries.length">
          <div v-for="g in sprintGroups" :key="g.id" class="sprint__reg">
            <h3><a v-if="g.info.url" :href="g.info.url" target="_blank" rel="noopener">{{ g.info.title || g.id }}</a><template v-else>{{ g.info.title || g.id }}</template></h3>
            <div class="tablewrap">
              <table>
                <thead><tr><th>Race</th><th>Place</th><th>Time</th><th>With</th></tr></thead>
                <tbody>
                  <tr v-for="(e, i) in g.rows" :key="i">
                    <td>{{ e.event }}</td><td>{{ sprintPlace(e) }}</td><td>{{ e.time || '' }}</td><td>{{ (e.with || []).join(', ') }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        <div v-if="sprintCompare.length" class="sprint__compare">
          <h3>Compared across regattas</h3>
          <p class="note">The fastest time in each regatta (heat or final) at each distance. Green is the paddler’s best. Conditions and fields differ between regattas.
            <label class="sprint__pace"><input v-model="sprintPace" type="checkbox" /> Show pace per 500 m instead (to compare distances)</label></p>
          <div v-for="b in sprintCompare" :key="b.boat" class="tablewrap">
            <table class="sprint__tbl">
              <caption>{{ b.boat }}</caption>
              <thead><tr><th>Regatta</th><th v-for="d in b.metres" :key="d">{{ d }} m</th></tr></thead>
              <tbody>
                <tr v-for="r in b.rows" :key="r.id">
                  <th scope="row">{{ r.label }}</th>
                  <td v-for="(c, i) in r.cells" :key="i" :class="{ pb: c && c.seconds === b.best[i] }" :title="c ? c.event + (c.pos ? ', ' + sprintPlace(c) : '') : ''">{{ sprintShow(c, b.metres[i]) }}</td>
                </tr>
                <tr class="sprint__best"><th scope="row">Best</th><td v-for="(t, i) in b.best" :key="i">{{ sprintBestShow(t, b.metres[i]) }}</td></tr>
              </tbody>
            </table>
          </div>
        </div>
          <p v-if="sprint.ambiguous" class="note">Careful: the results only give an initial and surname, and {{ sprint.ambiguous === 1 ? 'another paddler at this club has' : 'other paddlers at this club have' }} the same, so some of these may be someone else’s.</p>
        </template>
        <p v-else-if="sprint.indexed" class="note"><strong>No National Sprint Regatta results found for this paddler</strong> in the last five years.</p>
        <p class="note">From the official National Sprint Regatta results (canoeingresults.com), the last five years. The results print only an initial, a surname and a club, so these are matched on those.</p>
        <p v-if="canLink && sprint.indexed" class="note">Last read {{ fmtDate(sprint.at) }}: {{ sprint.read }} regatta{{ sprint.read === 1 ? '' : 's' }} found<template v-if="sprint.problems?.length"> · problems: {{ sprint.problems.map(p => (p.id || p.year || '') + ' ' + p.error).join('; ') }}</template>.</p>
        <p v-if="canLink" class="note">Coaches: <button type="button" class="link-btn" @click="updateSprint">read the latest sprint results</button><template v-if="sprintMsg"> · {{ sprintMsg }}</template></p>
      </section>
      <section v-if="canOwnData" class="card pd__mydata" aria-label="Your data">
        <h2>{{ mine ? 'Your data' : 'This paddler’s data' }}</h2>
        <p class="note">Apart from the public marathon results, this page keeps the comments on {{ mine ? 'your' : 'their' }} races and the names that have been put together under {{ mine ? 'yours' : 'theirs' }}. {{ mine ? 'You' : 'They' }} can have a copy, or have all of it deleted.</p>
        <p class="pd__mydata-do">
          <a class="btn" :href="myDataUrl" download>Download {{ mine ? 'my' : 'their' }} data</a>
          <button type="button" class="btn btn--quiet" :disabled="erase.busy" :aria-busy="erase.busy" @click="eraseMine">{{ erase.busy ? 'Deleting…' : mine ? 'Delete all my comments and name links' : 'Delete all their comments and name links' }}</button>
        </p>
        <p v-if="erase.done" class="pd__status">{{ erase.done }}</p>
        <p v-if="erase.error" class="pd__status pd__status--warn">{{ erase.error }}</p>
      </section>
    </template>
    <details class="pd__privacy">
      <summary>Privacy: what this page keeps</summary>
      <p>The race results are the public results from entries.canoemarathon.org.uk, read again from that site. Bishops Stortford Canoe Club adds: <strong>public comments</strong> that anyone can write on a result (visible to everyone who looks that paddler up); <strong>name links</strong> that put one person's results together when they changed club or name; and speed ratings worked out from the results. We use them to help paddlers and coaches see how racing is going.</p>
      <p>To see, download or delete the comments on your results, or the names that have been put together under yours, or to ask anything else about your data, contact {{ PRIVACY_NAME }} at <a :href="`mailto:${PRIVACY_EMAIL}`">{{ PRIVACY_EMAIL }}</a>. Please don’t put anything private about anyone in a comment.</p>
    </details>
  </main>
</template>

<style scoped>
.pd__star { align-self: center; display: inline-flex; align-items: center; gap: 0.35em; padding: 3px 12px; border-radius: 999px; background: #123430; color: #ffd23f; font-weight: 700; font-size: 0.8rem; letter-spacing: 0.03em; white-space: nowrap; box-shadow: 0 0 0 2px #ffd23f inset; }
.pd { max-width: 1080px; margin: 0 auto; padding: 18px 24px 60px; }
.pd__bar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; }
.pd__back { color: var(--heading); font-weight: 600; text-decoration: none; }
.pd__back:hover { text-decoration: underline; }
.pd__signed { margin: 0; font-size: 0.82rem; color: var(--muted); }
.pd__signed a { color: var(--heading); }
.pd__search { display: flex; gap: 8px; }
.pd__search input { min-width: 240px; padding: 8px 12px; border: 1.5px solid var(--teal); border-radius: 4px; font: inherit; background: var(--surface); color: var(--ink); }
.pd__intro { margin: 40px 0; font-size: 1.05rem; color: var(--muted); }
.pd__head { display: flex; align-items: center; gap: 18px; margin: 26px 0 18px; }
.pd__photo { width: 84px; height: 84px; border-radius: 50%; object-fit: cover; flex: none; }
.pd__photo--none { display: grid; place-items: center; background: var(--teal); color: var(--white); font: 700 2rem var(--font-display); }
.pd__who { flex: 1; min-width: 0; }
.pd__kicker { margin: 0; font-size: 0.78rem; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--clay); }
.pd__who h1 { font-size: clamp(2rem, 5vw, 3rem); color: var(--heading); }
.pd__facts { margin: 6px 0 0; color: var(--muted); }
.pd__namerow { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 12px; }
.pd__links { display: inline-flex; gap: 6px; }
.pd__links .btn { text-decoration: none; display: inline-block; }
.btn--sm { padding: 4px 10px; font-size: 0.72rem; line-height: 1.3; border-radius: 999px; white-space: nowrap; }
.btn--quiet { background: var(--surface); color: var(--heading); border: 1.5px solid var(--line); }
.share { margin: -4px 0 18px; padding: 12px 16px; background: var(--surface); border: 1.5px solid var(--teal); border-left-width: 5px; border-radius: 6px; }
.share__what { margin: 0 0 8px; font-size: 0.88rem; }
.share__row { display: flex; flex-wrap: wrap; gap: 8px; }
.share__url { flex: 1; min-width: 220px; padding: 8px 10px; border: 1.5px solid var(--line); border-radius: 4px; font: 0.85rem ui-monospace, monospace; background: var(--paper, var(--surface)); color: var(--ink); }
.pd__status { color: var(--muted); }
.pd__others { margin: -6px 0 16px; font-size: 0.86rem; color: var(--muted); }
.move { margin: 0 0 18px; padding: 14px 16px; background: var(--surface); border: 1.5px solid var(--gold); border-left-width: 5px; border-radius: 6px; }
.move__text { margin: 0 0 10px; }
.move__do { display: flex; flex-wrap: wrap; gap: 8px; }
.pd__same-title { margin: 0 0 6px; }
.pd__same-list { list-style: none; margin: 0 0 8px; padding: 0; display: grid; gap: 4px; }
.pd__same-list label { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 8px; cursor: pointer; }
.pd__same-list input { accent-color: var(--teal); }
.pd__same-when { color: var(--muted); }
.pd__same-do { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 14px; }
.pd__same-do small { flex: 1 1 320px; color: var(--muted); font-size: 0.8rem; }
/* a club's abbreviation, picked out wherever clubs are named */
.club { font-style: italic; font-weight: 700; color: var(--heading); letter-spacing: 0.02em; padding: 0 0.3em; border-radius: 4px; background: color-mix(in srgb, var(--gold) 28%, transparent); }
.pd__others a { color: var(--heading); }
.boat-toggle { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 0 0 16px; }
.boat-toggle button { padding: 7px 14px; border: 1.5px solid var(--teal); border-radius: 999px; background: var(--surface); color: var(--heading); font: 600 0.9rem var(--font-body); cursor: pointer; }
.boat-toggle button.on { background: var(--teal); color: var(--white); }
.boat-toggle button:focus-visible { outline: 3px solid var(--gold); outline-offset: 2px; }
.boat-toggle__note { font-size: 0.8rem; color: var(--muted); }
.pd__status--warn { color: var(--clay); font-weight: 600; }
.maybe { margin: -4px 0 18px; padding: 14px 16px; background: var(--surface); border: 1.5px solid var(--gold); border-left-width: 5px; border-radius: 6px; }
.maybe h2 { margin: 0 0 4px; font: 700 1.25rem var(--font-display); color: var(--heading); }
.maybe__what { margin: 0 0 10px; font-size: 0.86rem; color: var(--muted); }
.maybe__one { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px; padding: 10px 0; border-top: 1px solid var(--line); }
.maybe__who { display: grid; gap: 2px; min-width: 0; flex: 1 1 320px; }
.maybe__who a { color: var(--heading); }
.maybe__who span { font-size: 0.88rem; }
.maybe__who small { color: var(--muted); font-size: 0.8rem; }
.maybe__do { display: flex; gap: 8px; }
.link-btn { background: none; border: 0; padding: 0; color: var(--heading); text-decoration: underline; font: inherit; cursor: pointer; }
.tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin-bottom: 18px; }
.tile { display: grid; gap: 4px; padding: 14px 16px; background: var(--surface); border: 1.5px solid var(--line); border-radius: 6px; }
.tile__label { font-size: 0.8rem; color: var(--muted); }
.tile__value { font: 700 1.45rem var(--font-display); color: var(--heading); }
.tile__value.up { color: var(--teal); }
.tile__value.down { color: var(--clay); }
.tile__note { font-size: 0.8rem; color: var(--muted); min-height: 1em; }
.card { padding: 18px 20px; margin-bottom: 18px; background: var(--surface); border: 1.5px solid var(--line); border-radius: 6px; }
.card h2 { font-size: 1.5rem; color: var(--heading); margin-bottom: 12px; }
.note { font-size: 0.82rem; color: var(--muted); margin: 10px 0 0; max-width: 80ch; }
details.note summary { cursor: pointer; font-weight: 600; color: var(--heading); margin-bottom: 4px; }
.pd__main { display: flex; flex-direction: column; }
.ideas { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 14px; }
.idea { padding: 14px 16px; border: 1.5px solid var(--mist); border-left: 4px solid var(--teal); border-radius: 4px; }
.idea--top { border-left-color: var(--clay); }
.idea h3 { font: 600 1rem var(--font-body); color: var(--heading); margin-bottom: 6px; line-height: 1.3; }
.idea__why { margin: 0 0 8px; font-size: 0.9rem; }
.idea ul { margin: 0; padding-left: 18px; font-size: 0.86rem; color: var(--muted); }
.idea li { margin: 3px 0; }
.idea a { color: var(--heading); }
.table-wrap { overflow-x: auto; }
.results { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
.results th { text-align: left; font-weight: 600; color: var(--muted); border-bottom: 1.5px solid var(--line); padding: 6px 8px; white-space: nowrap; }
.results td { padding: 6px 8px; border-bottom: 1px solid var(--mist); vertical-align: top; }
.results td:first-child, .results td:nth-child(7) { white-space: nowrap; font-variant-numeric: tabular-nums; }
.results tr.odd td { opacity: 0.55; }
.results tr.promoted td { background: color-mix(in srgb, var(--gold) 16%, transparent); }
.results tr.promoted td:first-child { box-shadow: inset 4px 0 0 var(--gold); }
.promo-tag { margin-left: 6px; padding: 1px 6px; border-radius: 999px; background: var(--gold); color: var(--on-clay, #14201e); font-size: 0.72rem; font-weight: 700; white-space: nowrap; }
.notesrow td { padding-top: 0; white-space: normal; }
.notesrow .ncomment { margin: 2px 0; padding: 6px 10px; border-radius: 8px; border-left: 4px solid #e08a1e; background: #fff4e0; color: #5a3200; }
.notesrow .ntext { color: #5a3200; font-style: italic; }
.notesrow .nflag { background: #fbdca8; color: #5a3200; }
.notesrow .nflag--unfair { background: #e08a1e; color: #fff; }
.nbtn--add { display: block; }
.sprint__compare { margin: 6px 0 18px; }
.sprint__compare h3 { margin: 6px 0 4px; font-size: 1rem; }
.sprint__pace { display: block; margin-top: 6px; }
.sprint__tbl caption { text-align: left; font-weight: 700; padding: 6px 0 2px; }
.sprint__tbl td { font-variant-numeric: tabular-nums; }
.sprint__tbl td.pb { background: #d9f2e3; font-weight: 700; color: #11613a; }
.sprint__best th, .sprint__best td { border-top: 2px solid var(--line); font-weight: 700; }
.sprint__reg h3 { margin: 14px 0 6px; font-size: 0.95rem; }
.pd__mydata-do { display: flex; flex-wrap: wrap; gap: 10px; margin: 8px 0 0; }
.pd__privacy { margin: 28px 0 0; font-size: 0.84rem; color: var(--muted); }
.pd__privacy summary { cursor: pointer; font-weight: 600; color: var(--heading); }
.nabout { margin-right: 4px; font-weight: 700; }
.nicon { margin-right: 6px; }
.nflag { display: inline-block; margin: 0 4px 2px 0; padding: 1px 7px; border-radius: 999px; background: var(--pool); color: var(--heading); font-size: 0.72rem; font-weight: 600; white-space: nowrap; }
.nflag--unfair { background: var(--gold); }
.ntext { display: inline; font-size: 0.82rem; color: var(--heading); white-space: normal; overflow-wrap: anywhere; word-break: break-word; }
.nbtn { margin-top: 2px; padding: 2px 9px; border: 1.5px solid var(--line); border-radius: 999px; background: transparent; color: var(--heading); font: inherit; font-size: 0.76rem; font-weight: 600; cursor: pointer; }
.nbtn:hover { border-color: var(--teal); }
.ncomment { margin-bottom: 4px; }
.nbtn--rm { margin-left: 6px; color: #a1281f; }
.nbtn--go { background: var(--teal); border-color: var(--teal); color: #fff; }
.noteedit td { background: var(--pool); }
.nform { display: grid; gap: 8px; max-width: 640px; }
.nform__flags { display: flex; flex-wrap: wrap; gap: 4px 14px; font-size: 0.84rem; }
.nform textarea { width: 100%; font: inherit; padding: 6px 8px; border: 1.5px solid var(--line); border-radius: 8px; resize: vertical; }
.nform__unfair { font-size: 0.84rem; }
.nform__public { margin: 0; font-size: 0.78rem; color: var(--muted); }
.nform__err { margin: 0; color: #a1281f; font-size: 0.84rem; }
.nform__btns { display: flex; gap: 8px; }
.pd__promos { margin: 4px 0 0; font-size: 0.86rem; color: var(--heading); font-weight: 600; }
.pd__promos-note { display: block; font-weight: 400; color: var(--muted); font-size: 0.78rem; }
.promo-tag--inferred { background: transparent; color: var(--heading); border: 1.5px dashed var(--gold); }
.results td.good { color: var(--teal); font-weight: 600; }
.results td.bad { color: var(--clay); }
.results td:last-child { white-space: nowrap; }
.results a { color: var(--heading); }
.prov { color: var(--clay); font-size: 0.72rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; }
.partners__sum { margin: 0 0 10px; color: var(--muted); }
.nc { color: var(--clay); font-weight: 700; margin-left: 2px; cursor: help; }
.note--nc { margin: 0 0 10px; }
.pd__ncwarn { color: #8a5a00; }
.pd__ncwarn a { color: inherit; text-decoration: underline; }
.partners__none { margin: 0; color: var(--muted); }
.partners__n { position: relative; min-width: 120px; font-variant-numeric: tabular-nums; }
.partners__bar { position: absolute; left: 8px; top: 50%; height: 60%; max-width: calc(100% - 16px); transform: translateY(-50%); background: color-mix(in srgb, var(--teal) 22%, transparent); border-radius: 3px; }
.partners__n strong { position: relative; padding-left: 6px; color: var(--heading); }
.partners__who small, .partners__form small, .partners__trend small { display: block; color: var(--muted); font-size: 0.74rem; line-height: 1.3; }
.partners tr.regular td { background: color-mix(in srgb, var(--teal) 6%, transparent); }
.partners tr.regular td:first-child { box-shadow: inset 4px 0 0 var(--teal); }
.partners__form strong, .partners__trend strong { font-weight: 700; }
.partners__form.good strong, .partners__trend.good strong { color: var(--teal); }
.partners__form.bad strong, .partners__trend.bad strong { color: var(--clay); }
.partners td { vertical-align: middle; }
.partners__trend svg { display: block; }
.partners__open { all: unset; box-sizing: border-box; display: block; cursor: pointer; padding: 4px 6px; margin: -4px -6px; border-radius: 6px; }
.partners__open:hover { background: color-mix(in srgb, var(--teal) 10%, transparent); }
.partners__open:focus-visible { outline: 3px solid var(--heading); outline-offset: 1px; }
.partners__open small { display: block; }
.partners tr.open td { border-bottom-color: transparent; }
.crewrow td { background: color-mix(in srgb, var(--teal) 6%, transparent); padding: 4px 10px 12px; }
.crewrow__head { margin: 4px 0 8px; font-size: 0.8rem; color: var(--muted); }
.crewrow__list { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
.crewrow__list li { display: grid; grid-template-columns: 5.6rem 1fr; grid-template-areas: 'when race' 'bar bar' ; gap: 2px 10px; padding: 8px 0; border-top: 1px solid var(--mist); font-size: 0.85rem; }
.crewrow__when { grid-area: when; color: var(--muted); font-variant-numeric: tabular-nums; }
.crewrow__race { grid-area: race; }
.crewrow__race small { display: block; color: var(--muted); font-size: 0.76rem; }
.crewrow__bar { grid-area: bar; position: relative; height: 10px; background: var(--mist); border-radius: 5px; }
.crewrow__bar::after { content: ''; position: absolute; left: 50%; top: -2px; bottom: -2px; width: 1.5px; background: var(--muted); opacity: 0.6; }
.crewrow__bar i { position: absolute; top: 0; bottom: 0; background: var(--muted); border-radius: 5px; }
.crewrow__list li.good .crewrow__bar i { background: var(--teal); }
.crewrow__list li.bad .crewrow__bar i { background: var(--clay); }
.crewrow__v { grid-area: bar; justify-self: end; position: relative; top: 14px; font-size: 0.78rem; font-weight: 600; }
.crewrow__list li { padding-bottom: 24px; }
.crewrow__list li.good .crewrow__v { color: var(--teal); }
.crewrow__list li.bad .crewrow__v { color: var(--clay); }
.spark__zero { stroke: var(--muted); stroke-width: 1; stroke-dasharray: 3 3; opacity: 0.6; }
.spark__line { fill: none; stroke: var(--teal); stroke-width: 1.8; stroke-linejoin: round; stroke-linecap: round; }
.spark__dot { fill: var(--teal); }
.partners__trend.bad .spark__line, .partners__trend.bad .spark__dot { stroke: var(--clay); fill: var(--clay); }
.partners__trend.bad .spark__line { fill: none; }
@media (max-width: 640px) {
  .pd { padding: 12px 12px 40px; }
  .pd__search { width: 100%; }
  .pd__search input { min-width: 0; flex: 1; }
  /* the top: a smaller photo beside the name, the facts in a smaller type, buttons below */
  .pd__head { flex-wrap: wrap; align-items: flex-start; gap: 12px; margin: 16px 0 12px; }
  .pd__photo { width: 56px; height: 56px; }
  .pd__photo--none { font-size: 1.5rem; }
  .pd__who { flex: 1 1 calc(100% - 70px); }
  .pd__who h1 { font-size: 1.95rem; line-height: 1.05; }
  .pd__kicker { font-size: 0.7rem; }
  .pd__facts { font-size: 0.84rem; line-height: 1.4; }
  .pd__promos { font-size: 0.84rem; }
  .pd__promos--fold summary { cursor: pointer; }
  .pd__promos--fold ol { margin: 6px 0 4px; padding-left: 20px; font-weight: 500; }
  .pd__bar { gap: 8px; }
  .pd__back { font-size: 0.9rem; }
  .pd__search input, .pd__search .btn { padding-top: 7px; padding-bottom: 7px; }
  .pd__links .btn { padding: 3px 9px; font-size: 0.7rem; }
  /* the chart first, edge to edge and bigger; the summary tiles under it, two by two */
  .pd__chartcard { order: -1; margin: 0 -12px 14px; padding: 14px 12px 12px; border-radius: 0; border-left: 0; border-right: 0; }
  .card h2 { font-size: 1.3rem; margin-bottom: 8px; }
  .tiles { grid-template-columns: 1fr 1fr; gap: 8px; }
  .tile { padding: 10px 12px; gap: 2px; }
  .tile__value { font-size: 1.15rem; }
  .tile__label, .tile__note { font-size: 0.74rem; }
}
</style>
