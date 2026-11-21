// GET /api/members
// Logs in to MemberMojo with credentials from Netlify environment variables
// (MEMBERMOJO_EMAIL / MEMBERMOJO_PASSWORD), reads the member directory and
// returns [{ id, name, url }]. Only for coaches signed in with Google (an account with the coach
// role: lib/access.js), or for
// `npm run sync-members` with SYNC_TOKEN, because the response contains member names.
//
// How MemberMojo works (checked in a browser, Sept 2026):
// - Every page is a JavaScript app. The page's data, including a CSRF token, is JSON
//   in the data-value attribute of <div id="mm2-env">; there are no plain HTML forms.
// - Sign in: GET /bscc/signin (gets the session cookie + csrf_token), then POST
//   csrf_token, email, password to /bscc/signin_password (the "Sign In with password"
//   button does exactly this).
// - Members: GET /bscc/yourmembership/directory. The whole list is in the
//   mm2-env JSON at page.members = [{ id, first_name, last_name, directories }].
import * as cheerio from 'cheerio'
import { sameToken, guessRole, maskInfo, MIN_TOKEN_LENGTH, makeAttemptLimiter } from './lib/members.js'
import { signedInAs } from './lib/access.js'
import { sameRacer } from './lib/match.js'
import { personKey } from './lib/crewfit.js'

const UA = 'BSCC-Coaching-App/0.1 (club coaching tool)'
const SESSION_TTL_MS = 20 * 60 * 1000
const RESULT_TTL_MS = 5 * 60 * 1000

const env = (k, d = '') => (process.env[k] || d).trim()
const BASE = () => env('MEMBERMOJO_BASE', 'https://membermojo.co.uk').replace(/\/$/, '')
const ORG = () => env('MEMBERMOJO_ORG', 'bscc')
const SIGNIN = () => env('MEMBERMOJO_SIGNIN_PATH', `/${ORG()}/signin`)
const SIGNIN_PASSWORD = () => env('MEMBERMOJO_SIGNIN_PASSWORD_PATH', `/${ORG()}/signin_password`)
const DIRECTORY = () => env('MEMBERMOJO_DIRECTORY_PATH', `/${ORG()}/yourmembership/directory`)
const MEMBER_PAGE = id => `${BASE()}/${ORG()}/directory/member/${id}`
// Member photos live at a fixed path per member id. They need a signed-in MemberMojo
// session (signed out, MemberMojo answers with an HTML page instead of the JPEG), so
// the browser can't load them directly: /api/members/photo/<id> fetches them here.
const PHOTO = id => `${BASE()}/${ORG()}/files/per_member/${id}/images/photo.jpg`
const PHOTO_PROXY = id => `/api/members/photo/${id}`
const PHOTO_TTL_MS = 60 * 60 * 1000

// --- uploaded member list (for the live site) -----------------------------------
// MemberMojo sits behind Cloudflare, which challenges requests from cloud servers
// (HTTP 403, cf-mitigated: challenge), so the deployed function can't sign in.
// Instead `npm run sync-members` runs on a home computer (where MemberMojo is reachable),
// then uploads the list and photos here; they are kept in Netlify Blobs.
//   MEMBERS_SOURCE=upload  always serve the uploaded copy (set this on Netlify)
//   MEMBERS_SOURCE=live    always ask MemberMojo directly (the sync script uses this)
//   (unset / auto)         the uploaded copy if there is one, otherwise MemberMojo
const SOURCE = () => env('MEMBERS_SOURCE', 'auto').toLowerCase()
async function blobStore() {
  if (globalThis.__membersTestStore) return globalThis.__membersTestStore // tests only
  const { getStore } = await import('@netlify/blobs') // loaded only when needed
  return getStore({ name: 'membermojo', consistency: 'strong' })
}
async function readUploaded() {
  if (SOURCE() === 'live') return null
  try {
    const up = await (await blobStore()).get('members', { type: 'json' })
    dbg('upload:read', { found: !!up, count: up?.members?.length ?? 0, fetchedAt: up?.fetchedAt })
    return up || null
  } catch (err) {
    dbg('upload:read-failed', { message: err.message })
    if (SOURCE() === 'upload') throw new StepError('upload', `Could not read the uploaded member list: ${err.message}`)
    return null
  }
}
async function readUploadedPhoto(id) {
  const r = await (await blobStore()).getWithMetadata(`photo-${id}`, { type: 'arrayBuffer' })
  if (!r?.data || !r.data.byteLength) return { bytes: null }
  return { type: r.metadata?.type || 'image/jpeg', bytes: Buffer.from(r.data) }
}
// Is this member's photo allowed (photo consent "Yes")? Uploaded list: its photo field.
// Live: the member's profile (cached).
async function photoAllowed(uploaded) {
  if (uploaded) {
    const ok = new Set(uploaded.members.filter(m => m.photo).map(m => m.id))
    return async id => ok.has(String(id))
  }
  if (/^(off|0|false|no)$/i.test(env('MEMBERS_PROFILES'))) return async () => false
  return async id => {
    try { return (await readProfile((await getSession()).jar, String(id))).photoConsent === true } catch { return false }
  }
}
async function readJsonBody(req, maxBytes) {
  const text = await req.text()
  if (text.length > maxBytes) throw new StepError('upload', `Upload too large (${text.length} bytes, max ${maxBytes})`)
  try { return JSON.parse(text) } catch { throw new StepError('upload', 'Upload is not valid JSON') }
}

