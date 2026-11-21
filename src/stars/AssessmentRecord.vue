<script setup>
// The assessment record: the club's assessment book (date, paddler, assessor, award), kept on the
// site. Coaches add a row when someone is assessed; the "By paddler" view shows the highest award each
// has, so moving up a star is just another row. Data: netlify/functions/awards.js (coaches only).
import { ref, computed, onMounted, watch } from 'vue'

const AWARD_LABEL = { 1: '1 Star', 2: '2 Star', 3: '3 Star' }
const stars = n => '★'.repeat(n)
const uk = iso => (iso ? iso.split('-').reverse().join('/') : '')
const store = {
  get(k) { try { return localStorage.getItem(k) } catch { return null } },
  set(k, v) { try { localStorage.setItem(k, v) } catch { /* not remembered: that's all */ } }
}

const records = ref([])
const state = ref('loading') // loading, ok, denied, error
const error = ref('')
const busy = ref(false)
const view = ref('record') // record, paddlers
const filter = ref('')
const today = () => new Date().toLocaleDateString('en-CA') // yyyy-mm-dd, local
const form = ref({ date: today(), paddler: '', memberId: '', assessor: store.get('bscc-assessor') || '', award: 1 })
const editing = ref(null) // a copy of the row being edited

async function call(method, body, query = '') {
  busy.value = true
  error.value = ''
  try {
    const res = await fetch('/api/awards' + query, {
      method, credentials: 'same-origin',
      headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined
    })
    if (res.status === 401) { state.value = 'denied'; return false }
    const data = await res.json().catch(() => ({}))
    if (!res.ok) { error.value = data.error || 'Something went wrong: try again'; return false }
    records.value = data.records
    state.value = 'ok'
    return true
  } catch {
    error.value = 'Could not reach the site: try again'
    return false
  } finally {
    busy.value = false
  }
}
onMounted(async () => { if (!(await call('GET')) && state.value === 'loading') state.value = 'error' })

// names to suggest as you type: the MemberMojo member list (asked for once, the first time you click a name box)
const members = ref([])
let membersAsked = false
async function loadMembers() {
  if (membersAsked) return
  membersAsked = true
  try {
    const res = await fetch('/api/members', { credentials: 'same-origin' })
    const data = await res.json()
    if (Array.isArray(data.members)) members.value = data.members.map(m => ({ id: String(m.id), name: m.name, coach: m.coach === true }))
  } catch { /* typing the name works without suggestions */ }
}
const coaches = computed(() => members.value.filter(m => m.coach))
// a name that matches a member exactly is linked to them (so a later name change doesn't lose the record)
watch(() => form.value.paddler, v => {
  const m = members.value.find(x => x.name.toLowerCase() === v.trim().toLowerCase())
  form.value.memberId = m ? m.id : ''
})

async function add() {
  const f = form.value
  if (await call('POST', { date: f.date, paddler: f.paddler, memberId: f.memberId, assessor: f.assessor, award: f.award })) {
    store.set('bscc-assessor', f.assessor)
    form.value = { ...f, paddler: '', memberId: '' }
    document.getElementById('ar-paddler')?.focus()
  }
}
function startEdit(r) { editing.value = { ...r } }
async function saveEdit() {
  const e = editing.value
  if (await call('PUT', { id: e.id, date: e.date, paddler: e.paddler, memberId: e.memberId, assessor: e.assessor, award: e.award })) editing.value = null
}
async function remove(r) {
  if (confirm(`Remove ${r.paddler}'s ${AWARD_LABEL[r.award]} assessment (${uk(r.date)}) from the record?`)) await call('DELETE', null, '?id=' + encodeURIComponent(r.id))
}

const shown = computed(() => {
  const q = filter.value.trim().toLowerCase()
  return q ? records.value.filter(r => r.paddler.toLowerCase().includes(q) || r.assessor.toLowerCase().includes(q)) : records.value
})
// the highest award for each paddler
const byPaddler = computed(() => {
  const best = new Map()
  for (const r of shown.value) {
    const k = r.memberId ? 'm' + r.memberId : 'n' + r.paddler.toLowerCase()
    const cur = best.get(k)
    if (!cur) best.set(k, { key: k, paddler: r.paddler, award: r.award, date: r.date, assessor: r.assessor, count: 1 })
    else {
      cur.count++
      if (r.award > cur.award || (r.award === cur.award && r.date > cur.date)) Object.assign(cur, { award: r.award, date: r.date, assessor: r.assessor, paddler: r.paddler })
    }
  }
  return [...best.values()].sort((a, b) => b.award - a.award || a.paddler.localeCompare(b.paddler))
})
const totals = computed(() => [1, 2, 3].map(n => ({ n, people: byPaddler.value.filter(p => p.award === n).length })))

