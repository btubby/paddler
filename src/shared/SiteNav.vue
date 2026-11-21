<script setup>
// The site's navigation bar, at the top of every page. Each page is its own little Vue
// app (see vite.config.js); they all import this, so the menu is the same everywhere.
// `current` is the page's path, so its link is marked as the page you're on.
// `overlay`: on the homepage the bar floats over the river, see-through.
// `limited`: someone who came in on a paddler's shared link sees only the public pages
// (Home, Resources, On the water), and keeps seeing only those as they look round the
// site in that tab. Going to any other page (a coach typing its address) ends that.
import { ref, computed, onMounted, onBeforeUnmount, nextTick } from 'vue'
import StripeBanner from './StripeBanner.vue'
const props = defineProps({
  current: { type: String, required: true },
  overlay: { type: Boolean, default: false },
  limited: { type: Boolean, default: false }
})
const PUBLIC = ['/', '/resources/', '/on-the-water/', '/club-race/']
const FLAG = 'bscc-shared-visitor'
let limited = props.limited
try {
  if (props.limited) sessionStorage.setItem(FLAG, '1')
  else if (!PUBLIC.includes(props.current)) sessionStorage.removeItem(FLAG)
  else limited = sessionStorage.getItem(FLAG) === '1'
} catch {
  // no storage (private browsing): just this page goes by the prop
}
// who may open each page: nothing listed = anyone; 'coach' = the coach role;
// 'coordinator' = the race coordinator's. The menu leaves out what a visitor can't open
// (the pages themselves send the visitor back to sign in: netlify/edge-functions).
const PAGES = [
  { href: '/', label: 'Home' },
  { href: '/paddlers/paddler/', label: 'Paddler lookup' },
  { href: '/club-race/', label: 'Last race' },
  { href: '/paddlers/', label: 'Paddler detail', group: 'staff', role: 'coach' },
  { href: '/race-planner/', label: 'Race planner', group: 'staff', role: 'coordinator' },
  { href: '/my-training/', label: 'My training', group: 'staff', role: 'coach' },
  { href: '/bscc-stars/', label: 'BSCC Star Awards', group: 'staff', role: 'coach' },
  { href: '/resources/', label: 'Resources' },
  { href: '/on-the-water/', label: 'On the water' },
  { href: '/roles/', label: 'Roles', group: 'staff', role: 'admin' }
]
// What this browser is signed in to: the last answer is kept for the tab, so the menu doesn't
// jump about from page to page.
// The answer is kept in this browser for 30 minutes, so looking round the site doesn't ask the
// server on every page (each ask is a Netlify function call, and the free plan has a monthly
// allowance). A page only a coach or the coordinator can open always asks, so signing in shows
// the menu straight away. `bscc-nav-roles` is also read by the paddler page.
const ROLES_KEY = 'bscc-nav-roles'
// The page gates send visitors here: /?signin=signin|norole&need=coach&next=/paddlers/ (open the sign-in box and say
// why; go on to `next` after signing in) and /?signedout=1 (forget what the menu remembered)
const query = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams()
const wantSignIn = query.get('signin') // 'signin', 'norole' or null
const needRole = query.get('need') === 'coordinator' ? 'race coordinator' : 'coach'
const safeNext = /^\/[^/\\]/.test(query.get('next') || '') ? query.get('next') : ''
if (query.has('signedout')) { try { localStorage.removeItem(ROLES_KEY) } catch {} }
if (wantSignIn || query.has('signedout')) {
  // tidy the address (the page's own links and a refresh then don't repeat it)
  try { history.replaceState(null, '', location.pathname + (location.hash || '')) } catch {}
}
const ROLES_FRESH_MS = 30 * 60 * 1000
const roles = ref({ coach: false, coordinator: false, admin: false })
// signed in with Google: the email is shown in the bar; googleClientId (public) is for the sign-in button
const google = ref({ email: '', name: '', clientId: '' })
let rolesAt = 0
try {
  const saved = JSON.parse(localStorage.getItem(ROLES_KEY) || '{}')
  roles.value = { coach: !!saved.coach, coordinator: !!saved.coordinator, admin: !!saved.admin }
  google.value = { email: String(saved.email || ''), name: String(saved.name || ''), clientId: String(saved.googleClientId || '') }
  rolesAt = saved.v === 2 && !wantSignIn ? +saved.at || 0 : 0 // (an answer saved before the sign-in block existed is asked for again)
} catch {}
const remember = () => { try { localStorage.setItem(ROLES_KEY, JSON.stringify({ ...roles.value, email: google.value.email, name: google.value.name, googleClientId: google.value.clientId, v: 2, at: Date.now() })) } catch {} }
onMounted(async () => {
  if (limited) return
  const gated = !!PAGES.find(q => q.href === props.current)?.role
  if (!gated && Date.now() - rolesAt < ROLES_FRESH_MS) return
  try {
    const res = await fetch('/api/whoami', { credentials: 'same-origin' })
    const body = await res.json()
    roles.value = { coach: !!body.coach, coordinator: !!body.coordinator, admin: !!body.admin }
    google.value = { email: body.email || '', name: body.name || '', clientId: body.googleClientId || '' }
    remember()
    if (wantSignIn) await explainSignIn()
  } catch {}
})
// sent here by a page gate: say why, and (if not signed in yet) open the box
async function explainSignIn() {
  if (google.value.email) {
    notice.value = `You are signed in as ${google.value.email}, which does not have the ${needRole} role needed for that page. Ask a club admin to give it to you, then sign out and in again.`
  } else if (google.value.clientId) {
    notice.value = 'Sign in with Google to open that page.'
    await toggleSignIn()
  }
}