class StepError extends Error {
  constructor(step, message) { super(message); this.step = step }
}

// --- debug tracing -------------------------------------------------------------
// Logs every step to the terminal (`netlify dev`) or the Netlify function log when
// MEMBERS_DEBUG=1 is set, or for one request when you add ?trace=1 to the URL.
// With ?trace=1 the steps are also returned in the JSON as "trace".
// Never logs the password, cookie values, the CSRF token or member details; only
// paths, statuses, field names, cookie names and counts.
let traceOn = false
let traceLog = []
let traceStart = 0
function dbg(step, detail = {}) {
  if (!traceOn) return
  const entry = { ms: Date.now() - traceStart, step, ...detail }
  traceLog.push(entry)
  console.log('[members]', JSON.stringify(entry))
}
const pathOf = u => { try { const x = new URL(u); return x.pathname + x.search } catch { return String(u) } }

// --- tiny cookie jar + redirect-following fetch (same host only) -------------
class Jar {
  constructor() { this.cookies = new Map() }
  absorb(res) {
    for (const line of res.headers.getSetCookie?.() ?? []) {
      const pair = line.split(';')[0]
      const i = pair.indexOf('=')
      if (i > 0) this.cookies.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim())
    }
  }
  header() { return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ') }
}

async function request(jar, url, opts = {}, hops = 0) {
  const host = new URL(BASE()).host
  if (new URL(url).host !== host) {
    dbg('request:blocked', { url: String(url), allowedHost: host })
    throw new StepError('redirect', 'Refusing to leave the MemberMojo host')
  }
  const method = opts.method || 'GET'
  dbg('request', { method, path: pathOf(url), hop: hops, sendingCookies: [...jar.cookies.keys()] })
  const t0 = Date.now()
  const res = await fetch(url, {
    ...opts,
    redirect: 'manual',
    headers: { 'User-Agent': UA, Accept: 'text/html', Cookie: jar.header(), ...(opts.headers || {}) }
  })
  jar.absorb(res)
  const setCookies = (res.headers.getSetCookie?.() ?? []).map(l => l.split('=')[0].trim())
  dbg('response', {
    method, path: pathOf(url), status: res.status, took: Date.now() - t0,
    location: res.headers.get('location') ? pathOf(new URL(res.headers.get('location'), url)) : undefined,
    setCookies, contentType: res.headers.get('content-type')
  })
  if ([301, 302, 303, 307, 308].includes(res.status) && res.headers.get('location') && hops < 8) {
    const next = new URL(res.headers.get('location'), url).toString()
    const keepBody = res.status === 307 || res.status === 308
    return request(jar, next, keepBody ? opts : {}, hops + 1)
  }
  if (res.status === 429) {
    const secs = Number(res.headers.get('retry-after')) || 0
    const err = new StepError('rate-limited', `MemberMojo is refusing requests for now (HTTP 429, too many requests) on ${new URL(url).pathname}`)
    err.retryAfterMs = secs > 0 ? secs * 1000 : 15 * 60 * 1000
    dbg('rate-limited', { path: pathOf(url), retryAfterHeader: res.headers.get('retry-after'), waitingMinutes: Math.round(err.retryAfterMs / 60000) })
    throw err
  }
  if (!res.ok) {
    // Say who refused and why: a firewall / bot-protection page (e.g. Cloudflare) reads very
    // differently from MemberMojo's own error page. Page text is masked (digits, emails).
    const body = await res.text().catch(() => '')
    const title = (body.match(/<title[^>]*>([^<]*)/i) || [])[1]?.replace(/\s+/g, ' ').trim() || ''
    const h = k => res.headers.get(k)
    const who = {
      server: h('server'), cfRay: h('cf-ray'), cfMitigated: h('cf-mitigated'), via: h('via'),
      title, snippet: maskInfo(body.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200))
    }
    dbg('http:refused', { path: pathOf(url), status: res.status, ...who })
    const hint = [who.server && `server: ${who.server}`, who.cfMitigated && `cf-mitigated: ${who.cfMitigated}`, title && `page: "${title.slice(0, 60)}"`].filter(Boolean).join(', ')
    throw new StepError('http', `HTTP ${res.status} for ${new URL(url).pathname}${hint ? ` (${hint})` : ''}`)
  }
  const html = await res.text()
  dbg('body', { path: pathOf(url), bytes: html.length, title: (html.match(/<title[^>]*>([^<]*)/i) || [])[1]?.trim() })
  return { url, html }
}

