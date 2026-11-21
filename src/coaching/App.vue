<script setup>
import { reactive, computed, watch, ref, onMounted, provide, watchEffect } from 'vue'
import SiteNav from '../shared/SiteNav.vue'
import SkyBackground from '../shared/SkyBackground.vue'
import GroupColumn from './components/GroupColumn.vue'
import PairLines from './components/PairLines.vue'
import { crews, loadCrews, boardPairs } from './data/crews.js'
import { k2Tree } from './data/k2tree.js'
import { createBoardSync } from './data/board.js'
import { sameRacer } from '../../netlify/functions/lib/match.js'
import { personKey } from '../../netlify/functions/lib/crewfit.js'
import LoadingRiver from '../shared/LoadingRiver.vue'
import { useLoadingPreview } from '../shared/loadingPreview.js'
const preview = useLoadingPreview() // ?loading: show the loading animation
import { buildSeed, CLUB_CODE } from './data/paddlers.js'

const STORAGE_KEY = 'bscc-coaching-app-v3'
const OLD_TOKEN_KEY = 'bscc-coach-token' // the access code older versions asked for: no longer used
// Step-by-step server logs (which include member names) only when developing locally,
// or when switched on in this browser: localStorage.setItem('bscc-debug', '1')
const DEBUG = import.meta.env.DEV || (() => { try { return localStorage.getItem('bscc-debug') === '1' } catch { return false } })()

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return { ...buildSeed(), ...JSON.parse(raw) }
  } catch {}
  return buildSeed()
}

// state holds: the last MemberMojo list (directory), our own choices about it
// (roles, divisions, groups). There is no locally maintained list of people.
const state = reactive(load())
// earlier versions saved each member's sex; it is no longer used or kept
state.directory.forEach(m => { delete m.sex })
// view options for the unassigned paddlers column (saved with the rest of the state)
state.options = { sortByDiv: true, sortByLastRace: false, hideUnranked: false, hideRanked: false, onlyGS: false, showPairs: true, showPhotos: true, ...(state.options || {}) }
// Photos are on by default. Browsers that saved "off" under the earlier default get switched
// on once; after that the coach's own choice sticks. (On the live site photos come from the
// uploaded copy; only local `netlify dev` signs in to MemberMojo for them.)
if (!state.options.photosOnByDefault) {
  state.options.showPhotos = true
  state.options.photosOnByDefault = true
}
// Simple view (each person a round photo with their division and coach tags) is the
// default; browsers that saved options before it existed get it switched on once.
if (!state.options.simpleOnByDefault) {
  state.options.simpleView = true
  state.options.simpleOnByDefault = true
}
// Paddler cards read these: whether to fetch photos, and which way to draw themselves.
provide('showPhotos', computed(() => !!state.options.showPhotos))
// star awards (coaches can read the assessment record): the highest award by member id and by name
const starById = ref(new Map())
const starByName = ref(new Map())
provide('starLevel', person => starById.value.get(String(person.id)) || starByName.value.get(personKey(person.fullName || person.name)) || 0)
async function loadStars() {
  try {
    const res = await fetch('/api/awards', { credentials: 'same-origin' })
    if (!res.ok) return
    const byId = new Map(), byName = new Map()
    for (const r of (await res.json()).records || []) {
      if (r.memberId) byId.set(String(r.memberId), Math.max(r.award, byId.get(String(r.memberId)) || 0))
      const k = personKey(r.paddler)
      byName.set(k, Math.max(r.award, byName.get(k) || 0))
    }
    starById.value = byId
    starByName.value = byName
  } catch { /* no stars shown */ }
}
provide('simpleView', computed(() => !!state.options.simpleView))

// colour scheme: '' = club colours (as on the Star Awards page)
const THEMES = [
  { id: '', label: 'Club colours' },
  { id: 'navy', label: 'Navy & gold' },
  { id: 'river', label: 'Riverbank' },
  { id: 'night', label: 'Night (dark)' },
  { id: 'contrast', label: 'High contrast' },
]
if (!THEMES.some(t => t.id === state.options.theme)) state.options.theme = ''
watchEffect(() => {
  if (typeof document === 'undefined') return
  if (state.options.theme) document.documentElement.dataset.theme = state.options.theme
  else delete document.documentElement.dataset.theme
})

watch(state, () => {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)) } catch {}
}, { deep: true })