// ---- Sign in with Google (Google's own button, in a small box under the bar) ----
// on a narrow screen the pages go into a menu behind a burger button
const menuOpen = ref(false)
const signInOpen = ref(false)
const notice = ref('') // why a gate sent the visitor here
const signInError = ref('')
const gbtn = ref(null)
let gsiLoading = null
const loadGsi = () => gsiLoading || (gsiLoading = new Promise((resolve, reject) => {
  if (window.google?.accounts?.id) return resolve()
  const s = document.createElement('script')
  s.src = 'https://accounts.google.com/gsi/client'
  s.async = true
  s.onload = resolve
  s.onerror = () => { gsiLoading = null; reject(new Error('Could not reach Google')) }
  document.head.appendChild(s)
}))
async function toggleSignIn() {
  signInOpen.value = !signInOpen.value
  signInError.value = ''
  if (!signInOpen.value) return
  try {
    await loadGsi()
    await nextTick() // (the box has to be on the page before Google's button can go in it)
    window.google.accounts.id.initialize({ client_id: google.value.clientId, callback: onGoogle })
    window.google.accounts.id.renderButton(gbtn.value, { theme: 'outline', size: 'large', text: 'signin_with' })
  } catch (e) {
    signInError.value = e.message || 'Could not load Google sign-in'
  }
}
const WELCOME = 'bscc-welcome'
const welcome = ref('')
try {
  const w = sessionStorage.getItem(WELCOME)
  if (w !== null) { sessionStorage.removeItem(WELCOME); welcome.value = w || 'THERE' }
} catch {}
const signingIn = ref(false)
async function onGoogle(r) {
  signingIn.value = true
  try {
    const res = await fetch('/api/auth/google', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ credential: r.credential }) })
    const body = await res.json()
    if (body.error) { signInError.value = body.error; signingIn.value = false; return }
    try { localStorage.removeItem(ROLES_KEY) } catch {}
    try { sessionStorage.setItem(WELCOME, body.first || body.name || '') } catch {}
    if (safeNext) location.href = safeNext // on to the page they asked for
    else location.reload() // the page (and the menu) again, now signed in
  } catch {
    signInError.value = 'Could not sign in: try again'
    signingIn.value = false
  }
}
const signingOut = ref(false)
async function signOut() {
  signingOut.value = true
  try { await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }) } catch {}
  try { localStorage.removeItem(ROLES_KEY) } catch {}
  location.reload()
}
const shown = computed(() => (limited ? PAGES.filter(q => PUBLIC.includes(q.href)) : PAGES.filter(q => !q.role || roles.value[q.role] || q.href === props.current)))
const mainPages = computed(() => shown.value.filter(p => !p.group))
const staffPages = computed(() => shown.value.filter(p => p.group))
const staffHere = computed(() => staffPages.value.some(p => p.href === props.current))
const staffOpen = ref(false)
const acctOpen = ref(false)
const initial = computed(() => String(google.value.name || google.value.email || '?').charAt(0).toUpperCase())
const navEl = ref(null)
const closeMenus = e => {
  if (e.type === 'keydown') { if (e.key === 'Escape') { staffOpen.value = false; acctOpen.value = false } return }
  if (navEl.value && !navEl.value.contains(e.target)) { staffOpen.value = false; acctOpen.value = false }
}
onMounted(() => { document.addEventListener('click', closeMenus); document.addEventListener('keydown', closeMenus) })
onBeforeUnmount(() => { document.removeEventListener('click', closeMenus); document.removeEventListener('keydown', closeMenus) })
</script>

