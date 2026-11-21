<script setup>
// Roles: who may do what. An admin gives a Google account (an email address) the coach and/or race
// coordinator role, or makes them an admin. Signing in with Google (menu bar) is how it's used; a role
// takes effect the next time that person signs in (their sign-in lasts three days). The list is
// stored by netlify/functions/auth.js; this page only edits it.
import { ref, onMounted } from 'vue'
import SiteNav from '../shared/SiteNav.vue'

const LABELS = { coach: 'Coach', coordinator: 'Race coordinator', admin: 'Admin' }
const people = ref([])
const admins = ref([]) // always admins: set on the server, not changeable here
const available = ref(['coach', 'coordinator', 'admin'])
const state = ref('loading') // loading, ok, denied, error
const error = ref('')
const busy = ref(false)
const newEmail = ref('')
const newRoles = ref(['coach'])

async function load() {
  try {
    const res = await fetch('/api/auth/roles', { credentials: 'same-origin' })
    if (res.status === 401) { state.value = 'denied'; return }
    const body = await res.json()
    if (body.error) throw new Error(body.error)
    people.value = body.people
    admins.value = body.admins
    available.value = body.available
    state.value = 'ok'
  } catch (e) {
    error.value = e.message || 'Could not load the list'
    state.value = 'error'
  }
}
async function save(email, roles) {
  busy.value = true
  error.value = ''
  try {
    const res = await fetch('/api/auth/roles', { method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, roles }) })
    const body = await res.json()
    if (body.error) throw new Error(body.error)
    await load()
  } catch (e) {
    error.value = e.message || 'Could not save'
  } finally {
    busy.value = false
  }
}
const toggle = (p, role) => save(p.email, p.roles.includes(role) ? p.roles.filter(r => r !== role) : [...p.roles, role])
const remove = p => { if (confirm(`Remove all roles from ${p.email}?`)) save(p.email, []) }
async function add() {
  if (!newEmail.value.trim() || !newRoles.value.length) { error.value = 'Enter an email address and choose at least one role'; return }
  await save(newEmail.value, newRoles.value)
  if (!error.value) newEmail.value = ''
}
// the list as a file (their own data: the privacy note says it can be downloaded)
function download() {
  const blob = new Blob([JSON.stringify({ people: people.value, admins: admins.value }, null, 2)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = 'bscc-roles.json'
  a.click()
  URL.revokeObjectURL(a.href)
}
onMounted(load)
</script>

<template>
  <SiteNav current="/roles/" />
  <main class="roles">
    <h1>Roles</h1>
    <p v-if="state === 'loading'" class="loading-note"><span class="spin" /> Loading the roles…</p>
    <p v-else-if="state === 'denied'" class="roles__note">This page is for admins. Sign in with Google (top right) using an admin's Google account.</p>
    <p v-else-if="state === 'error'" class="roles__error" role="alert">{{ error }}</p>
    <template v-else>
      <p class="roles__note">
        Give a Google account a role and that person can sign in with Google (there are no passwords). A change takes effect
        the next time they sign in (a sign-in lasts three days). <strong>Coach</strong> opens the paddler detail, My training and the
        Star Awards; <strong>Race coordinator</strong> opens the race planner; <strong>Admin</strong> opens everything and can edit this list.
      </p>
      <p v-if="error" class="roles__error" role="alert">{{ error }}</p>

      <table class="roles__table">
        <thead><tr><th>Google account</th><th v-for="r in available" :key="r">{{ LABELS[r] }}</th><th /></tr></thead>
        <tbody>
          <tr v-for="a in admins" :key="'a' + a">
            <td>{{ a }} <small>(always an admin: set on the server)</small></td>
            <td v-for="r in available" :key="r"><input type="checkbox" checked disabled :aria-label="LABELS[r] + ' for ' + a" /></td>
            <td />
          </tr>
          <tr v-for="p in people" :key="p.email">
            <td>{{ p.email }}</td>
            <td v-for="r in available" :key="r"><input type="checkbox" :checked="p.roles.includes(r)" :disabled="busy" :aria-label="LABELS[r] + ' for ' + p.email" @change="toggle(p, r)" /></td>
            <td><button type="button" class="roles__link" :disabled="busy" :aria-busy="busy" @click="remove(p)">Remove</button></td>
          </tr>
          <tr v-if="!people.length"><td :colspan="available.length + 2" class="roles__empty">Nobody has been given a role yet.</td></tr>
        </tbody>
      </table>

      <form class="roles__add" @submit.prevent="add">
        <h2>Add someone</h2>
        <label>Their Google account (the email address they sign in with)
          <input v-model="newEmail" type="email" autocomplete="off" placeholder="name@gmail.com" required />
        </label>
        <div class="roles__checks">
          <label v-for="r in available" :key="r"><input v-model="newRoles" type="checkbox" :value="r" /> {{ LABELS[r] }}</label>
        </div>
        <button type="submit" :disabled="busy" :aria-busy="busy">Add</button>
      </form>

      <p class="roles__fine">
        This list holds the email addresses of club volunteers and what they may open; it is used only to decide that. Remove someone and
        they are gone from it. <button type="button" class="roles__link" @click="download">Download the list</button>
      </p>
    </template>
  </main>
</template>

<style scoped>
.roles { max-width: 860px; margin: 0 auto; padding: 24px 16px 60px; }
h1 { margin: 0 0 12px; font-family: 'Big Shoulders Display', Inter, sans-serif; font-size: 2.2rem; color: var(--teal-deep); }
h2 { margin: 0 0 10px; font-size: 1.1rem; color: var(--teal-deep); }
.roles__note { line-height: 1.5; }
.roles__error { color: var(--clay); font-weight: 600; }
.roles__table { width: 100%; border-collapse: collapse; background: #fff; border: 1.5px solid var(--teal); border-radius: 8px; overflow: hidden; margin: 14px 0 24px; }
th, td { padding: 10px 12px; text-align: left; border-bottom: 1px solid #ddd8c8; font-size: 0.92rem; }
th { background: var(--teal-deep); color: #fff; font-weight: 600; }
td small { color: #5b6865; }
td input[type='checkbox'] { width: 18px; height: 18px; }
.roles__empty { color: #5b6865; text-align: center; }
.roles__add { background: #fff; border: 1.5px solid var(--teal); border-radius: 8px; padding: 16px; display: grid; gap: 12px; }
.roles__add label { font-weight: 600; font-size: 0.9rem; display: grid; gap: 6px; }
.roles__add input[type='email'] { padding: 10px 12px; font: inherit; border: 1.5px solid var(--teal); border-radius: 6px; }
.roles__checks { display: flex; gap: 18px; flex-wrap: wrap; }
.roles__checks label { display: flex; align-items: center; gap: 6px; font-weight: 500; }
.roles__add button[type='submit'] { justify-self: start; padding: 10px 22px; font: inherit; font-weight: 600; color: #fff; background: var(--teal-deep); border: 0; border-radius: 999px; cursor: pointer; }
.roles__add button[type='submit']:hover { background: var(--clay); }
.roles__link { font: inherit; color: var(--teal); background: none; border: 0; padding: 0; text-decoration: underline; cursor: pointer; }
.roles__fine { margin-top: 24px; font-size: 0.85rem; color: #5b6865; }
</style>