// ---- roster, derived from MemberMojo -----------------------------------------------
// Coaches are whoever has a "Coach" membership in MemberMojo (m.coach from the sync).
// Members with a "Volunteer" membership start hidden; restoring one gives them a manual
// role, which then wins. Hiding someone always wins. Without membership data (older
// sync), manual roles apply.
const roleOf = m => {
  const manual = state.roles[m.id]
  if (manual === 'hidden') return 'hidden'
  if (m.coach === true) return 'coach'
  if (manual === undefined && m.volunteer === true) return 'hidden'
  if (m.coach === false && manual === 'coach') return 'paddler'
  return manual ?? m.role ?? 'unclassified'
}
const everyone = computed(() =>
  state.directory.map(m => ({
    id: m.id, name: m.name, fullName: m.name, url: m.url, photo: m.photo || '',
    junior: !!m.junior,
    role: roleOf(m),
    ...(state.divisions[m.id] || {})
  }))
)
const onBoard = computed(() => everyone.value.filter(p => p.role === 'paddler' || p.role === 'coach'))
const toSort = computed(() => everyone.value.filter(p => p.role === 'unclassified'))
const hidden = computed(() => everyone.value.filter(p => p.role === 'hidden'))

// ---- board -----------------------------------------------------------------------
const assignedIds = computed(() => new Set(state.groups.flatMap(g => g.memberIds)))

// Division order: numbered divisions first, div1 (fastest) down to div9, then other codes
// such as Geoff Sanders (GSA, GSB...) alphabetically, then paddlers with no division.
// Same division -> alphabetical by name. Puts the active racers at the top.
const divRank = d => {
  const v = String(d || '').trim().toUpperCase()
  if (!v) return [2, 0, '']
  return /^\d+$/.test(v) ? [0, Number(v), ''] : [1, 0, v]
}
// Most recent racers first (lastRaced is YYYY-MM-DD, so text order is date order);
// people with no race found go to the bottom; same day -> alphabetical.
const byLastRace = (a, b) => {
  const x = a.lastRaced || '', y = b.lastRaced || ''
  if (x !== y) return x ? (y ? y.localeCompare(x) : -1) : 1
  return a.name.localeCompare(b.name)
}
// the two orderings exclude each other: ticking one unticks the other
function setOrder(which, on) {
  state.options[which] = on
  if (on) state.options[which === 'sortByDiv' ? 'sortByLastRace' : 'sortByDiv'] = false
}
const byDivision = (a, b) => {
  const [x, y] = [divRank(a.division), divRank(b.division)]
  return x[0] - y[0] || x[1] - y[1] || x[2].localeCompare(y[2]) || a.name.localeCompare(b.name)
}
const isUnranked = p => !String(p.division || '').trim()
// coaches and paddlers share one unassigned pool
const allUnassignedPaddlers = computed(() => onBoard.value.filter(p => !assignedIds.value.has(p.id)))
const unrankedUnassigned = computed(() => allUnassignedPaddlers.value.filter(isUnranked).length)
const rankedUnassigned = computed(() => allUnassignedPaddlers.value.length - unrankedUnassigned.value)
// Geoff Sanders divisions (GSA, GSB, GSC...): the children's races
const isGS = p => /^GS/i.test(String(p.division || '').trim())
const gsUnassigned = computed(() => allUnassignedPaddlers.value.filter(isGS).length)
// The three filters contradict each other, so ticking one unticks the others
const PADDLER_FILTERS = ['hideUnranked', 'hideRanked', 'onlyGS']
function setHide(which, on) {
  if (on) PADDLER_FILTERS.forEach(k => { state.options[k] = false })
  state.options[which] = on
}
// ---- live name filter: narrows every card on the board as you type ------------------
// Matches any part of the name, ignoring case and accents; every word typed must match,
// so "jaq cay" finds Jaq Cayford. Not saved or shared.
const nameQuery = ref('')
const fold = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
const queryWords = computed(() => fold(nameQuery.value).split(/\s+/).filter(Boolean))
const matchesQuery = p => {
  if (!queryWords.value.length) return true
  const name = fold(p.fullName || p.name)
  return queryWords.value.every(w => name.includes(w))
}
const filterEmptyText = computed(() => (queryWords.value.length ? `No matches for "${nameQuery.value.trim()}"` : undefined))

const unassignedPaddlers = computed(() => {
  let list = allUnassignedPaddlers.value
  if (state.options.hideUnranked) list = list.filter(p => !isUnranked(p))
  if (state.options.hideRanked) list = list.filter(isUnranked)
  if (state.options.onlyGS) list = list.filter(isGS)
  list = list.filter(matchesQuery)
  if (state.options.sortByLastRace) return [...list].sort(byLastRace)
  return state.options.sortByDiv ? [...list].sort(byDivision) : list
})
const paddlerPoolEmptyText = computed(() =>
  state.options.hideUnranked && unrankedUnassigned.value
    ? `Only unranked paddlers left (${unrankedUnassigned.value} hidden)`
    : state.options.hideRanked && rankedUnassigned.value
      ? `Only ranked paddlers left (${rankedUnassigned.value} hidden)`
      : state.options.onlyGS && allUnassignedPaddlers.value.length
        ? 'No GS paddlers here'
        : 'Everyone is in a group'
)
const byId = id => onBoard.value.find(p => p.id === id)
// coaches first inside a group, then paddlers
const membersOf = g =>
  g.memberIds.map(byId).filter(Boolean).filter(matchesQuery)
    .sort((a, b) => (a.role === b.role ? 0 : a.role === 'coach' ? -1 : 1))