// The JSON MemberMojo puts in <div id="mm2-env" data-value="...">
function pageEnv(html, step) {
  const $ = cheerio.load(html)
  const raw = $('#mm2-env').attr('data-value')
  if (!raw) throw new StepError(step, 'MemberMojo page has no mm2-env data (page layout changed?)')
  try { return JSON.parse(raw) } catch { throw new StepError(step, 'Could not parse MemberMojo page data') }
}
const isSignedIn = e => !!(e.email || e.member_id)

// --- login --------------------------------------------------------------------
// After MemberMojo says "too many requests", don't try to sign in again until it has
// had time to cool down: retrying just extends the block.
let loginBlockedUntil = 0
let loginCount = 0
const hhmm = t => new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' })

async function login() {
  if (Date.now() < loginBlockedUntil) {
    throw new StepError('rate-limited', `MemberMojo is limiting sign-ins; not trying again until ${hhmm(loginBlockedUntil)}`)
  }
  try {
    const jar = await loginOnce()
    return jar
  } catch (err) {
    if (err.step === 'rate-limited') loginBlockedUntil = Date.now() + (err.retryAfterMs || 15 * 60 * 1000)
    throw err
  }
}

async function loginOnce() {
  loginCount++
  dbg('login:attempt', { loginsSinceFunctionStarted: loginCount })
  const email = env('MEMBERMOJO_EMAIL')
  const password = process.env.MEMBERMOJO_PASSWORD || ''
  dbg('login:start', {
    base: BASE(), signin: SIGNIN(), signinPassword: SIGNIN_PASSWORD(),
    emailSet: !!email, emailMasked: email ? email.replace(/^(.).*(@.*)$/, '$1***$2') : '',
    passwordSet: !!password, passwordLength: password.length
  })
  if (!email || !password) throw new StepError('config', 'MEMBERMOJO_EMAIL / MEMBERMOJO_PASSWORD are not set')

  const jar = new Jar()
  const page = await request(jar, BASE() + SIGNIN())
  const signinEnv = pageEnv(page.html, 'signin-page')
  const csrf = signinEnv.csrf_token
  // the page names the password endpoint in <mm2-...login-password-url="...">; fall back to the default
  const fromPage = (page.html.match(/login-password-url="([^"]+)"/) || [])[1]
  const action = new URL(fromPage || SIGNIN_PASSWORD(), page.url).toString()
  dbg('login:signin-page', {
    view: signinEnv.view, csrfTokenFound: !!csrf, passwordUrlFromPage: fromPage ? pathOf(fromPage) : null,
    postingTo: pathOf(action), cookies: [...jar.cookies.keys()]
  })
  if (!csrf) throw new StepError('csrf', 'No csrf_token on the MemberMojo sign-in page')

  const body = new URLSearchParams({ csrf_token: csrf, email, password })
  const submitted = await request(jar, action, {
    method: 'POST',
    body: body.toString(),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: page.url, Origin: BASE() }
  })

  let after = {}
  try { after = pageEnv(submitted.html, 'login') } catch {}
  const $after = cheerio.load(submitted.html)
  dbg('login:result', {
    landedOn: pathOf(submitted.url),
    view: after.view,
    signedIn: isSignedIn(after),
    // any message MemberMojo shows (e.g. bad password), digits/emails masked
    messages: [...new Set($after('.alert,.error,.errors,.message,.notice,[role=alert],mm2-loginpage')
      .map((_, e) => maskInfo(($after(e).attr('bad-password-message') || $after(e).text()).replace(/\s+/g, ' ').trim().slice(0, 150)))
      .get().filter(Boolean))],
    cookies: [...jar.cookies.keys()]
  })
  if (!isSignedIn(after)) {
    throw new StepError('credentials', 'MemberMojo did not accept the sign-in (check MEMBERMOJO_EMAIL / MEMBERMOJO_PASSWORD, and that this account has a password set)')
  }
  return jar
}

// --- directory ----------------------------------------------------------------
async function readDirectory(jar) {
  const page = await request(jar, BASE() + DIRECTORY())
  const e = pageEnv(page.html, 'directory')
  if (!isSignedIn(e)) {
    dbg('directory:not-signed-in', { view: e.view })
    throw new StepError('session', 'Session expired')
  }
  const list = e.page?.members
  dbg('directory:parsed', {
    view: e.view,
    pageKeys: Object.keys(e.page || {}),
    members: Array.isArray(list) ? list.length : `not a list (${typeof list})`,
    fields: Array.isArray(list) && list[0] ? Object.keys(list[0]) : []
  })
  if (!Array.isArray(list)) throw new StepError('directory', `No member list on ${DIRECTORY()} (view: ${e.view})`)
  return list
    .map(m => ({
      id: String(m.id),
      name: [m.first_name, m.last_name].map(s => String(s || '').trim()).filter(Boolean).join(' '),
      url: MEMBER_PAGE(m.id),
      photo: PHOTO_PROXY(m.id),
      info: '' // the directory has no membership type/role text
    }))
    .filter(m => m.id && m.name)
}

