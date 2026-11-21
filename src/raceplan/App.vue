<script setup>
// Race planner (/race-planner/): the planner suggests who races K1 and who pairs up in a K2
// (netlify/functions/lib/crewplan.js, on ratings from every result since 2010), and the
// race coordinator tweaks it by dragging paddlers between boats. The line-up is saved on the
// server (/api/race-plan), so every coordinator sees the same one.
//
// For the race coordinator: behind the coordinator role (Google sign-in, see
// netlify/edge-functions/race-planner-gate.js), separate from the coaches' pages. It
// works from the public marathon results: the club's paddlers are everyone who has raced for
// the club, named as in the results. Photos (members with photo consent) are matched to those
// names on the server; the member list itself isn't sent here.
import { ref, reactive, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import SiteNav from '../shared/SiteNav.vue'
import BoatIcon from './BoatIcon.vue'
import RaceChip from './RaceChip.vue'
import LoadingRiver from '../shared/LoadingRiver.vue'
import { useLoadingPreview } from '../shared/loadingPreview.js'
const preview = useLoadingPreview() // ?loading: show the loading animation
import { crews, loadCrews } from '../coaching/data/crews.js'
import { CLUB_CODE } from '../coaching/data/paddlers.js'
import { planCrews } from '../../netlify/functions/lib/crewplan.js'
import { personKey } from '../../netlify/functions/lib/crewfit.js'
import { fromSuggestion, move, toK1, SEATS, singleOf, removeBoat, clean, ordered, crewKey, pct, RULE_KINDS, ruleText, sameRule } from './lineup.js'

// ---- who: the club's paddlers from the race results -----------------------------------
const ACTIVE_DAYS = 730 // raced for the club in the last two years: in the squad
const fields = computed(() => crews.data?.fields || null)
// key -> { id, name, div, a, n, nK1, nK2, last, active }
const people = computed(() => {
  const map = new Map()
  const now = Date.now()
  for (const r of crews.data?.paddlers || []) {
    if (!/^[1-9]$/.test(String(r.div))) continue
    const id = personKey(r.name)
    if (map.has(id) && map.get(id).n >= r.n) continue // the same person twice: keep the fuller one
    const active = !!r.last && now - Date.parse(r.last) <= ACTIVE_DAYS * 864e5
    map.set(id, { id, name: r.name, div: String(r.div), a: r.a, n: r.n, nK1: r.nK1, nK2: r.nK2, last: r.last, group: r.group || '', sd: r.sd ?? null, active })
  }
  return map
})
const sinceYear = new Date(Date.now() - ACTIVE_DAYS * 864e5).getFullYear()
const byName = (a, b) => a.name.localeCompare(b.name)
const byDiv = (a, b) => (+a.div || 99) - (+b.div || 99) || byName(a, b)

// ---- the line-up ------------------------------------------------------------------
const lineup = ref({ boats: [], out: [] })
const race = ref('')
const date = ref('')
const notes = ref('')
const ready = ref(false)
// the coordinator's rules ("Ben must paddle with Kerry") and whether to keep people in the
// boats they usually race; both go into the suggestion
const rules = ref([])
const familiar = ref(true)
const learning = ref(false) // learning crews: developing paddlers in the back behind experienced ones
const rulesChanged = ref(false) // since the line-up was last planned

const inBoat = computed(() => new Set(lineup.value.boats.flatMap(b => b.seats).filter(Boolean)))
const outSet = computed(() => new Set(lineup.value.out))
const squad = computed(() => [...people.value.values()].filter(p => !inBoat.value.has(p.id) && !outSet.value.has(p.id)))
const squadRated = computed(() => squad.value.filter(p => p.active).sort(byDiv))
const squadOthers = computed(() => squad.value.filter(p => !p.active).sort(byDiv))
const outList = computed(() => lineup.value.out.map(id => people.value.get(id)).filter(Boolean).sort(byDiv))

// the planner's suggestion for everyone with results who isn't marked "not racing"
const suggestion = computed(() => {
  if (!fields.value) return null
  // the squad, and anyone a rule names (a rule says they're racing)
  const named = new Set(rules.value.flatMap(r => [r.a, r.b]))
  const available = [...people.value.values()].filter(p => (p.active || named.has(p.id)) && !outSet.value.has(p.id))
  return available.length ? planCrews(available, fields.value, { rules: rules.value, familiar: familiar.value, learning: learning.value }) : { entries: [], unmet: [] }
})
const suggestedKeys = computed(() => new Set((suggestion.value?.entries || []).map(e => crewKey({ kind: e.kind, seats: e.members.map(m => m.id) }))))

const boats = computed(() => (fields.value ? ordered(lineup.value, people.value, fields.value, rules.value, { familiar: familiar.value, learning: learning.value }) : []))
const groups = computed(() => {
  const out = []
  for (const x of boats.value) {
    const label = x.canoe ? 'Canoes' : x.D == null ? 'Division not known yet' : `Division ${x.D}`
    let g = out.find(g => g.label === label)
    if (!g) out.push((g = { label, D: x.D, boats: [] }))
    g.boats.push(x)
  }
  return out
})
const totals = computed(() => {
  const k2 = lineup.value.boats.filter(b => b.kind === 'K2').length
  const k1 = lineup.value.boats.filter(b => b.kind === 'K1').length
  const c1 = lineup.value.boats.filter(b => b.kind === 'C1').length
  const c2 = lineup.value.boats.filter(b => b.kind === 'C2').length
  return { k1, k2, c1, c2, paddlers: inBoat.value.size, warnings: boats.value.filter(x => x.notes.some(n => n.kind === 'warn')).length }
})

function useSuggestion() {
  if (!suggestion.value) return
  lineup.value = fromSuggestion(suggestion.value.entries, lineup.value.out)
  confirmReset.value = false
  rulesChanged.value = false
}

// ---- rules ----------------------------------------------------------------------------
const newRule = reactive({ a: '', kind: 'together', b: '' })
const pairRule = k => k === 'together' || k === 'apart'
const everyoneByName = computed(() => [...people.value.values()].sort(byName))
const ruleError = ref('')
function addRule() {
  ruleError.value = ''
  const r = { kind: newRule.kind, a: newRule.a, ...(pairRule(newRule.kind) ? { b: newRule.b } : {}) }
  if (!r.a || (pairRule(r.kind) && !r.b)) return (ruleError.value = 'Pick who it’s for.')
  if (r.a === r.b) return (ruleError.value = 'Pick two different paddlers.')
  if (rules.value.some(x => sameRule(x, r))) return (ruleError.value = 'That rule is already there.')
  rules.value = [...rules.value, r]
  newRule.a = ''
  newRule.b = ''
  rulesChanged.value = true
}
function removeRule(i) {
  rules.value = rules.value.filter((_, k) => k !== i)
  rulesChanged.value = true
}
watch([familiar, learning], () => { if (ready.value) rulesChanged.value = true })
const unmet = computed(() => (suggestion.value?.unmet || []).map(r => ruleText(r, people.value)))
const confirmReset = ref(false)

// ---- saving (shared with every coach) ---------------------------------------------
const canEdit = ref(false) // signed in as a coach (the server says)
const save = reactive({ state: 'idle', version: 0, savedAt: null, error: '', theirs: null })
let timer = null
async function loadPlan() {
  const res = await fetch(`/api/race-plan?club=${CLUB_CODE}`, { credentials: 'same-origin' })
  const body = await res.json().catch(() => null)
  if (!res.ok) throw new Error(body?.error || 'HTTP ' + res.status)
  return body
}
function adopt(stored) {
  save.version = stored?.version || 0
  save.savedAt = stored?.savedAt || null
  const plan = stored?.plan
  if (!plan) return false
  race.value = plan.race || ''
  date.value = plan.date || ''
  notes.value = plan.notes || ''
  lineup.value = clean(plan.lineup, new Set(people.value.keys()))
  rules.value = (plan.rules || []).filter(r => people.value.has(r.a) && (r.b == null || people.value.has(r.b)))
  familiar.value = plan.familiar !== false
  learning.value = plan.learning === true
  rulesChanged.value = false
  return true
}
async function push(base = save.version) {
  save.state = 'saving'
  try {
    const res = await fetch(`/api/race-plan?club=${CLUB_CODE}`, {
      method: 'PUT',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ base, race: race.value, date: date.value, notes: notes.value, lineup: lineup.value, rules: rules.value, familiar: familiar.value, learning: learning.value })
    })
    const body = await res.json().catch(() => null)
    if (res.status === 409) {
      save.state = 'conflict'
      save.theirs = body?.current || null
      return
    }
    if (!res.ok) throw new Error(body?.error || 'HTTP ' + res.status)
    save.version = body.version
    save.savedAt = body.savedAt
    save.state = 'saved'
  } catch (e) {
    save.state = 'error'
    save.error = e.message
  }
}
let adopting = false
watch([lineup, race, date, notes, rules, familiar, learning], () => {
  if (!ready.value || adopting || !canEdit.value || save.state === 'conflict') return
  save.state = 'pending'
  clearTimeout(timer)
  timer = setTimeout(() => push(), 700)
}, { deep: true })
function takeTheirs() {
  adopting = true
  adopt(save.theirs)
  save.theirs = null
  save.state = 'saved'
  setTimeout(() => { adopting = false })
}
function keepMine() {
  const base = save.theirs?.version || 0
  save.theirs = null
  push(base)
}
const savedText = computed(() => {
  if (save.state === 'saving' || save.state === 'pending') return 'Saving…'
  if (save.state === 'error') return 'Not saved: ' + save.error
  if (!canEdit.value) return save.savedAt ? 'Last changed ' + new Date(save.savedAt).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''
  if (!save.savedAt) return 'Not saved yet'
  return 'Saved for everyone · ' + new Date(save.savedAt).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
})