// Moving someone always removes them from every group first, so a person is never
// in two groups and "unassigned" really means no group at all. Ids compared as strings.
// ---- shared board: every change is applied here and sent to the server ----------------
const boardStatus = ref({ state: 'idle' })
const board = createBoardSync(state, boardStatus)

function moveLocal(groupId, pid) {
  state.groups.forEach(g => { g.memberIds = g.memberIds.filter(id => String(id) !== pid) })
  if (groupId) state.groups.find(g => g.id === groupId)?.memberIds.push(pid)
}
function moveTo(groupId, personId) {
  const pid = String(personId)
  moveLocal(groupId, pid)
  board.send({ type: 'move', personId: pid, groupId: groupId || null })
}
const unassign = p => moveTo(null, p.id)
// set manual roles for one or many people ({ id: role | null }), locally and on the server
function setRoles(roles) {
  for (const [id, role] of Object.entries(roles)) {
    if (role === null) delete state.roles[id]
    else state.roles[id] = role
    if (role === 'hidden') moveLocal(null, String(id)) // the server does the same
  }
  board.send({ type: 'setRoles', roles })
}
// Hiding someone from the board also removes them from any group, so restoring them
// later brings them back unassigned rather than into their old group.
function hidePerson(p) {
  setRoles({ [p.id]: 'hidden' })
}

// Tidy group lists saved by earlier versions: string ids, no duplicates, nobody in two
// groups, and nobody hidden (earlier versions kept hidden people linked to their group).
{
  const seen = new Set()
  state.groups.forEach(g => {
    g.memberIds = g.memberIds
      .map(String)
      .filter(id => state.roles[id] !== 'hidden' && !seen.has(id) && seen.add(id))
  })
}
function addGroup() {
  const id = 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  state.groups.push({ id, name: 'New group', memberIds: [] })
  board.send({ type: 'addGroup', id, name: 'New group' })
}
function removeGroup(g) {
  state.groups = state.groups.filter(x => x.id !== g.id)
  board.send({ type: 'removeGroup', id: g.id })
}
function renameGroup(g, name) {
  g.name = name
  board.send({ type: 'renameGroup', id: g.id, name })
}
function editDivision(p) {
  const v = prompt(`Division for ${p.name} (e.g. 9 or GSB). It is overwritten by the marathon results lookup when one is found:`, p.division)
  if (v === null) return
  state.divisions[p.id] = { ...(state.divisions[p.id] || {}), division: v.trim().replace(/^div\s*/i, '').toUpperCase() }
}

// ---- K2 pairs: everyone who has raced a K2 together ---------------------------------
// From all the results (data/crews.js; the first load ever takes a few minutes). Until
// that has loaded, partners from each person's most recent race stand in.
const boardArea = ref(null)
const allTimePairs = computed(() => (crews.data ? boardPairs(onBoard.value, crews.data.pairs) : null))
const k2Pairs = computed(() => {
  if (!state.options.showPairs) return []
  if (allTimePairs.value) return allTimePairs.value
  const people = onBoard.value
  const seen = new Set(), out = []
  for (const p of people) {
    const partners = p.partners || []
    if (partners.length !== 1) continue // K1, or a bigger crew: no line
    const mate = people.find(q => q.id !== p.id && sameRacer(q.fullName, partners[0]))
    if (!mate) continue // partner not on the board (another club, hidden, not a member)
    const key = [p.id, mate.id].sort().join('|')
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ a: p.id, b: mate.id, races: 1, last: p.lastRaced || '' })
  }
  return out
})
const boardNames = computed(() => Object.fromEntries(onBoard.value.map(p => [p.id, p.name])))
// with K2 pairs on, Active paddlers are laid out as a family tree of K2 partnerships
const stripRows = computed(() =>
  state.options.showPairs && allTimePairs.value?.length ? k2Tree(unassignedPaddlers.value, allTimePairs.value) : null)
watch(() => state.options.showPairs, on => { if (on && divReady) loadCrews(CLUB_CODE) })