// --- under-18 flag, coach/volunteer and photo consent from each member's profile -------
// From each profile we read just three fields and keep only yes/no answers:
//   "Age"           -> junior: under 18 (used to tint cards orange; the age isn't kept)
//   "Membership"    -> coach: type "Coach" / "Coach (3 months)"; volunteer: type "Volunteer"
//                      (the type itself isn't kept)
//   "Photo consent" -> photoConsent: only a "Yes" lets the app show the member's photo
// Every other field on the profile (medical, disability, contacts...) is ignored.
// Set MEMBERS_PROFILES=off to skip this (one page load per member).
const PROFILE_TTL_MS = 12 * 60 * 60 * 1000
const profileCache = new Map() // id -> { at, junior }
async function readProfile(jar, id) {
  const hit = profileCache.get(id)
  if (hit && Date.now() - hit.at < PROFILE_TTL_MS) return hit
  const page = await request(jar, MEMBER_PAGE(id))
  const e = pageEnv(page.html, 'profile')
  const detail = e.store?.memberDetail || {}
  const age = parseInt(detail['age.today'], 10)
  const fields = e.page?.memberForm?.fields || []
  const consentField = fields.find(f => /photo\s*consent/i.test(f.label || ''))
  // membership type is a choice id; its name comes from the field's choices
  const typeField = fields.find(f => f.id === 'membership_type_id')
  const typeId = detail.membership_type_id
  const typeName = typeField?.choices?.find(c => String(c.id) === String(typeId))?.name
  const out = {
    at: Date.now(),
    junior: Number.isFinite(age) ? age < 18 : undefined,
    coach: typeName === undefined ? undefined : /^\s*coach\b/i.test(typeName),
    volunteer: typeName === undefined ? undefined : /^\s*volunteer\b/i.test(typeName),
    photoConsent: !!consentField && String(detail[consentField.id] || '').trim().toLowerCase() === 'yes'
  }
  profileCache.set(id, out)
  return out
}
async function addProfiles(jar, members) {
  if (/^(off|0|false|no)$/i.test(env('MEMBERS_PROFILES'))) {
    members.forEach(m => { m.photo = '' }) // consent unknown, so no photos
    return members
  }
  let i = 0, failed = 0
  const worker = async () => {
    while (i < members.length) {
      const m = members[i++]
      try {
        const p = await readProfile(jar, m.id)
        m.junior = p.junior
        m.coach = p.coach
        m.volunteer = p.volunteer
        m.photoConsent = p.photoConsent
      } catch (err) {
        failed++
        dbg('profile:failed', { id: m.id, step: err.step, message: err.message })
        if (err.step === 'rate-limited') throw err
      }
    }
  }
  await Promise.all(Array.from({ length: 4 }, worker)) // 4 at a time, to go easy on MemberMojo
  members.forEach(m => { if (!m.photoConsent) m.photo = '' }) // no consent (or unknown): no photo
  dbg('profiles:done', {
    members: members.length, failed,
    juniors: members.filter(m => m.junior).length,
    coaches: members.filter(m => m.coach).length,
    volunteers: members.filter(m => m.volunteer).length,
    photoConsent: members.filter(m => m.photoConsent).length
  })
  return members
}

// --- caching across warm invocations -----------------------------------------
let session = null // { jar, at }
let loginInFlight = null // shared, so many photo requests at once trigger only one login
async function getSession(forceNew = false) {
  if (!forceNew && session && Date.now() - session.at < SESSION_TTL_MS) return session
  if (!loginInFlight) {
    loginInFlight = login()
      .then(jar => (session = { jar, at: Date.now() }))
      .finally(() => { loginInFlight = null })
  }
  return loginInFlight
}

// --- photos -------------------------------------------------------------------
const photoCache = new Map() // id -> { at, type, bytes } (null bytes = member has no photo)
async function fetchPhoto(jar, id) {
  const res = await fetch(PHOTO(id), { redirect: 'manual', headers: { 'User-Agent': UA, Accept: 'image/*', Cookie: jar.header() } })
  const type = res.headers.get('content-type') || ''
  if (res.ok && type.startsWith('image/')) return { status: res.status, type, bytes: Buffer.from(await res.arrayBuffer()) }
  // Not an image. If the page it sent shows us signed in, the member simply has no photo;
  // otherwise the session has expired.
  let signedIn = false
  try { signedIn = isSignedIn(pageEnv(await res.text(), 'photo')) } catch {}
  return { status: res.status, type, bytes: null, signedIn }
}
async function getPhoto(id) {
  const hit = photoCache.get(id)
  if (hit && Date.now() - hit.at < PHOTO_TTL_MS) { dbg('photo:cache-hit', { id, hasPhoto: !!hit.bytes }); return hit }
  let s = await getSession()
  let r = await fetchPhoto(s.jar, id)
  dbg('photo:fetch', { id, status: r.status, type: r.type, bytes: r.bytes?.length ?? 0, signedIn: r.signedIn })
  if (!r.bytes && !r.signedIn) {
    // signed out: the session expired, so sign in again and retry once
    s = await getSession(true)
    r = await fetchPhoto(s.jar, id)
    dbg('photo:retry-after-login', { id, status: r.status, type: r.type, bytes: r.bytes?.length ?? 0 })
  }
  const entry = { at: Date.now(), type: r.type, bytes: r.bytes }
  photoCache.set(id, entry)
  return entry
}
let lastResult = null // { members, at }