// ---- moving people: drag, or click a paddler then click where they go ------------------
const selected = ref(null)
const drag = reactive({ on: false, id: null, x: 0, y: 0, target: null })
let start = null
let justDragged = false

const dropAttr = t => JSON.stringify(t)
function targetAt(x, y) {
  const el = document.elementFromPoint(x, y)?.closest('[data-drop]')
  return el ? el.dataset.drop : null
}
function apply(id, target) {
  const t = typeof target === 'string' ? JSON.parse(target) : target
  lineup.value = move(lineup.value, id, t)
  selected.value = null
}
function grab(e, id) {
  if (e.button > 0 || !canEdit.value) return
  start = { id, x: e.clientX, y: e.clientY }
  window.addEventListener('pointermove', onMove, { passive: false })
  window.addEventListener('pointerup', onUp)
  window.addEventListener('pointercancel', stop)
}
function onMove(e) {
  if (!start) return
  if (!drag.on && Math.hypot(e.clientX - start.x, e.clientY - start.y) < 6) return
  e.preventDefault()
  if (!drag.on) window.getSelection?.().removeAllRanges()
  drag.on = true
  drag.id = start.id
  drag.x = e.clientX
  drag.y = e.clientY
  drag.target = targetAt(e.clientX, e.clientY)
  // scroll when dragging near the top or bottom of the window
  if (e.clientY < 70) window.scrollBy(0, -14)
  else if (e.clientY > window.innerHeight - 70) window.scrollBy(0, 14)
}
function onUp() {
  const was = drag.on ? { id: drag.id, target: drag.target } : null
  stop()
  if (was) {
    justDragged = true
    setTimeout(() => { justDragged = false }, 0)
    if (was.target) apply(was.id, was.target)
  }
}
function stop() {
  start = null
  drag.on = false
  drag.id = null
  drag.target = null
  window.removeEventListener('pointermove', onMove)
  window.removeEventListener('pointerup', onUp)
  window.removeEventListener('pointercancel', stop)
}
// a click on a paddler: pick them up, or, with someone else picked up, swap into their seat
function pick(id, seatTarget = null) {
  if (justDragged || !canEdit.value) return
  if (selected.value && selected.value !== id && seatTarget) return apply(selected.value, seatTarget)
  selected.value = selected.value === id ? null : id
}
// a click on a drop zone, with someone picked up
function place(target) {
  if (selected.value && canEdit.value) apply(selected.value, target)
}
const scrollTop = () => window.scrollTo({ top: 0, behavior: 'smooth' })
const onKey = e => { if (e.key === 'Escape') { selected.value = null; stop() } }
const isHot = t => drag.on && drag.target === dropAttr(t)
const zoneClass = t => ({ 'zone--hot': isHot(t), 'zone--ready': !!selected.value || drag.on })