// ---- sorting MemberMojo members into paddler / coach / hidden ----------------------
const search = ref('')
const toSortShown = computed(() => {
  const q = search.value.trim().toLowerCase()
  return toSort.value.filter(m => !q || m.name.toLowerCase().includes(q)).slice(0, 50)
})
const classify = (p, role) => setRoles({ [p.id]: role })
// Restoring a volunteer needs an explicit role, or the volunteer rule would hide them again
const restore = p => {
  const m = state.directory.find(x => x.id === p.id)
  setRoles({ [p.id]: m?.volunteer ? 'unclassified' : null })
}
function allUnsortedAsPaddlers() {
  if (!confirm(`Put all ${toSort.value.length} unsorted members on the board as paddlers? You can change or hide any of them later.`)) return
  setRoles(Object.fromEntries(toSort.value.map(p => [p.id, 'paddler'])))
}
function hideAllUnsorted() {
  if (!confirm(`Hide all ${toSort.value.length} unsorted members from the board? You can restore any of them later.`)) return
  setRoles(Object.fromEntries(toSort.value.map(p => [p.id, 'hidden'])))
}

// ---- MemberMojo sync ---------------------------------------------------------------
const memberSync = ref({ state: 'idle', when: '', message: '' })

// The member list is only served to coaches signed in as a coach (the
// browser sends the sign-in cookie with the request; see netlify/edge-functions).
async function syncMembers() {
  try { localStorage.removeItem(OLD_TOKEN_KEY) } catch {}
  memberSync.value = { state: 'loading', when: '', message: '' }
  try {
    // ?trace=1 returns the server's step-by-step log; it is printed to the browser console below
    const res = await fetch('/api/members' + (DEBUG ? '?trace=1' : ''), { credentials: 'same-origin' })
    if (res.status === 401) {
      memberSync.value = { state: 'denied', when: '', message: '' }
      return
    }
    const data = await res.json().catch(() => null)
    if (data?.trace) console.table(data.trace)
    console.log('[members] HTTP', res.status, 'count:', data?.count, 'error:', data?.error)
    if (!res.ok) throw new Error(data?.error ? `${data.error}${data.step ? ' [' + data.step + ']' : ''}` : 'HTTP ' + res.status)
    if (!Array.isArray(data?.members)) {
      throw new Error('Unexpected response from /api/members. Run the app with "npx netlify dev" (not "npm run dev") and open the URL it prints.')
    }
    // MemberMojo is the source of truth: replace the roster with what it says now
    state.directory = data.members.map(({ id, name, url, photo, role, junior, coach, volunteer }) => ({ id, name, url, photo, role, junior, coach, volunteer }))
    memberSync.value = { state: 'ok', when: new Date(data.fetchedAt).toLocaleString(), message: '', source: data.source }
    await board.load() // the shared groups and roles
  } catch (e) {
    memberSync.value = { state: 'error', when: '', message: e.message }
  }
}
// Sign out: forget the Google sign-in and the member details this browser holds (names,
// under-18 flags, photos, divisions). Group assignments, roles and settings are kept;
// they are only member id numbers, and they come back to life after signing in again.
function signOut() {
  if (!confirm('Sign out on this browser? This signs you out and removes the member list, photos and divisions stored here. The shared groups are not affected.')) return
  try {
    const keep = { groups: state.groups, roles: state.roles, options: state.options }
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...keep, directory: [], divisions: {} }))
  } catch {}
  location.href = '/paddlers/?leave' // also forget the Google sign-in (see netlify/edge-functions)
}