async function getMembers(fresh = false) {
  if (!fresh && lastResult && Date.now() - lastResult.at < RESULT_TTL_MS) {
    dbg('cache:result-hit', { ageSeconds: Math.round((Date.now() - lastResult.at) / 1000), count: lastResult.members.length })
    return lastResult
  }
  dbg('cache:result-miss', { fresh, hadResult: !!lastResult })
  for (let attempt = 0; attempt < 2; attempt++) {
    if (fresh || !session || Date.now() - session.at > SESSION_TTL_MS || attempt > 0) {
      dbg('session:login', { attempt, reason: fresh ? 'fresh requested' : !session ? 'no session' : attempt > 0 ? 'retry after expiry' : 'session too old' })
      await getSession(true)
      fresh = false
    } else {
      dbg('session:reuse', { ageSeconds: Math.round((Date.now() - session.at) / 1000) })
    }
    try {
      const members = await addProfiles(session.jar, await readDirectory(session.jar))
      lastResult = { members, at: Date.now() }
      return lastResult
    } catch (err) {
      dbg('directory:error', { attempt, failedStep: err.step, message: err.message })
      if (!(err instanceof StepError && err.step === 'session') || attempt > 0) throw err
    }
  }
}

const words = k => env(k).split(',').map(x => x.trim().toLowerCase()).filter(Boolean)

// --- shared board: groups and roles, the same for every coach -------------------------
// Stored once in Netlify Blobs. Coaches send small changes ("move 123 to group g1"),
// which are applied one at a time to the latest copy, so two coaches editing at the
// same time don't overwrite each other. A conditional write (only if nobody else wrote
// in between) with retries keeps that safe across function instances.
const PERSON_ID = /^\d{1,12}$/
const GROUP_ID = /^[A-Za-z0-9_-]{1,40}$/
const ROLES = new Set(['paddler', 'coach', 'hidden', 'unclassified'])
const emptyBoard = () => ({ version: 0, updatedAt: null, groups: [], roles: {} })
async function boardStore() {
  if (globalThis.__boardTestStore) return globalThis.__boardTestStore // tests only
  const { getStore } = await import('@netlify/blobs')
  return getStore({ name: 'board', consistency: 'strong' })
}
async function readBoard(store) {
  const r = await store.getWithMetadata('board', { type: 'json' })
  return { board: r?.data || emptyBoard(), etag: r?.etag || null }
}
const cleanName = (v, fallback) => String(v ?? fallback).replace(/\s+/g, ' ').trim().slice(0, 60) || fallback
function cleanBoard(b) {
  const seen = new Set()
  const groups = (Array.isArray(b?.groups) ? b.groups : []).slice(0, 100)
    .filter(g => GROUP_ID.test(String(g?.id || '')))
    .map(g => ({
      id: String(g.id),
      name: cleanName(g.name, 'Group'),
      memberIds: (Array.isArray(g.memberIds) ? g.memberIds : []).map(String)
        .filter(id => PERSON_ID.test(id) && !seen.has(id) && seen.add(id))
    }))
  const roles = {}
  for (const [id, role] of Object.entries(b?.roles || {})) if (PERSON_ID.test(id) && ROLES.has(role)) roles[id] = role
  return { groups, roles }
}
function applyOp(board, op) {
  const bad = msg => { throw new StepError('board', msg) }
  const pid = op.personId === undefined ? '' : String(op.personId)
  const unassign = id => board.groups.forEach(g => { g.memberIds = g.memberIds.filter(x => x !== id) })
  switch (op.type) {
    case 'init': // first upload: only onto an empty board
      if (board.groups.length || Object.keys(board.roles).length) return false
      Object.assign(board, cleanBoard(op.board))
      return true
    case 'move': {
      if (!PERSON_ID.test(pid)) bad('bad person id')
      unassign(pid)
      if (op.groupId) {
        const g = board.groups.find(x => x.id === String(op.groupId))
        if (!g) return true // group was deleted meanwhile: leave them unassigned
        g.memberIds.push(pid)
      }
      return true
    }
    case 'addGroup':
      if (!GROUP_ID.test(String(op.id || ''))) bad('bad group id')
      if (board.groups.length >= 100) bad('too many groups')
      if (!board.groups.some(g => g.id === op.id)) board.groups.push({ id: String(op.id), name: cleanName(op.name, 'New group'), memberIds: [] })
      return true
    case 'renameGroup': {
      const g = board.groups.find(x => x.id === String(op.id))
      if (g) g.name = cleanName(op.name, g.name)
      return true
    }
    case 'removeGroup':
      board.groups = board.groups.filter(g => g.id !== String(op.id))
      return true
    case 'setRoles': // { roles: { id: role | null } }; null clears the manual role
      for (const [id, role] of Object.entries(op.roles || {})) {
        if (!PERSON_ID.test(id)) bad('bad person id')
        if (role === null) delete board.roles[id]
        else if (ROLES.has(role)) board.roles[id] = role
        else bad('bad role')
        if (role === 'hidden') unassign(id) // hidden people leave their group
      }
      return true
    default:
      bad('unknown change')
  }
}
async function changeBoard(op) {
  const store = await boardStore()
  for (let attempt = 0; attempt < 6; attempt++) {
    const { board, etag } = await readBoard(store)
    const changed = applyOp(board, op)
    if (!changed) return board
    board.version = (board.version || 0) + 1
    board.updatedAt = new Date().toISOString()
    // write only if nobody else wrote since we read; otherwise read again and re-apply
    const res = await store.setJSON('board', board, etag ? { onlyIfMatch: etag } : { onlyIfNew: true })
    if (res?.modified !== false) {
      dbg('board:changed', { type: op.type, version: board.version, attempt })
      return board
    }
    dbg('board:conflict-retry', { type: op.type, attempt })
  }
  throw new StepError('board', 'The board is busy; please try again')
}