// ---- start -----------------------------------------------------------------------------
const crewStatus = computed(() => ({ state: crews.state, progress: crews.progress, error: crews.error }))
onMounted(async () => {
  window.addEventListener('keydown', onKey)
  const [, stored] = await Promise.all([loadCrews(CLUB_CODE), loadPlan().catch(e => { save.state = 'error'; save.error = e.message; return null })])
  canEdit.value = !!stored?.canEdit
  if (!fields.value) return
  adopting = true
  if (!adopt(stored)) useSuggestion()
  ready.value = true
  setTimeout(() => { adopting = false })
})
onBeforeUnmount(() => { window.removeEventListener('keydown', onKey); stop() })

const person = id => people.value.get(id)

// ---- photos: members with photo consent, matched by the name they race under -------------
// (/api/members/photos-by-name: the member list itself isn't sent to the planner)
const photos = reactive({}) // id -> data URL | null
async function loadPhotos() {
  const want = [...people.value.values()].filter(p => p.active || inBoat.value.has(p.id) || outSet.value.has(p.id)).filter(p => !(p.id in photos))
  for (const p of want) photos[p.id] = null
  for (let i = 0; i < want.length; i += 40) {
    const batch = want.slice(i, i + 40)
    try {
      const res = await fetch('/api/members/photos-by-name?names=' + encodeURIComponent(batch.map(p => p.name).join('|')), { credentials: 'same-origin' })
      if (!res.ok) return
      const body = await res.json()
      for (const p of batch) photos[p.id] = body.photos?.[p.name] || null
    } catch { return }
  }
}
watch(ready, r => { if (r) loadPhotos() })
watch(() => inBoat.value.size, () => { if (ready.value) loadPhotos() }) // someone brought in from the older list
// against the suggestion the line-up was started from (or, for an older plan, today's)
const changed = b => !(lineup.value.suggested?.length ? lineup.value.suggested.includes(crewKey(b)) : suggestedKeys.value.has(crewKey(b)))
const nameOf = id => person(id)?.name || ''
</script>