// ---- Hasler division lookup (every page load) ----------------------------------------
const divLookup = ref({ state: 'idle', when: '', missing: 0 })
async function refreshDivisions() {
  const paddlers = onBoard.value // coaches race too, so everyone on the board is looked up
  if (!paddlers.length) return
  divLookup.value = { state: 'loading', when: '', missing: 0 }
  try {
    // trace=1: the function also returns a per-paddler report (and logs to the netlify dev terminal)
    console.log(`[divisions] looking up ${paddlers.length} paddler(s) in club ${CLUB_CODE}`)
    // The server looks back several seasons. The first time, that is ~200 race pages, more
    // than one call can do, so it answers { more: true } and we call again; each call
    // carries on from the races it has already indexed. Later lookups finish in one call.
    let data = null, rounds = 0
    do {
      // names go in the request body, not the URL, so they don't end up in logs or caches
      const res = await fetch('/api/divisions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ club: CLUB_CODE, names: paddlers.map(p => p.fullName), trace: DEBUG })
      })
      data = await res.json().catch(() => null)
      if (data?.trace) {
        console.groupCollapsed(`[divisions] server trace, call ${rounds + 1} (${data.trace.length} steps)`)
        console.table(data.trace)
        console.groupEnd()
      }
      if (!res.ok) throw new Error(data?.detail || 'HTTP ' + res.status)
      if (!data?.results) throw new Error('Unexpected response')
      divLookup.value = { state: 'loading', when: '', missing: 0, progress: data.more ? `${data.racesChecked} of ${data.racesTotal} races` : '' }
    } while (data.more && ++rounds < 25)
    if (data.report) {
      console.log(`[divisions] ${data.racesChecked} of ${data.racesTotal} races (${data.seasons} seasons) checked in ${rounds + 1} call(s); found ${data.report.filter(r => r.found).length} of ${data.report.length}`)
      console.table(data.report.map(r => ({
        paddler: r.paddler,
        found: r.found,
        division: r.division ?? '',
        matchedAs: r.matchedAs ?? '',
        race: r.race ? `${r.race} (${r.date || '?'})` : '',
        why: r.why ?? '',
        nearMisses: (r.nearMisses || []).join(' | ')
      })))
    }
    lookedUp = new Set(paddlers.map(p => p.fullName))
    let missing = 0
    const missingNames = [] // shown when hovering the "not found" count
    for (const p of paddlers) {
      const r = data.results[p.fullName]
      if (!r) { missing++; missingNames.push(p.name); continue }
      state.divisions[p.id] = {
        division: r.division,
        demotionOffered: r.demotionOffered,
        divisionSource: r.divisionRace ? `${r.divisionRace}${r.divisionDate ? ' (' + r.divisionDate + ')' : ''}` : `${r.race}${r.date ? ' (' + r.date + ')' : ''}`,
        lastRaced: r.date || '', // YYYY-MM-DD of the most recent result found
        lastRace: r.race || '',
        lastRaceUrl: r.raceUrl || '',
        lastRaceVenue: r.venue || '', // host club code, e.g. LBZ
        lastRacePlace: r.place || null, // 1st/2nd/3rd get a gold/silver/bronze star
        partners: r.partners || [] // crew mates in that race (K2 partner), as named in the results
      }
    }
    missingNames.sort((a, b) => a.localeCompare(b))
    divLookup.value = { state: 'ok', when: new Date(data.fetchedAt).toLocaleString(), missing, missingNames, seasons: data.seasons }
  } catch (e) {
    console.error('[divisions] lookup failed:', e.message)
    divLookup.value = { state: 'error', when: '', missing: 0 }
  }
}

// Look up paddlers added after page load (e.g. sorted from "Members to sort") too,
// not just the ones on the board when the page opened.
let lookedUp = new Set()
let divReady = false // set once the page-load lookup has run
let divTimer = null
watch(
  () => onBoard.value.map(p => p.fullName),
  names => {
    if (!divReady || divLookup.value.state === 'loading') return // the first lookup runs from onMounted
    const added = names.filter(n => !lookedUp.has(n))
    if (!added.length) return
    console.log('[divisions] new paddler(s), looking up again:', added.join(', '))
    clearTimeout(divTimer)
    divTimer = setTimeout(refreshDivisions, 800)
  }
)

onMounted(async () => {
  loadStars() // (alongside: it doesn't hold the board up)
  // first: names come from MemberMojo, and the division lookup matches on them
  await syncMembers() // also loads the shared groups and roles
  await refreshDivisions()
  divReady = true
  // all-time K2 partners for the lines and the family tree
  if (state.options.showPairs) loadCrews(CLUB_CODE)
})
</script>