// --- who may call ------------------------------------------------------------------
// Coaches: signed in with Google as an account that has the coach role (or admin): the
// `bscc_session` cookie, checked by lib/access.js.
// The sync script: SYNC_TOKEN in the x-sync-token header (a long random string; wrong
// tokens are counted per client and the client is blocked for a while after 10 wrong
// tries in 15 minutes).
function checkCoach(req) {
  const syncToken = req.headers.get('x-sync-token')
  if (syncToken) return checkCode(req, 'SYNC_TOKEN', syncToken)
  if (signedInAs(req, 'coach')) return null
  dbg('auth:rejected', {})
  return json({ error: 'Not signed in: open /paddlers/ and sign in with Google as a coach' }, 401)
}
const attempts = makeAttemptLimiter({ max: 10, windowMs: 15 * 60 * 1000 })
const clientKey = req =>
  req.headers.get('x-nf-client-connection-ip') || (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown'
function checkCode(req, name, given) {
  const expected = process.env[name] || ''
  if (!expected) return json({ error: `${name} is not configured on the server` }, 500)
  if (expected.length < MIN_TOKEN_LENGTH) {
    return json({ error: `${name} on the server is too short (at least ${MIN_TOKEN_LENGTH} characters); set a long random one` }, 500)
  }
  const key = clientKey(req)
  const wait = attempts.blockedFor(key)
  if (wait > 0) {
    dbg('auth:blocked', { name, minutes: Math.ceil(wait / 60000) })
    return json({ error: `Too many wrong access codes. Try again in ${Math.ceil(wait / 60000)} minutes.` }, 429)
  }
  if (!sameToken(given, expected)) {
    attempts.fail(key)
    dbg('auth:rejected', { name, headerPresent: !!given })
    return json({ error: 'Unauthorized' }, 401)
  }
  attempts.reset(key)
  return null
}

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    // never cached: the response is only for signed-in coaches
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' }
  })