<template>
  <SiteNav current="/race-planner/" />
  <main class="rp" :class="{ 'rp--dragging': drag.on, 'rp--picking': !!selected, 'rp--view': !canEdit }">
    <div class="rp__bar">
      <a href="/race-planner/?leave" class="rp__back">Sign out</a>
      <span class="rp__saved" :class="'rp__saved--' + save.state" aria-live="polite">{{ savedText }}</span>
    </div>

    <header class="rp__head">
      <div>
        <p class="rp__kicker">{{ CLUB_CODE }} race planner</p>
        <h1>Line-up</h1>
      </div>
      <div class="rp__race">
        <template v-if="canEdit">
          <label>Race <input v-model="race" type="text" placeholder="e.g. Chelmer Hasler" maxlength="80" /></label>
          <label>Date <input v-model="date" type="date" /></label>
        </template>
        <p v-else-if="race || date" class="rp__racename">{{ race }}<template v-if="race && date"> · </template>{{ date ? new Date(date).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : '' }}</p>
      </div>
    </header>

    <div v-if="save.state === 'conflict'" class="rp__conflict" role="alert">
      Another coach saved a different line-up<template v-if="save.theirs?.savedAt"> at {{ new Date(save.theirs.savedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) }}</template>.
      <button class="btn" type="button" @click="takeTheirs">Show theirs</button>
      <button class="btn btn--quiet" type="button" @click="keepMine">Keep mine (replaces theirs)</button>
    </div>

    <LoadingRiver v-if="preview.on" :progress="preview.progress" :working="preview.working"
      :message="preview.working ? 'Working out everyone\'s ratings: a few more laps… (preview)' : 'Reading the marathon results since 2010… (preview)'" />
    <LoadingRiver v-if="crewStatus.state === 'loading'" :progress="crews.total ? crews.read / crews.total : null" :working="crews.working"
      :message="crews.working ? 'Working out everyone\'s ratings: a few more laps…' : 'Reading the marathon results since 2010 (only the first time)…'" />
    <p v-else-if="crewStatus.state === 'error'" class="rp__status rp__status--warn">Couldn't work out the ratings: {{ crewStatus.error }}</p>

    <template v-if="ready">
      <div class="rp__tools">
        <p class="rp__summary">
          <strong>{{ totals.paddlers }}</strong> racing: <BoatIcon kind="K2" :width="40" class="inline-boat" /> {{ totals.k2 }} K2{{ totals.k2 === 1 ? '' : 's' }},
          <BoatIcon kind="K1" :width="31" class="inline-boat" /> {{ totals.k1 }} K1{{ totals.k1 === 1 ? '' : 's' }}<template v-if="totals.c2">, {{ totals.c2 }} C2{{ totals.c2 === 1 ? '' : 's' }}</template><template v-if="totals.c1">, {{ totals.c1 }} C1{{ totals.c1 === 1 ? '' : 's' }}</template>
          <span v-if="totals.warnings" class="rp__flag">· {{ totals.warnings }} to check</span>
        </p>
        <div class="rp__actions">
          <template v-if="!canEdit">
            <button class="btn btn--quiet" type="button" onclick="window.print()">Print</button>
          </template>
          <template v-else-if="confirmReset">
            <span class="rp__ask">Replace this line-up with the planner's suggestion?</span>
            <button class="btn" type="button" @click="useSuggestion">Yes, start again</button>
            <button class="btn btn--quiet" type="button" @click="confirmReset = false">No</button>
          </template>
          <template v-else>
            <button class="btn btn--quiet" type="button" @click="confirmReset = true">Start again from the suggestion</button>
            <button class="btn btn--quiet" type="button" onclick="window.print()">Print</button>
          </template>
        </div>
      </div>
      <p v-if="!canEdit" class="rp__hint">
        The suggested K1s and K2 crews for the next race. To change it,
        <a href="/race-planner/">sign in again</a> with the race coordinator role.
      </p>
      <p v-else class="rp__hint">
        Drag paddlers between boats, or click a paddler and then click where they should go.
        Dropping onto someone swaps them; dropping onto a K1 makes it a K2 (a C1, a C2).
        Boats are ordered by the division they'd race. Changes are saved for everyone as you go.
      </p>

      <div class="rp__cols">
        <!-- the line-up -->
        <section class="lineup" aria-label="Line-up">
          <div v-for="g in groups" :key="g.label" class="division">
            <h2>{{ g.label }}</h2>
            <article
              v-for="x in g.boats"
              :key="x.boat.id"
              class="boat zone"
              :class="[zoneClass({ type: 'boat', boat: x.boat.id }), 'boat--' + x.boat.kind]"
              :data-drop="dropAttr({ type: 'boat', boat: x.boat.id })"
              @click.self="place({ type: 'boat', boat: x.boat.id })"
            >
              <div class="boat__icon" @click="place({ type: 'boat', boat: x.boat.id })">
                <BoatIcon :kind="x.boat.kind" :width="SEATS[x.boat.kind] === 2 ? 84 : 66" label />
              </div>
              <div class="boat__crew">
                <div
                  v-for="(id, s) in x.boat.seats"
                  :key="s"
                  class="seat zone"
                    :data-pos="SEATS[x.boat.kind] === 2 ? (s === 0 ? 'front' : 'back') : null"
                  :class="[zoneClass({ type: 'seat', boat: x.boat.id, seat: s }), { 'seat--empty': id == null }]"
                  :data-drop="dropAttr({ type: 'seat', boat: x.boat.id, seat: s })"
                  @click.self="place({ type: 'seat', boat: x.boat.id, seat: s })"
                >
                  <RaceChip
                    v-if="id != null && person(id)"
                    :person="person(id)"
                    :photo="photos[id]"
                    :selected="selected === id"
                    @grab="grab($event, id)"
                    @pick="pick(id, { type: 'seat', boat: x.boat.id, seat: s })"
                  />
                  <span v-else class="seat__free" @click="place({ type: 'seat', boat: x.boat.id, seat: s })">{{ canEdit ? 'Drop a partner here' : 'Partner to be decided' }}</span>
                </div>
              </div>
              <div class="boat__score">
                <span v-if="x.beats != null" class="boat__beats" :title="`Would beat about ${pct(x.beats)} of the ${x.boat.kind}s raced in division ${x.D} over the last two years (all clubs)`">beats {{ pct(x.beats) }}</span>
                <span v-if="changed(x.boat)" class="boat__tag boat__tag--changed" title="Changed from what the planner suggested">{{ canEdit ? 'your change' : "coach's pick" }}</span>
                <span v-else class="boat__tag" title="The planner suggested this">suggested</span>
              </div>
              <ul v-if="x.notes.length" class="boat__notes">
                <li v-for="n in x.notes" :key="n.text" :class="'note--' + n.kind">{{ n.text }}</li>
              </ul>
              <div v-if="canEdit" class="boat__menu">
                <button v-if="SEATS[x.boat.kind] === 2" type="button" class="iconbtn" :title="x.boat.seats.every(Boolean) ? `Split into two ${singleOf(x.boat.kind)}s` : `Make it a ${singleOf(x.boat.kind)}`" :aria-label="x.boat.seats.every(Boolean) ? `Split into two ${singleOf(x.boat.kind)}s` : `Make it a ${singleOf(x.boat.kind)}`" @click="lineup = toK1(lineup, x.boat.id)">✂</button>
                <button type="button" class="iconbtn" title="Take this boat out of the line-up (back to 'Not in a boat')" aria-label="Take out of the line-up" @click="lineup = removeBoat(lineup, x.boat.id)">✕</button>
              </div>
            </article>
          </div>
          <p v-if="!groups.length" class="rp__empty">No boats yet: drag paddlers onto "New K1", "New K2", "New C1" or "New C2", or start again from the suggestion.</p>

          <div v-if="canEdit" class="newboats">
            <div class="newboat zone" :class="zoneClass({ type: 'new', kind: 'K2' })" :data-drop="dropAttr({ type: 'new', kind: 'K2' })" @click="place({ type: 'new', kind: 'K2' })">
              <BoatIcon kind="K2" :width="64" /> <span>New K2</span>
            </div>
            <div class="newboat zone" :class="zoneClass({ type: 'new', kind: 'K1' })" :data-drop="dropAttr({ type: 'new', kind: 'K1' })" @click="place({ type: 'new', kind: 'K1' })">
              <BoatIcon kind="K1" :width="50" /> <span>New K1</span>
            </div>
            <div class="newboat zone" :class="zoneClass({ type: 'new', kind: 'C2' })" :data-drop="dropAttr({ type: 'new', kind: 'C2' })" @click="place({ type: 'new', kind: 'C2' })">
              <BoatIcon kind="C2" :width="64" /> <span>New C2</span>
            </div>
            <div class="newboat zone" :class="zoneClass({ type: 'new', kind: 'C1' })" :data-drop="dropAttr({ type: 'new', kind: 'C1' })" @click="place({ type: 'new', kind: 'C1' })">
              <BoatIcon kind="C1" :width="50" /> <span>New C1</span>
            </div>
          </div>
        </section>

        <!-- everyone else -->
        <aside class="side">
          <section v-if="canEdit" class="pool rules" aria-label="Rules for this race">
            <h2>Rules for this race</h2>
            <ul v-if="rules.length" class="rules__list">
              <li v-for="(r, i) in rules" :key="i">
                <span>{{ ruleText(r, people) }}</span>
                <button type="button" class="iconbtn" :aria-label="'Remove rule: ' + ruleText(r, people)" title="Remove this rule" @click="removeRule(i)">✕</button>
              </li>
            </ul>
            <p v-else class="pool__note">E.g. two paddlers who must (or mustn't) share a K2, or someone who must race a K1.</p>
            <form class="rules__add" @submit.prevent="addRule">
              <select v-model="newRule.a" aria-label="Paddler">
                <option value="" disabled>Paddler…</option>
                <option v-for="p in everyoneByName" :key="p.id" :value="p.id">{{ p.name }}</option>
              </select>
              <select v-model="newRule.kind" aria-label="Rule">
                <option v-for="(label, k) in RULE_KINDS" :key="k" :value="k">{{ label }}</option>
              </select>
              <select v-if="pairRule(newRule.kind)" v-model="newRule.b" aria-label="Other paddler">
                <option value="" disabled>Paddler…</option>
                <option v-for="p in everyoneByName" :key="p.id" :value="p.id" :disabled="p.id === newRule.a">{{ p.name }}</option>
              </select>
              <button type="submit" class="btn btn--quiet">Add rule</button>
            </form>
            <p v-if="ruleError" class="rules__error" role="alert">{{ ruleError }}</p>
            <label class="rules__familiar">
              <input v-model="familiar" type="checkbox" />
              Keep people in the boats they usually race (K1 or K2)
            </label>
            <label class="rules__familiar" title="Developing: fewer than 15 results (or a junior with fewer than 25). Experienced: 25+ results and steady from race to race. The experienced paddler is one to three divisions quicker, in the front; the developing one in the back follows their stroke.">
              <input v-model="learning" type="checkbox" />
              Learning crews: developing paddlers in the back of a K2 behind experienced, steady ones
            </label>
            <p v-if="unmet.length" class="rules__error">Can't be kept: {{ unmet.join('; ') }}.</p>
            <button v-if="rulesChanged" type="button" class="btn rules__replan" @click="confirmReset = true; scrollTop()">Re-plan with these rules</button>
          </section>
          <section class="pool zone" :class="zoneClass({ type: 'squad' })" :data-drop="dropAttr({ type: 'squad' })" @click.self="place({ type: 'squad' })">
            <h2 @click="place({ type: 'squad' })">Not in a boat <small>({{ squadRated.length }})</small></h2>
            <p class="pool__note" @click="place({ type: 'squad' })">Available, but not in this line-up.</p>
            <div class="pool__chips">
              <RaceChip v-for="p in squadRated" :key="p.id" :person="p" :photo="photos[p.id]" :selected="selected === p.id" @grab="grab($event, p.id)" @pick="pick(p.id)" />
            </div>
            <details v-if="squadOthers.length" class="pool__others">
              <summary>Raced for {{ CLUB_CODE }} before {{ sinceYear }} ({{ squadOthers.length }})</summary>
              <div class="pool__chips">
                <RaceChip v-for="p in squadOthers" :key="p.id" :person="p" :photo="photos[p.id]" :selected="selected === p.id" @grab="grab($event, p.id)" @pick="pick(p.id)" />
              </div>
            </details>
          </section>

          <section class="pool pool--out zone" :class="zoneClass({ type: 'out' })" :data-drop="dropAttr({ type: 'out' })" @click.self="place({ type: 'out' })">
            <h2 @click="place({ type: 'out' })">Not racing <small>({{ outList.length }})</small></h2>
            <p class="pool__note" @click="place({ type: 'out' })">Away, injured or not entering: left out of the suggestion too.</p>
            <div class="pool__chips">
              <RaceChip v-for="p in outList" :key="p.id" :person="p" :photo="photos[p.id]" :selected="selected === p.id" @grab="grab($event, p.id)" @pick="pick(p.id)" />
            </div>
          </section>

          <section class="pool pool--notes">
            <h2><label for="rp-notes">Notes for the team</label></h2>
            <textarea v-if="canEdit" id="rp-notes" v-model="notes" rows="3" maxlength="500" placeholder="Boat loans, lifts, start times…"></textarea>
            <p v-else class="pool__text">{{ notes || 'None yet.' }}</p>
          </section>
        </aside>
      </div>

      <p class="rp__foot">
        "Beats" is the share of the K1s or K2s raced in that division over the last two years (all clubs) that the boat
        would be quicker than: on the cautious side, as local fields are usually kinder. A K2 races in division
        (div A + div B) ÷ 2, rounded down, but nobody races down a distance (divs 1–3 race the long course, 4–6 the
        medium, 7–9 the short), so a div 5 with a div 9 races div 6, not div 7. Apart from your rules it goes on speed:
        you know who paddles well together. Ratings from {{ crews.data?.races }} races since {{ crews.data?.from }}.
      </p>
    </template>

    <RaceChip v-if="drag.on && person(drag.id)" :person="person(drag.id)" :photo="photos[drag.id]" ghost :style="{ left: drag.x + 'px', top: drag.y + 'px' }" />
    <p v-if="selected && !drag.on" class="rp__picked" role="status">
      Moving <strong>{{ nameOf(selected) }}</strong>: click a seat, a boat, "New K1/K2/C1/C2" or a list. <button type="button" class="link" @click="selected = null">Cancel</button>
    </p>
  </main>
</template>

<style scoped>
.rp { max-width: 1180px; margin: 0 auto; padding: 18px 24px 80px; }
.rp__bar { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 12px; }
.rp__back { color: var(--heading); font-weight: 600; text-decoration: none; }
.rp__back:hover { text-decoration: underline; }
.rp__saved { font-size: 0.82rem; color: var(--muted); }
.rp__saved--error { color: var(--clay); font-weight: 600; }
.rp__head { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: flex-end; gap: 16px; margin: 22px 0 14px; }
.rp__kicker { margin: 0; font-size: 0.78rem; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--clay); }
.rp__head h1 { font-size: clamp(2rem, 5vw, 3rem); color: var(--heading); }
.rp__race { display: flex; flex-wrap: wrap; gap: 10px; }
.rp__race label { display: grid; gap: 3px; font-size: 0.78rem; color: var(--muted); }
.rp__race input, .pool textarea { padding: 7px 10px; border: 1.5px solid var(--line); border-radius: 4px; font: inherit; font-size: 0.92rem; background: var(--surface); color: var(--ink); }
.rp__race input[type='text'] { min-width: 230px; }
.rp__status { color: var(--muted); }
.rp__racename { margin: 0; font: 700 1.2rem var(--font-display); color: var(--heading); }
.pool__text { margin: 6px 0 0; font-size: 0.9rem; white-space: pre-wrap; }
.rp--view :deep(.rchip) { cursor: default; }
.rp--view .side .pool:not(.pool--notes) .pool__note { display: none; }
.rp__status--warn { color: var(--clay); font-weight: 600; }
.rp__conflict { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; padding: 10px 14px; margin-bottom: 12px; border: 1.5px solid var(--clay); border-radius: 6px; background: var(--surface); }
.rp__tools { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 10px; }
.rp__summary { margin: 0; display: flex; flex-wrap: wrap; align-items: center; gap: 6px; color: var(--heading); }
.inline-boat { display: inline-block; color: var(--teal); }
.rp__flag { color: var(--clay); font-weight: 600; }
.rp__actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.rp__ask { font-size: 0.88rem; font-weight: 600; }
.btn--quiet { background: var(--surface); color: var(--heading); border: 1.5px solid var(--line); }
.rp__hint { font-size: 0.84rem; color: var(--muted); max-width: 90ch; margin: 8px 0 16px; }
.rp__cols { display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: 20px; align-items: start; }