<template>
  <StripeBanner v-if="welcome" top="WELCOME" :headline="welcome.toUpperCase()" />
  <nav ref="navEl" class="site-nav" :class="{ 'site-nav--overlay': overlay }" aria-label="Site">
    <a href="/" class="site-nav__club" aria-label="Bishops Stortford Canoe Club home">
      <img src="/bscc-logo.png" alt="" width="34" height="34" class="site-nav__logo" />
      <span class="site-nav__name">BSCC</span>
    </a>
    <ul id="site-nav-pages" :class="{ open: menuOpen }">
      <li v-for="p in mainPages" :key="p.href">
        <a :href="p.href" :aria-current="p.href === current ? 'page' : undefined">{{ p.label }}</a>
      </li>
      <li v-if="staffPages.length" class="site-nav__staff" :class="{ here: staffHere }">
        <button type="button" class="site-nav__drop" :aria-expanded="staffOpen" @click="staffOpen = !staffOpen">Coaches <span aria-hidden="true">▾</span></button>
        <ul class="site-nav__sub" :class="{ open: staffOpen }">
          <li v-for="p in staffPages" :key="p.href">
            <a :href="p.href" :aria-current="p.href === current ? 'page' : undefined">{{ p.label }}</a>
          </li>
        </ul>
      </li>
    </ul>
    <div v-if="!limited && (google.email || google.clientId)" class="site-nav__auth">
      <div v-if="google.email" class="site-nav__acct">
        <button type="button" class="site-nav__me" :aria-expanded="acctOpen" :title="'Logged in as ' + google.email" @click="acctOpen = !acctOpen">
          <span class="site-nav__avatar" aria-hidden="true">{{ initial }}</span>
          <span class="site-nav__hello">{{ google.name || google.email }}</span>
        </button>
        <div v-if="acctOpen" class="site-nav__pop">
          <span class="site-nav__pre">Logged in as</span>
          <span class="site-nav__email">{{ google.email }}</span>
          <button type="button" class="site-nav__out" :aria-busy="signingOut" @click="signOut">{{ signingOut ? 'Signing out…' : 'Sign out' }}</button>
        </div>
      </div>
      <button v-else type="button" class="site-nav__in" :aria-expanded="signInOpen" @click="toggleSignIn">Sign in</button>
    </div>
    <button type="button" class="site-nav__burger" :aria-expanded="menuOpen" aria-controls="site-nav-pages" aria-label="Menu" @click="menuOpen = !menuOpen">
      <span /><span /><span />
    </button>
    <div v-if="(signInOpen && !google.email) || notice" class="site-nav__signin" role="dialog" aria-label="Sign in with Google">
      <p v-if="notice" class="site-nav__notice">{{ notice }} <button type="button" class="site-nav__x" aria-label="Close" @click="notice = ''; signInOpen = false">×</button></p>
      <p v-else>Coaches and the race coordinator: sign in with the Google account an admin has given a role to.</p>
      <p v-if="signingIn" class="loading-note"><span class="spin" /> Signing you in…</p>
      <div v-show="signInOpen && !google.email && !signingIn" ref="gbtn" />
      <p v-if="signInError" class="site-nav__err" role="alert">{{ signInError }}</p>
    </div>
  </nav>