<template>
  <SkyBackground />
  <SiteNav current="/paddlers/" />
  <header class="top">
    <h1>Paddler detail</h1>
    <div class="top__actions">
      <span class="board-status" :class="'board-status--' + boardStatus.state">
        <template v-if="boardStatus.state === 'saved'">Groups shared · saved</template>
        <template v-else-if="boardStatus.state === 'saving'">Groups shared · saving…</template>
        <template v-else-if="boardStatus.state === 'offline'">Groups not saved · retrying</template>
        <template v-else-if="boardStatus.state === 'denied'">Groups not shared (signed out)</template>
      </span>
      <label class="opt" title="Each person as a round photo with their division (and coach tag); hover for the name">
        <input type="checkbox" v-model="state.options.simpleView" /> Simple view
      </label>
      <label class="opt" title="Loads member photos from MemberMojo (uses a MemberMojo sign-in)">
        <input type="checkbox" v-model="state.options.showPhotos" /> Show photos
      </label>
      <label class="opt" title="Lines join everyone who has raced a K2 together (all results since 2010; the number is how many races), and Active paddlers are laid out as a family tree of K2 partners">
        <input type="checkbox" v-model="state.options.showPairs" /> Show K2 pairs<span v-if="state.options.showPairs && crews.state === 'loading'" class="opt__note"> (reading results{{ crews.progress ? ': ' + crews.progress : '' }}…)</span>
      </label>
      <label class="opt" title="Colour scheme for this page (saved with the board options)">
        Colours
        <select v-model="state.options.theme" class="theme-select">
          <option v-for="t in THEMES" :key="t.id" :value="t.id">{{ t.label }}</option>
        </select>
      </label>
      <button class="btn" @click="addGroup">Add group</button>
      <button class="btn btn-quiet" title="Sign out, and forget the member list on this browser" @click="signOut">Sign out</button>
    </div>
  </header>
  <div v-if="preview.on" class="pairs-loading">
    <LoadingRiver :progress="preview.progress" :working="preview.working"
      :message="preview.working ? 'K2 pairs: working out the ratings… (preview)' : 'K2 pairs: reading every race since 2010… (preview)'" />
  </div>
  <div v-if="state.options.showPairs && crews.state === 'loading'" class="pairs-loading">
    <LoadingRiver :progress="crews.total ? crews.read / crews.total : null" :working="crews.working"
      :message="crews.working ? 'K2 pairs: working out the ratings…' : 'K2 pairs: reading every race since 2010 (only the first time)…'" />
  </div>


  <p v-if="!state.directory.length" class="status status--empty">
    The paddler and coach lists come from MemberMojo. Connect above to load them.
  </p>


  <!-- everything the K2 pair lines can join sits inside this area -->
  <div ref="boardArea" class="board-area">
  <PairLines v-if="state.options.showPairs" :pairs="k2Pairs" :container="boardArea" :names="boardNames" />
  <!-- unassigned coaches and paddlers together, across the page above the groups -->
  <section class="strip">
    <GroupColumn
      title="Active paddlers"
      :people="unassignedPaddlers"
      :rows="stripRows"
      :empty-text="filterEmptyText || paddlerPoolEmptyText"
      is-pool
      horizontal
      @drop-paddler="moveTo(null, $event)"
      @edit-division="editDivision"
      @remove-person="p => classify(p, 'hidden')"
    >
      <template #tools>
        <label class="opt"><input type="checkbox" :checked="state.options.sortByDiv" @change="setOrder('sortByDiv', $event.target.checked)" /> Order by division</label>
        <label class="opt" title="Most recent racers first; people with no race found at the end">
          <input type="checkbox" :checked="state.options.sortByLastRace" @change="setOrder('sortByLastRace', $event.target.checked)" /> Order by last race
        </label>
        <label class="opt">
          <input type="checkbox" :checked="state.options.hideUnranked" @change="setHide('hideUnranked', $event.target.checked)" />
          Hide unranked<span v-if="unrankedUnassigned"> ({{ unrankedUnassigned }})</span>
        </label>
        <label class="opt">
          <input type="checkbox" :checked="state.options.hideRanked" @change="setHide('hideRanked', $event.target.checked)" />
          Hide ranked<span v-if="rankedUnassigned"> ({{ rankedUnassigned }})</span>
        </label>
        <label class="opt" title="Only Geoff Sanders paddlers (GSA, GSB, GSC...): the children's divisions">
          <input type="checkbox" :checked="state.options.onlyGS" @change="setHide('onlyGS', $event.target.checked)" />
          Only GS (children)<span v-if="gsUnassigned"> ({{ gsUnassigned }})</span>
        </label>
        <!-- name filter: its own line under the tick boxes; filters the strip and every group -->
        <div class="search">
          <input
            v-model="nameQuery"
            type="search"
            class="search__input"
            placeholder="Filter by name…"
            aria-label="Filter the board by name"
            @keydown.esc="nameQuery = ''"
          />
          <button v-if="nameQuery" class="search__clear" title="Clear (Esc)" @click="nameQuery = ''">×</button>
        </div>
      </template>
    </GroupColumn>
  </section>

  <main class="board">
    <GroupColumn
      v-for="g in state.groups"
      :key="g.id"
      :title="g.name"
      :people="membersOf(g)"
      :empty-text="filterEmptyText"
      @drop-paddler="moveTo(g.id, $event)"
      @rename="renameGroup(g, $event)"
      @remove-group="removeGroup(g)"
      @edit-division="editDivision"
      @remove-person="unassign"
      remove-title="Remove from group"
    />
  </main>
  </div>

  <!-- below the board: a link to the K1 / K2 race planner, members still to sort, then the division check and MemberMojo status -->
  <a class="planner-link" href="/race-planner/">
    <strong>K1 / K2 race planner</strong>
    <span>Suggested K1s and K2 crews for a race, from everyone's results; the race coordinator can drag paddlers around to tweak it.</span>
  </a>

  <details v-if="toSort.length || hidden.length" class="incoming" :open="toSort.length > 0">
    <summary>
      Members to sort ({{ toSort.length }})
      <span v-if="hidden.length"> · {{ hidden.length }} hidden</span>
    </summary>
    <template v-if="toSort.length">
      <div class="incoming__tools">
        <input v-model="search" placeholder="Search by name" />
        <button class="btn btn-quiet" @click="allUnsortedAsPaddlers">All unsorted → paddlers</button>
        <button class="btn btn-quiet" @click="hideAllUnsorted">Hide all unsorted</button>
      </div>
      <ul>
        <li v-for="m in toSortShown" :key="m.id">
          <a :href="m.url" target="_blank" rel="noopener">{{ m.name }}</a>
          <span class="incoming__actions">
            <button class="btn btn-quiet" @click="classify(m, 'paddler')">Paddler</button>
            <button class="btn btn-quiet" @click="classify(m, 'hidden')">Hide</button>
          </span>
        </li>
      </ul>
      <p v-if="toSort.length > toSortShown.length" class="more">Showing the first {{ toSortShown.length }}; search to narrow.</p>
    </template>
    <details v-if="hidden.length" class="hidden-list">
      <summary>Hidden ({{ hidden.length }})</summary>
      <ul>
        <li v-for="m in hidden" :key="m.id">
          <span>{{ m.name }}</span>
          <button class="btn btn-quiet" @click="restore(m)">Restore</button>
        </li>
      </ul>
    </details>
  </details>

  <p class="status" :class="'status--' + divLookup.state">
    <template v-if="divLookup.state === 'loading'">
      Checking the marathon results for current divisions…<span v-if="divLookup.progress"> ({{ divLookup.progress }}; the first check reads older seasons and takes a minute)</span>
    </template>
    <template v-else-if="divLookup.state === 'ok'">
      Divisions from the marathon results (checked {{ divLookup.when }}).
      <button class="link" @click="refreshDivisions()">Check again</button>
      <span v-if="divLookup.missing" class="missing" tabindex="0">
        {{ divLookup.missing }} not found in the last {{ divLookup.seasons || 1 }} season(s) of results.
        <!-- hover (or focus) the count for the names -->
        <span class="missing__list" role="tooltip">
          <strong>Not found in the results</strong>
          <span v-for="n in divLookup.missingNames || []" :key="n">{{ n }}</span>
        </span>
      </span>
    </template>
    <template v-else-if="divLookup.state === 'error'">Division lookup unavailable, showing saved values.</template>
  </p>

  <p class="status status--last" :class="'status--' + memberSync.state">
    <template v-if="memberSync.state === 'loading'">Reading members from MemberMojo…</template>
    <template v-else-if="memberSync.state === 'ok'">
      MemberMojo {{ memberSync.source === 'upload' ? 'list' : 'synced' }} ({{ state.directory.length }} members, {{ memberSync.source === 'upload' ? 'uploaded ' : '' }}{{ memberSync.when }}).
      <!-- on the live site the list is a copy uploaded from a computer by `npm run sync-members`
           (MemberMojo blocks Netlify's servers), so reloading here only re-reads that copy -->
      <template v-if="memberSync.source === 'upload'">
        <button class="link" @click="syncMembers()">Reload</button>
        <span class="status__hint"> · to update it from MemberMojo, run <code>npm run sync-members</code> on your computer</span>
      </template>
      <button v-else class="link" @click="syncMembers()">Sync now</button>
    </template>
    <template v-else-if="memberSync.state === 'error'">
      MemberMojo sync failed: {{ memberSync.message }}.
      <button class="link" @click="syncMembers()">Retry</button>
    </template>
    <template v-else-if="memberSync.state === 'denied'">
      Your sign-in has expired.
      <a class="link" href="/paddlers/">Sign in again</a>
    </template>
    <template v-else>
      MemberMojo not connected.
      <button class="link" @click="syncMembers()">Connect</button>
    </template>
    <template v-if="['ok', 'error', 'denied'].includes(memberSync.state)">
      · <button class="link" @click="signOut">Sign out</button>
    </template>
  </p>
</template>

<style scoped>
.top {
  display: flex;
  flex-wrap: wrap; /* a narrower window: the options drop under the title instead of pushing the page wider */
  align-items: center;
  justify-content: space-between;
  gap: 10px 16px;
  padding: 24px 28px 8px;
}
.top h1 { font-size: clamp(2rem, 4vw, 3rem); color: var(--heading); }
.search { position: relative; flex: 0 0 100%; max-width: 360px; margin-top: 4px; }
.search__input {
  width: 100%;
  padding: 7px 30px 7px 12px;
  border: 1.5px solid var(--teal);
  border-radius: 999px;
  font: inherit;
  font-size: 0.95rem;
  background: var(--surface);
}
.search__input:focus { outline: 2px solid var(--heading); outline-offset: 1px; }
.search__input::-webkit-search-cancel-button { display: none; }
.search__clear {
  position: absolute;
  right: 8px;
  top: 50%;
  transform: translateY(-50%);
  border: none;
  background: none;
  font-size: 1.2rem;
  line-height: 1;
  color: var(--heading);
  cursor: pointer;
}
.board-status { font-size: 0.8rem; color: var(--muted); }
.board-status--offline, .board-status--denied { color: var(--clay); font-weight: 600; }
.top__actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px; font-size: 0.9rem; color: var(--heading); }
.status { margin: 0; padding: 0 28px 6px; font-size: 0.85rem; color: var(--heading); }
.status--error, .status--denied { color: var(--clay); }
.status--empty { padding-top: 10px; font-weight: 600; }
.status--last { padding-bottom: 40px; } /* room at the foot of the page */
.status__hint { color: var(--muted); }
/* "N not found…": dotted underline, names listed on hover */
.missing { position: relative; text-decoration: underline dotted; text-underline-offset: 3px; cursor: help; }
.missing__list {
  position: absolute;
  bottom: calc(100% + 6px); /* opens upwards: this line is near the foot of the page */
  left: 0;
  z-index: 50;
  display: none;
  flex-direction: column;
  min-width: 200px;
  max-height: 60vh;
  overflow-y: auto;
  padding: 8px 12px;
  border-radius: 6px;
  background: var(--teal-deep);
  color: var(--white);
  font-size: 0.82rem;
  line-height: 1.5;
  white-space: nowrap;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
}
.missing__list strong { font-weight: 600; margin-bottom: 2px; opacity: 0.85; }
.missing:hover .missing__list, .missing:focus .missing__list, .missing:focus-within .missing__list { display: flex; }
.status__hint code { font-size: 0.8rem; }
.link {
  border: none;
  background: none;
  padding: 0;
  color: var(--clay);
  font-weight: 600;
  text-decoration: underline;
  cursor: pointer;
}
.pairs-loading { margin: 0 28px; max-width: 760px; }
.planner-link { display: grid; gap: 2px; margin: 4px 28px 14px; padding: 12px 16px; background: var(--surface); border: 1.5px solid var(--teal); border-left-width: 5px; border-radius: 4px; color: var(--ink); text-decoration: none; }
.planner-link strong { color: var(--heading); }
.planner-link strong::after { content: ' →'; }
.planner-link span { font-size: 0.86rem; color: var(--muted); }
.planner-link:hover { border-color: var(--clay); }
.incoming { margin: 4px 28px 14px; padding: 10px 14px; background: var(--surface); border: 1.5px solid var(--teal); border-radius: 4px; }
.incoming > summary { font-weight: 600; cursor: pointer; }
.incoming__tools { display: flex; gap: 10px; margin: 10px 0; }
.incoming__tools input { padding: 6px 10px; border: 1.5px solid var(--teal); min-width: 220px; }
.incoming ul { list-style: none; margin: 0; padding: 0; max-height: 280px; overflow: auto; }
.incoming li { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 5px 0; border-top: 1px solid var(--mist); }
.incoming__actions { display: flex; gap: 6px; }
.incoming .btn { padding: 0.3em 0.8em; font-size: 0.82rem; }
.hidden-list { margin-top: 10px; }
.hidden-list > summary { cursor: pointer; font-size: 0.9rem; }
.more { font-size: 0.82rem; color: var(--muted); margin: 8px 0 0; }
.opt { display: inline-flex; align-items: center; gap: 5px; cursor: pointer; white-space: nowrap; }
.opt input { accent-color: var(--heading); margin: 0; }
.board-area { position: relative; }
.strip { padding: 16px 28px 0; }
.board {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 18px;
  padding: 24px 28px 20px;
  align-items: start;
}

/* phones: tighter margins and smaller headings */
@media (max-width: 640px) {
  .top { padding: 14px 12px 6px; flex-wrap: wrap; gap: 8px; }
  .top h1 { font-size: 1.6rem; }
  .search { max-width: none; }
  .top__actions { gap: 10px; font-size: 0.82rem; }
  .status { padding: 0 12px 6px; font-size: 0.78rem; }
  .incoming, .planner-link { margin: 8px 12px; }
  .strip { padding: 10px 12px 0; }
  .board { grid-template-columns: 1fr; gap: 12px; padding: 14px 12px 40px; }
}
.theme-select {
  font: inherit; font-size: 0.85rem; padding: 0.2em 0.4em; margin-left: 4px;
  border: 1.5px solid var(--line); border-radius: 3px;
  background: var(--surface); color: var(--ink);
}
.opt__note { font-size: 0.78rem; color: var(--muted); }
</style>