export default async (req) => {
  const url = new URL(req.url)
  const wantTrace = !!url.searchParams.get('trace') || !!url.searchParams.get('debug')
  traceOn = wantTrace || /^(1|true|yes)$/i.test(env('MEMBERS_DEBUG'))
  traceLog = []
  traceStart = Date.now()
  dbg('start', {
    path: url.pathname, query: [...url.searchParams.keys()],
    node: process.version, hasGetSetCookie: typeof Headers.prototype.getSetCookie === 'function',
    warmInstance: !!(session || lastResult)
  })

  // --- uploads from `npm run sync-members` (need SYNC_TOKEN) ---
  if (req.method === 'POST' && ['/api/members/upload', '/api/members/upload-photos'].includes(url.pathname)) {
    const denied = checkCode(req, 'SYNC_TOKEN', req.headers.get('x-sync-token'))
    if (denied) return denied
    try {
      const store = await blobStore()
      if (url.pathname === '/api/members/upload') {
        const body = await readJsonBody(req, 2_000_000)
        const members = (Array.isArray(body.members) ? body.members : [])
          .filter(m => m && /^\d+$/.test(String(m.id)) && typeof m.name === 'string' && m.name.trim())
          .slice(0, 5000)
          .map(m => ({
            id: String(m.id), name: m.name.trim().slice(0, 120), url: MEMBER_PAGE(m.id), role: m.role,
            photo: m.photo ? PHOTO_PROXY(m.id) : '', // only set by the sync for members with photo consent
            junior: typeof m.junior === 'boolean' ? m.junior : undefined,
            coach: typeof m.coach === 'boolean' ? m.coach : undefined,
            volunteer: typeof m.volunteer === 'boolean' ? m.volunteer : undefined
          }))
        if (!members.length) return json({ error: 'No members in upload' }, 400)
        const saved = { fetchedAt: body.fetchedAt || new Date().toISOString(), uploadedAt: new Date().toISOString(), members }
        await store.setJSON('members', saved)
        // delete stored photos of members who have left or no longer consent
        const allowed = new Set(members.filter(m => m.photo).map(m => m.id))
        const { blobs = [] } = await store.list({ prefix: 'photo-' })
        let deleted = 0
        for (const b of blobs) {
          if (!allowed.has(b.key.slice('photo-'.length))) { await store.delete(b.key); deleted++ }
        }
        photoCache.clear()
        dbg('upload:members', { count: members.length, photosAllowed: allowed.size, photosDeleted: deleted })
        return json({ ok: true, count: members.length, photosDeleted: deleted, uploadedAt: saved.uploadedAt })
      }
      const body = await readJsonBody(req, 5_500_000)
      // only members on the uploaded list with photo consent may have a stored photo
      const current = await store.get('members', { type: 'json' })
      const allowed = new Set((current?.members || []).filter(m => m.photo).map(m => m.id))
      let stored = 0, removed = 0
      for (const [id, dataUrl] of Object.entries(body.photos || {})) {
        if (!/^\d+$/.test(id)) continue
        const m = allowed.has(id) && typeof dataUrl === 'string' && dataUrl.match(/^data:(image\/[a-z+.-]+);base64,([A-Za-z0-9+/=]+)$/)
        if (m) {
          const bytes = Buffer.from(m[2], 'base64')
          await store.set(`photo-${id}`, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), { metadata: { type: m[1] } })
          stored++
        } else {
          await store.delete(`photo-${id}`)
          removed++
        }
      }
      photoCache.clear()
      dbg('upload:photos', { stored, removed })
      return json({ ok: true, stored, removed })
    } catch (err) {
      dbg('upload:error', { step: err.step, message: err.message })
      return json({ error: err.message || 'Upload failed', step: err.step || 'unknown' }, err.step === 'upload' ? 400 : 500)
    }
  }

  // /api/members/photos-by-name?names=Kerry Tubby|Ben Tubby: photos for paddlers named as in
  // the race results (the race planner, which works from the results, not the member list).
  // Coaches and the race coordinator. Only members with photo consent; the member list
  // itself isn't sent. { photos: { "Kerry Tubby": "data:image/jpeg;base64,..." | null } }
  if (url.pathname === '/api/members/photos-by-name') {
    if (!signedInAs(req, 'coach') && !signedInAs(req, 'coordinator')) return json({ error: 'Not signed in' }, 401)
    const names = [...new Set((url.searchParams.get('names') || '').split('|').map(x => x.trim()).filter(Boolean))].slice(0, 60)
    if (!names.length) return json({ error: 'names required' }, 400)
    try {
      const uploaded = await readUploaded()
      const list = uploaded ? uploaded.members : (await getMembers()).members
      const allowed = await photoAllowed(uploaded)
      const photos = {}
      for (const name of names) {
        const m = list.find(m => sameRacer(m.name, name) || personKey(m.name) === personKey(name))
        if (!m || !(await allowed(m.id))) { photos[name] = null; continue }
        const p = uploaded ? await readUploadedPhoto(m.id) : await getPhoto(m.id)
        photos[name] = p.bytes ? `data:${p.type};base64,${p.bytes.toString('base64')}` : null
      }
      return new Response(JSON.stringify({ photos }), { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, max-age=3600' } })
    } catch (err) {
      return json({ error: err.message || 'Photo lookup failed', step: err.step || 'unknown' }, err.step === 'rate-limited' ? 429 : 502)
    }
  }

  const denied = checkCoach(req)
  if (denied) return denied
  dbg('auth:ok')
  const withTrace = body => (wantTrace ? { ...body, trace: traceLog } : body)

  // /api/board: the shared groups and roles. GET reads; POST { op } applies one change.
  if (url.pathname === '/api/board') {
    try {
      if (req.method === 'POST') {
        const body = await readJsonBody(req, 200_000)
        const board = await changeBoard(body.op || {})
        return json(board)
      }
      const { board } = await readBoard(await boardStore())
      return json(board)
    } catch (err) {
      dbg('board:error', { step: err.step, message: err.message })
      return json({ error: err.message || 'Board update failed', step: err.step || 'unknown' }, err.step === 'board' || err.step === 'upload' ? 400 : 500)
    }
  }

  // /api/members/photos?ids=1,2,3: many photos in one call (one sign-in), as
  // { photos: { id: "data:image/jpeg;base64,..." | null } }. The app uses this.
  if (url.pathname === '/api/members/photos') {
    const ids = [...new Set((url.searchParams.get('ids') || '').split(',').map(x => x.trim()).filter(x => /^\d+$/.test(x)))].slice(0, 60)
    if (!ids.length) return json({ error: 'ids required' }, 400)
    try {
      const photos = {}
      const uploaded = await readUploaded()
      const fromUpload = !!uploaded
      const allowed = await photoAllowed(uploaded)
      dbg('photos:source', { source: fromUpload ? 'upload' : 'live' })
      let i = 0
      const worker = async () => {
        while (i < ids.length) {
          const id = ids[i++]
          const p = !(await allowed(id)) ? { bytes: null } : fromUpload ? await readUploadedPhoto(id) : await getPhoto(id)
          photos[id] = p.bytes ? `data:${p.type};base64,${p.bytes.toString('base64')}` : null
        }
      }
      if (!fromUpload) await getSession() // sign in once before the parallel fetches
      await Promise.all(Array.from({ length: Math.min(6, ids.length) }, worker))
      dbg('photos:done', { requested: ids.length, withPhoto: Object.values(photos).filter(Boolean).length })
      return new Response(JSON.stringify(withTrace({ photos })), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, max-age=3600' }
      })
    } catch (err) {
      dbg('photos:error', { step: err.step, message: err.message })
      return json(withTrace({ error: err.message || 'Photo lookup failed', step: err.step || 'unknown' }), err.step === 'rate-limited' ? 429 : 502)
    }
  }

  // /api/members/photo/<id>: one member's MemberMojo photo, fetched with our session
  const photoId = (url.pathname.match(/^\/api\/members\/photo\/(\d+)$/) || [])[1]
  if (url.pathname.startsWith('/api/members/photo/')) {
    if (!photoId) return json({ error: 'Bad member id' }, 400)
    try {
      const uploaded = await readUploaded()
      const p = !(await (await photoAllowed(uploaded))(photoId)) ? { bytes: null }
        : uploaded ? await readUploadedPhoto(photoId) : await getPhoto(photoId)
      if (!p.bytes) return new Response(null, { status: 404, headers: { 'Cache-Control': 'private, max-age=3600' } })
      return new Response(p.bytes, {
        status: 200,
        // private: only this coach's browser caches it, for a day
        headers: { 'Content-Type': p.type, 'Cache-Control': 'private, max-age=86400' }
      })
    } catch (err) {
      dbg('photo:error', { id: photoId, step: err.step, message: err.message })
      return json({ error: err.message || 'Photo lookup failed', step: err.step || 'unknown' }, 502)
    }
  }

  try {
    // the copy uploaded by `npm run sync-members`, when there is one (see MEMBERS_SOURCE)
    const uploaded = await readUploaded()
    if (uploaded) {
      dbg('done', { source: 'upload', count: uploaded.members.length, fetchedAt: uploaded.fetchedAt })
      return json(withTrace({ source: 'upload', fetchedAt: uploaded.fetchedAt, uploadedAt: uploaded.uploadedAt, count: uploaded.members.length, members: uploaded.members }))
    }
    if (SOURCE() === 'upload') {
      return json(withTrace({ error: 'No member list uploaded yet: run `npm run sync-members` on your computer', step: 'upload' }), 503)
    }
    // ?fresh=1 skips both caches and logs in again
    const { members, at } = await getMembers(!!url.searchParams.get('fresh'))
    const coachWords = words('COACH_MATCH')
    const paddlerWords = words('PADDLER_MATCH')
    const list = members.map(m => ({
      id: m.id, name: m.name, url: m.url, photo: m.photo, junior: m.junior, coach: m.coach, volunteer: m.volunteer,
      role: m.coach ? 'coach' : guessRole(m.info, coachWords, paddlerWords)
    }))
    dbg('done', {
      count: list.length,
      coaches: list.filter(m => m.role === 'coach').length,
      paddlers: list.filter(m => m.role === 'paddler').length,
      unknownRole: list.filter(m => !m.role).length
    })
    return json(withTrace({ source: 'live', fetchedAt: new Date(at).toISOString(), count: list.length, members: list }))
  } catch (err) {
    dbg('error', { failedStep: err.step || 'unknown', message: err.message, stack: err.step ? undefined : err.stack?.split('\n').slice(0, 4) })
    // step + message only; never echo credentials or page contents
    return json(withTrace({ error: err.message || 'Lookup failed', step: err.step || 'unknown' }), 502)
  }
}

export const config = {
  path: ['/api/members', '/api/members/photos', '/api/members/photos-by-name', '/api/members/photo/*', '/api/members/upload', '/api/members/upload-photos', '/api/board']
}