.division h2 { font: 700 1.25rem var(--font-display); color: var(--heading); margin: 18px 0 8px; padding-bottom: 4px; border-bottom: 2px solid var(--clay); }
.division:first-child h2 { margin-top: 0; }
.boat {
  display: grid; grid-template-columns: 92px minmax(0, 1fr) auto auto; grid-template-areas: 'icon crew score menu' 'icon notes notes notes';
  align-items: center; gap: 2px 14px; padding: 7px 10px 7px 12px; margin-bottom: 6px;
  background: var(--surface); border: 1.5px solid var(--line); border-left: 5px solid var(--teal); border-radius: 6px;
}
.boat--K1, .boat--C1 { border-left-color: var(--heading); }
.boat--C1, .boat--C2 { border-left-color: #b5651d; }
.boat--K2, .boat--C2 { padding-top: 13px; } /* room for the FRONT / BACK labels above the seats */
.boat__icon { grid-area: icon; color: var(--teal); display: grid; place-items: center; }
.boat--K1 .boat__icon { color: var(--heading); }
.boat__crew { grid-area: crew; display: flex; flex-wrap: wrap; gap: 6px; min-width: 0; }
.seat { border-radius: 999px; min-width: 0; max-width: 100%; }
.seat--empty { display: inline-flex; align-items: center; padding: 4px 12px; border: 1.5px dashed var(--clay); color: var(--clay); font-size: 0.82rem; }
.seat__free { cursor: pointer; }
.boat__score { grid-area: score; display: flex; align-items: center; gap: 8px; }
.boat__beats { font-weight: 700; color: var(--heading); white-space: nowrap; }
.boat__tag { font-size: 0.7rem; padding: 0 7px; border-radius: 999px; border: 1px solid var(--line); color: var(--muted); white-space: nowrap; }
.boat__tag--changed { border-color: var(--clay); color: var(--clay); }
.boat__notes { grid-area: notes; list-style: none; margin: 0; padding: 0; font-size: 0.78rem; }
.boat__notes:empty { display: none; }
.note--warn { color: var(--clay); font-weight: 600; }
.note--warn::before { content: '⚠ '; }
.note--info { color: var(--muted); }
.note--learn { color: var(--teal); font-weight: 600; }
.note--learn::before { content: '★ '; }
.boat--K2 .seat, .boat--C2 .seat { position: relative; }
.boat--K2 .seat:not(.seat--empty)::before, .boat--C2 .seat:not(.seat--empty)::before { content: attr(data-pos); position: absolute; top: -9px; left: 12px; font-size: 0.6rem; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; color: var(--muted); background: var(--surface); padding: 0 3px; line-height: 1; }
.boat__menu { grid-area: menu; display: flex; gap: 2px; }
.iconbtn { width: 26px; height: 26px; border: 0; border-radius: 4px; background: none; color: var(--muted); font-size: 0.85rem; cursor: pointer; opacity: 0.45; }
.boat:hover .iconbtn, .iconbtn:focus-visible { opacity: 1; }
.iconbtn:hover { background: var(--mist); color: var(--heading); }
.link { background: none; border: 0; padding: 0; font: inherit; color: var(--muted); text-decoration: underline; cursor: pointer; }
.link:hover { color: var(--heading); }

.newboats { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 14px; }
.newboat { display: flex; align-items: center; justify-content: center; gap: 10px; padding: 14px; border: 2px dashed var(--line); border-radius: 6px; color: var(--muted); font-weight: 600; cursor: pointer; }

.side { display: grid; gap: 14px; position: sticky; top: 12px; max-height: calc(100vh - 24px); overflow: auto; }
.pool { padding: 12px 14px; background: var(--surface); border: 1.5px solid var(--line); border-radius: 6px; }
.pool h2 { font: 600 1rem var(--font-body); color: var(--heading); margin: 0; }
.pool h2 small { font-weight: 400; color: var(--muted); }
.pool__note { font-size: 0.78rem; color: var(--muted); margin: 2px 0 8px; }
.pool__chips { display: flex; flex-wrap: wrap; gap: 6px; min-height: 30px; }
.pool__others { margin-top: 10px; font-size: 0.84rem; color: var(--muted); }
.pool__others summary { cursor: pointer; margin-bottom: 6px; }
.pool--out { border-style: dashed; }
.rules h2 { margin-bottom: 6px; }
.rules__list { list-style: none; margin: 0 0 8px; padding: 0; font-size: 0.86rem; }
.rules__list li { display: flex; align-items: center; justify-content: space-between; gap: 6px; padding: 3px 0; border-bottom: 1px solid var(--mist); }
.rules__list .iconbtn { opacity: 0.7; }
.rules__add { display: grid; gap: 6px; }
.rules__add select { padding: 6px 8px; border: 1.5px solid var(--line); border-radius: 4px; font: inherit; font-size: 0.86rem; background: var(--surface); color: var(--ink); }
.rules__error { color: var(--clay); font-size: 0.8rem; font-weight: 600; margin: 6px 0 0; }
.rules__familiar { display: flex; gap: 8px; align-items: flex-start; margin-top: 10px; font-size: 0.84rem; cursor: pointer; }
.rules__familiar input { margin-top: 3px; accent-color: var(--heading); }
.rules__replan { width: 100%; margin-top: 10px; }
.pool textarea { width: 100%; margin-top: 6px; resize: vertical; box-sizing: border-box; }

/* drop zones light up while something is being moved */
.zone { transition: background-color 0.12s, border-color 0.12s, box-shadow 0.12s; }
.rp--dragging .zone--ready.newboat, .rp--picking .zone--ready.newboat { border-color: var(--teal); color: var(--teal); }
.rp--picking .zone--ready { cursor: pointer; }
.zone--hot { box-shadow: 0 0 0 3px var(--gold); background: color-mix(in srgb, var(--gold) 14%, var(--surface)); }
.seat.zone--hot { border-radius: 999px; }
.rp--dragging, .rp--dragging * { cursor: grabbing !important; user-select: none; -webkit-user-select: none; }

.rp__picked { position: fixed; left: 50%; bottom: 16px; transform: translateX(-50%); z-index: 50; margin: 0; padding: 10px 16px; border-radius: 999px; background: var(--heading); color: var(--surface); font-size: 0.88rem; box-shadow: 0 6px 18px rgba(0, 0, 0, 0.2); max-width: calc(100vw - 32px); }
.rp__picked .link { color: var(--surface); }
.rp__empty { color: var(--muted); }
.rp__foot { font-size: 0.8rem; color: var(--muted); max-width: 90ch; margin-top: 22px; }

@media (max-width: 860px) {
  .rp { padding: 12px 16px 80px; }
  .rp__cols { grid-template-columns: 1fr; }
  .side { position: static; max-height: none; order: -1; }
  .boat { grid-template-columns: 70px minmax(0, 1fr) auto; grid-template-areas: 'icon crew crew' 'icon score menu' 'notes notes notes'; }
  .boat__icon :deep(svg) { width: 62px; height: auto; }
}
@media print {
  :deep(.site-nav), .rp__bar, .rp__tools .rp__actions, .rp__hint, .side .pool:not(.pool--notes), .newboats, .boat__menu, .boat__tag, .rp__picked { display: none !important; }
  .rp__cols { grid-template-columns: 1fr; }
  .side { position: static; max-height: none; }
  .boat { break-inside: avoid; }
}
</style>