</template>

<style scoped>
.site-nav {
  position: relative;
  z-index: 30;
  display: flex;
  align-items: center;
  gap: 18px;
  padding: 0 20px;
  min-height: 52px;
  background: #123430;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  font-family: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  font-size: 0.86rem;
}
.site-nav--overlay { position: absolute; top: 0; left: 0; right: 0; background: rgba(6, 40, 58, 0.6); backdrop-filter: blur(8px); border-bottom-color: transparent; }
.site-nav__club { display: flex; align-items: center; gap: 9px; flex: none; color: #fff; font-weight: 700; font-size: 1rem; letter-spacing: 0.1em; text-decoration: none; }
.site-nav__logo { display: block; width: 30px; height: 30px; border-radius: 50%; box-shadow: 0 0 0 1.5px rgba(255, 255, 255, 0.35); }
#site-nav-pages { display: flex; align-items: center; gap: 2px; margin: 0; padding: 0; list-style: none; }
#site-nav-pages li { position: relative; }
#site-nav-pages li a, .site-nav__drop {
  display: block; padding: 7px 12px; color: rgba(255, 255, 255, 0.78); font: inherit; font-weight: 500; text-decoration: none; white-space: nowrap;
  background: transparent; border: 0; border-radius: 999px; cursor: pointer;
}
#site-nav-pages li a:hover, #site-nav-pages li a:focus-visible, .site-nav__drop:hover, .site-nav__drop:focus-visible { color: #fff; background: rgba(255, 255, 255, 0.1); }
#site-nav-pages li a[aria-current='page'], .site-nav__staff.here > .site-nav__drop { color: #fff; background: rgba(193, 96, 46, 0.85); }
.site-nav__drop span { font-size: 0.7em; margin-left: 2px; }
.site-nav__sub { display: none; position: absolute; top: calc(100% + 8px); left: 0; min-width: 190px; margin: 0; padding: 6px; list-style: none; background: #123430; border: 1px solid rgba(255, 255, 255, 0.14); border-radius: 12px; box-shadow: 0 10px 28px rgba(0, 0, 0, 0.35); }
.site-nav__sub.open { display: block; }
.site-nav__sub li a { border-radius: 8px; }
.site-nav__auth { margin-left: auto; display: flex; align-items: center; min-width: 0; color: rgba(255, 255, 255, 0.9); }
.site-nav__acct { position: relative; }
.site-nav__me, .site-nav__in { display: flex; align-items: center; gap: 8px; font: inherit; font-weight: 600; color: #fff; background: rgba(255, 255, 255, 0.08); border: 1px solid rgba(255, 255, 255, 0.25); border-radius: 999px; padding: 3px 12px 3px 3px; cursor: pointer; }
.site-nav__in { padding: 6px 16px; background: #c1602e; border-color: #c1602e; }
.site-nav__me:hover, .site-nav__me:focus-visible { background: rgba(255, 255, 255, 0.16); }
.site-nav__in:hover, .site-nav__in:focus-visible { background: #d4703b; }
.site-nav__avatar { display: grid; place-items: center; width: 26px; height: 26px; border-radius: 50%; background: #c1602e; font-size: 0.8rem; font-weight: 700; }
.site-nav__hello { max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.site-nav__pop { position: absolute; right: 0; top: calc(100% + 8px); min-width: 220px; display: flex; flex-direction: column; gap: 2px; padding: 12px 14px; background: #fff; color: #14201e; border-radius: 12px; box-shadow: 0 10px 28px rgba(0, 0, 0, 0.3); }
.site-nav__pre { font-size: 0.66rem; letter-spacing: 0.06em; text-transform: uppercase; opacity: 0.6; }
.site-nav__email { font-weight: 600; word-break: break-all; margin-bottom: 10px; }
.site-nav__out { align-self: flex-start; font: inherit; font-weight: 600; color: #123430; background: transparent; border: 1.5px solid #123430; border-radius: 999px; padding: 4px 14px; cursor: pointer; }
.site-nav__out:hover, .site-nav__out:focus-visible { background: #c1602e; border-color: #c1602e; color: #fff; }
.site-nav__signin { position: absolute; top: 100%; right: 10px; width: min(320px, calc(100vw - 24px)); background: #fff; color: #14201e; border-radius: 8px; padding: 14px; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3); font-size: 0.86rem; }
.site-nav__signin p { margin: 0 0 10px; }
.site-nav__err { color: #c1602e; font-weight: 600; }
.site-nav__notice { font-weight: 600; color: #123430; }
.site-nav__x { float: right; margin-left: 8px; border: 0; background: none; font-size: 1.2rem; line-height: 1; cursor: pointer; color: #123430; }

.site-nav__burger { display: none; flex: none; width: 36px; height: 32px; padding: 0; border: 1px solid rgba(255, 255, 255, 0.3); border-radius: 8px; background: transparent; cursor: pointer; flex-direction: column; align-items: center; justify-content: center; gap: 4px; }
.site-nav__burger span { display: block; width: 16px; height: 2px; background: #fff; border-radius: 1px; }
.site-nav__burger:hover, .site-nav__burger:focus-visible { background: #c1602e; border-color: #c1602e; }

/* narrower screens: the pages go behind a burger button, in a list under the bar (coach pages listed in full) */
@media (max-width: 900px) {
  .site-nav { gap: 10px; padding: 0 12px; }
  .site-nav__burger { display: flex; }
  #site-nav-pages { display: none; position: absolute; top: 100%; left: 0; right: 0; flex-direction: column; align-items: stretch; gap: 0; padding: 6px 0 10px; background: #123430; box-shadow: 0 8px 20px rgba(0, 0, 0, 0.3); }
  .site-nav--overlay #site-nav-pages { background: rgba(6, 40, 58, 0.95); backdrop-filter: blur(8px); }
  #site-nav-pages.open { display: flex; }
  #site-nav-pages li a { border-radius: 0; padding: 12px 20px; font-size: 0.95rem; border-left: 3px solid transparent; }
  #site-nav-pages li a[aria-current='page'] { background: rgba(255, 255, 255, 0.08); border-left-color: #c1602e; }
  .site-nav__drop { display: block; width: 100%; text-align: left; border-radius: 0; padding: 14px 20px 4px; font-size: 0.7rem; letter-spacing: 0.08em; text-transform: uppercase; color: rgba(255, 255, 255, 0.5); pointer-events: none; background: none !important; }
  .site-nav__drop span { display: none; }
  .site-nav__staff.here > .site-nav__drop { background: none; color: rgba(255, 255, 255, 0.5); }
  .site-nav__sub { display: block; position: static; min-width: 0; padding: 0; background: none; border: 0; box-shadow: none; border-radius: 0; }
}
@media (max-width: 640px) {
  .site-nav { padding: 0 8px; gap: 8px; }
  .site-nav__name, .site-nav__hello { display: none; }
  .site-nav__me { padding: 3px; }
  .site-nav__logo { width: 28px; height: 28px; }
}
</style>
