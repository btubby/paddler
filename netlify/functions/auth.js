// Sign in with Google, and the roles list.
//   POST   /api/auth/google  { credential }  the ID token from Google's button: checked, then a
//                            session cookie is set (netlify/edge-functions/lib/session.js)
//   POST   /api/auth/logout  forgets the session cookie
//   GET    /api/auth/roles   (admins) everyone who has a role, and the always-admin emails
//   PUT    /api/auth/roles   (admins) { email, roles: ['coach', ...] } sets one person's roles ([] removes them)
// Anyone with a Google account may sign in (and then see "Logged in as ..."), but roles come only
// from the list. Settings: GOOGLE_CLIENT_ID, SESSION_SECRET, ADMIN_EMAILS (see .env.example).
import { verifyGoogleToken } from './lib/google.js'
import { rolesFor, readTable, setRoles, adminEmails, normaliseEmail } from './lib/roles.js'
import { signSessionSync, sessionOf, sessionAllows, sessionCookie, clearSessionCookie, SESSION_DAYS, ROLE_NAMES } from './lib/session.js'

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store', ...headers } })

// the roles store (a test passes its own)
let override = null
export const _useStore = s => { override = s }
async function openStore() {
  if (override) return override
  const { getStore } = await import('@netlify/blobs')
  return getStore({ name: 'bscc-roles', consistency: 'strong' })
}

export default async req => {
  const url = new URL(req.url)
  const secure = url.protocol === 'https:'
  const path = url.pathname.replace(/\/+$/, '')

  if (path === '/api/auth/google' && req.method === 'POST') {
    const secret = process.env.SESSION_SECRET || ''
    if (!process.env.GOOGLE_CLIENT_ID || secret.length < 16) return json({ error: 'Google sign-in is not set up on the server yet' }, 500)
    if (!/application\/json/i.test(req.headers.get('content-type') || '')) return json({ error: 'Bad request' }, 400)
    let who
    try {
      const { credential } = await req.json()
      who = await verifyGoogleToken(credential, { clientId: process.env.GOOGLE_CLIENT_ID })
    } catch (e) {
      return json({ error: 'Could not sign you in with Google: ' + (e.message || 'try again') }, 401)
    }
    let table = {}
    try { table = await readTable(await openStore()) } catch { /* no list yet: only the always-admin emails have roles */ }
    const roles = rolesFor(who.email, table)
    const value = signSessionSync({ e: who.email, n: who.first, r: roles, x: Date.now() + SESSION_DAYS * 86400 * 1000 }, secret)
    return json({ email: who.email, name: who.first, roles }, 200, { 'Set-Cookie': sessionCookie(value, secure) })
  }

  if (path === '/api/auth/logout' && req.method === 'POST') {
    return json({ ok: true }, 200, { 'Set-Cookie': clearSessionCookie(secure) })
  }

  if (path === '/api/auth/roles') {
    if (!sessionAllows(sessionOf(req), 'admin')) return json({ error: 'Admins only: sign in with Google as an admin' }, 401)
    const store = await openStore()
    const me = sessionOf(req).email
    if (req.method === 'GET') {
      const table = await readTable(store)
      return json({
        people: Object.entries(table).map(([email, v]) => ({ email, roles: v.roles || [], addedBy: v.addedBy || '', at: v.at || '' })).sort((a, b) => a.email.localeCompare(b.email)),
        admins: adminEmails(), available: ROLE_NAMES
      })
    }
    if (req.method === 'PUT') {
      let body
      try { body = await req.json() } catch { return json({ error: 'Bad request' }, 400) }
      const email = normaliseEmail(body.email)
      // an admin can't remove their own admin role by accident and lock everyone out
      if (email === me && !(body.roles || []).includes('admin') && !adminEmails().includes(me)) return json({ error: 'You cannot take your own admin role away' }, 400)
      try { await setRoles(store, email, body.roles, me) } catch (e) { return json({ error: e.message }, 400) }
      return json({ ok: true })
    }
  }
  return json({ error: 'Not found' }, 404)
}

export const config = { path: ['/api/auth/google', '/api/auth/logout', '/api/auth/roles'] }