// the record as a spreadsheet file (their own data; also for checking against the book)
function download() {
  const cell = v => { let s = String(v ?? ''); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s }
  const rows = ['Date of assessment,Paddler,Assessor,Award', ...records.value.map(r => [r.date, r.paddler, r.assessor, r.award + ' star'].map(cell).join(','))]
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([rows.join('\n') + '\n'], { type: 'text/csv' }))
  a.download = 'bscc-star-awards.csv'
  a.click()
  URL.revokeObjectURL(a.href)
}
</script>

<template>
  <section class="ar" aria-labelledby="ar-h">
    <h2 id="ar-h">Assessment record</h2>
    <p v-if="state === 'loading'" class="loading-note"><span class="spin" /> Loading the record…</p>
    <p v-else-if="state === 'denied'" class="ar__note">The record is for coaches: sign in with Google (top right) using an account with the coach role.</p>
    <p v-else-if="state === 'error'" class="ar__error" role="alert">{{ error || 'Could not load the record: try again later.' }}</p>
    <template v-else>
      <p class="ar__note">
        Add a row each time someone is assessed (the same as the book). Moving up a star is just another row for the same
        paddler. Only coaches can see this.
      </p>

      <form class="ar__form" @submit.prevent="add">
        <label>Date of assessment<input v-model="form.date" type="date" required /></label>
        <label>Paddler
          <input id="ar-paddler" v-model="form.paddler" list="ar-members" type="text" autocomplete="off" placeholder="Start typing a name" required @focus="loadMembers" />
        </label>
        <label>Assessor
          <input v-model="form.assessor" list="ar-coaches" type="text" autocomplete="off" required @focus="loadMembers" />
        </label>
        <label>Award
          <select v-model.number="form.award"><option v-for="n in [1, 2, 3]" :key="n" :value="n">{{ AWARD_LABEL[n] }}</option></select>
        </label>
        <button type="submit" class="ar__btn" :disabled="busy" :aria-busy="busy">{{ busy ? 'Saving…' : 'Add to record' }}</button>
        <datalist id="ar-members"><option v-for="m in members" :key="m.id" :value="m.name" /></datalist>
        <datalist id="ar-coaches"><option v-for="m in coaches" :key="m.id" :value="m.name" /></datalist>
      </form>
      <p v-if="error" class="ar__error" role="alert">{{ error }}</p>
      <p v-if="form.paddler && !form.memberId && members.length" class="ar__hint">Not a name in the club's member list: it will be recorded as typed.</p>

      <div class="ar__bar">
        <div class="ar__tabs" role="group" aria-label="View">
          <button type="button" :class="{ on: view === 'record' }" :aria-pressed="view === 'record'" @click="view = 'record'">The record ({{ shown.length }})</button>
          <button type="button" :class="{ on: view === 'paddlers' }" :aria-pressed="view === 'paddlers'" @click="view = 'paddlers'">By paddler ({{ byPaddler.length }})</button>
        </div>
        <input v-model="filter" type="search" class="ar__filter" placeholder="Filter by paddler or assessor" aria-label="Filter the record" />
        <button type="button" class="ar__link" :disabled="!records.length" @click="download">Download as a spreadsheet</button>
      </div>
      <p class="ar__totals"><span v-for="t in totals" :key="t.n"><b>{{ t.people }}</b> at {{ AWARD_LABEL[t.n] }}</span></p>

      <div class="ar__scroll">
        <table v-if="view === 'record'" class="ar__table">
          <thead><tr><th>Date</th><th>Paddler</th><th>Assessor</th><th>Award</th><th /></tr></thead>
          <tbody>
            <tr v-if="!shown.length"><td colspan="5" class="ar__empty">{{ records.length ? 'Nothing matches the filter.' : 'Nothing recorded yet.' }}</td></tr>
            <template v-for="r in shown" :key="r.id">
              <tr v-if="editing && editing.id === r.id" class="ar__editing">
                <td><input v-model="editing.date" type="date" required /></td>
                <td><input v-model="editing.paddler" type="text" required /></td>
                <td><input v-model="editing.assessor" type="text" required /></td>
                <td><select v-model.number="editing.award"><option v-for="n in [1, 2, 3]" :key="n" :value="n">{{ AWARD_LABEL[n] }}</option></select></td>
                <td class="ar__acts"><button type="button" class="ar__btn ar__btn--small" :disabled="busy" :aria-busy="busy" @click="saveEdit">Save</button> <button type="button" class="ar__link" @click="editing = null">Cancel</button></td>
              </tr>
              <tr v-else>
                <td>{{ uk(r.date) }}</td>
                <td>{{ r.paddler }}</td>
                <td>{{ r.assessor }}</td>
                <td><span class="ar__stars" aria-hidden="true">{{ stars(r.award) }}</span> {{ AWARD_LABEL[r.award] }}</td>
                <td class="ar__acts"><button type="button" class="ar__link" @click="startEdit(r)">Edit</button> <button type="button" class="ar__link" :disabled="busy" :aria-busy="busy" @click="remove(r)">Remove</button></td>
              </tr>
            </template>
          </tbody>
        </table>
        <table v-else class="ar__table">
          <thead><tr><th>Paddler</th><th>Highest award</th><th>Assessed</th><th>By</th></tr></thead>
          <tbody>
            <tr v-if="!byPaddler.length"><td colspan="4" class="ar__empty">Nothing recorded yet.</td></tr>
            <tr v-for="p in byPaddler" :key="p.key">
              <td>{{ p.paddler }}</td>
              <td><span class="ar__stars" aria-hidden="true">{{ stars(p.award) }}</span> {{ AWARD_LABEL[p.award] }}<span v-if="p.count > 1" class="ar__more"> ({{ p.count }} assessments)</span></td>
              <td>{{ uk(p.date) }}</td>
              <td>{{ p.assessor }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p class="ar__fine">
        This record holds each paddler's name, the date, the assessor and the award, and who added the row. It is shown only to coaches. Remove a row
        to delete it; the spreadsheet download is everything held.
      </p>
    </template>
  </section>
</template>

<style scoped>
.ar { margin: 0 0 44px; padding: 22px 22px 18px; background: #fff; border: 1.5px solid var(--teal); border-radius: 6px; }
h2 { margin: 0 0 8px; font-family: var(--font-display); font-size: 2rem; color: var(--teal-deep); }
.ar__note { margin: 0 0 14px; color: var(--teal); max-width: 70ch; }
.ar__error { color: var(--clay); font-weight: 600; margin: 8px 0; }
.ar__hint { margin: 6px 0 0; font-size: 0.82rem; color: #6b7572; }
.ar__form { display: grid; grid-template-columns: 150px 1.4fr 1fr 130px auto; gap: 12px; align-items: end; }
.ar__form label { display: grid; gap: 4px; font-size: 0.82rem; font-weight: 600; color: var(--teal-deep); }
input, select { padding: 8px 10px; font: inherit; font-weight: 400; color: var(--ink); border: 1.5px solid var(--teal); border-radius: 6px; background: #fff; min-width: 0; }
input:focus, select:focus { outline: 2px solid var(--teal-deep); outline-offset: 1px; }
.ar__btn { padding: 9px 18px; font: inherit; font-weight: 600; color: #fff; background: var(--teal-deep); border: 0; border-radius: 999px; cursor: pointer; }
.ar__btn:hover:not(:disabled), .ar__btn:focus-visible { background: var(--clay); }
.ar__btn:disabled { opacity: 0.6; cursor: default; }
.ar__btn--small { padding: 5px 12px; }
.ar__bar { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; margin-top: 22px; }
.ar__tabs { display: inline-flex; border: 1.5px solid var(--teal); border-radius: 999px; overflow: hidden; }
.ar__tabs button { font: inherit; font-size: 0.88rem; font-weight: 600; padding: 6px 14px; border: 0; background: #fff; color: var(--teal-deep); cursor: pointer; }
.ar__tabs button.on { background: var(--teal-deep); color: #fff; }
.ar__filter { flex: 1; min-width: 180px; max-width: 300px; }
.ar__link { font: inherit; font-size: 0.88rem; color: var(--teal-deep); background: none; border: 0; padding: 0; text-decoration: underline; cursor: pointer; }
.ar__link:hover:not(:disabled) { color: var(--clay); }
.ar__link:disabled { opacity: 0.5; cursor: default; }
.ar__totals { display: flex; flex-wrap: wrap; gap: 4px 18px; margin: 10px 0 8px; font-size: 0.9rem; color: var(--teal); }
.ar__scroll { overflow-x: auto; }
.ar__table { width: 100%; border-collapse: collapse; min-width: 560px; }
th, td { padding: 9px 10px; text-align: left; border-bottom: 1px solid #e3ddcc; font-size: 0.93rem; vertical-align: middle; }
th { font-size: 0.78rem; letter-spacing: 0.05em; text-transform: uppercase; color: #6b7572; }
.ar__table td input, .ar__table td select { width: 100%; padding: 5px 8px; }
.ar__acts { white-space: nowrap; text-align: right; }
.ar__stars { color: #e3a91c; letter-spacing: 0.04em; }
.ar__more { color: #6b7572; font-size: 0.82rem; }
.ar__empty { text-align: center; color: #6b7572; }
.ar__fine { margin: 14px 0 0; font-size: 0.8rem; color: #6b7572; max-width: 80ch; }
@media (max-width: 800px) {
  .ar { padding: 16px 12px; }
  .ar__form { grid-template-columns: 1fr 1fr; }
  .ar__form .ar__btn { grid-column: 1 / -1; justify-self: start; }
}
</style>
