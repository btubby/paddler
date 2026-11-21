// Strava (see lib/strava.js for what's kept and who sees it):
//   GET  /api/strava/connect     to Strava, to allow the club site to read their activities
//   GET  /api/strava/callback    back from Strava: keeps the tokens, signs this browser in
//   GET  /api/strava/activities  their activities (summaries), for the charts on /my-training/
//   GET  /api/strava/club        the club's latest activities (members who have connected only)
//   POST /api/strava/disconnect  withdraw access and delete everything kept
// Needs STRAVA_CLIENT_ID and STRAVA_CLIENT_SECRET (from the club's Strava API application).
import {
  configured, authorizeUrl, newSession, sessionCookie, readSessionCookie, cookieValue, setCookie,
  accessToken, readActivities, trimClubActivity, CLUB, STRAVA, COOKIE, STATE_COOKIE
} from './lib/strava.js'
import { randomBytes } from 'node:crypto'

const json = (body, status = 200, cookies = []) => {
  const headers = new Headers({ 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' })
  for (const c of cookies) headers.append('Set-Cookie', c)
  return new Response(JSON.stringify(body), { status, headers })
}
const redirect = (to, cookies = []) => {
  const headers = new Headers({ Location: to, 'Cache-Control': 'no-store' })
  for (const c of cookies) headers.append('Set-Cookie', c)
  return new Response(null, { status: 302, headers })
}

async function openStore() {
  const { getStore } = await import('@netlify/blobs')
  return getStore({ name: 'strava', consistency: 'strong' })
}
const memory = new Map()
export const memStore = {
  get: async k => memory.get(k) ?? null,
  setJSON: async (k, v) => { memory.set(k, v) },
  delete: async k => { memory.delete(k) }
}
let storeOverride = null
export const useStore = s => { storeOverride = s } // tests
async function store() {
  if (storeOverride) return storeOverride
  try { const st = await openStore(); await st.get('probe'); return st } catch { return memStore }
}

const SESSION_DAYS = 180
const FRESH_MINUTES = 15 // activities are read again from Strava after this

export function makeHandler({ fetchFn = fetch } = {}) {
  return async req => {
    const url = new URL(req.url)
    const secure = url.protocol === 'https:'
    const page = `${url.origin}/my-training/`
    const route = url.pathname.replace(/^\/api\/strava\/?/, '')
    if (!configured()) return route === 'connect' || route === 'callback' ? redirect(`${page}?error=not-set-up`) : json({ error: 'not-set-up' }, 503)
    const st = await store()

    if (route === 'connect') {
      const state = randomBytes(16).toString('base64url')
      return redirect(authorizeUrl(url.origin, state), [setCookie(STATE_COOKIE, state, { maxAge: 600, path: '/api/strava', secure })])
    }

    if (route === 'callback') {
      const clear = setCookie(STATE_COOKIE, '', { maxAge: 0, path: '/api/strava', secure })
      const state = url.searchParams.get('state') || ''
      if (!state || state !== cookieValue(req, STATE_COOKIE)) return redirect(`${page}?error=expired`, [clear])
      if (url.searchParams.get('error')) return redirect(`${page}?error=denied`, [clear])
      const scope = url.searchParams.get('scope') || ''
      if (!/activity:read/.test(scope)) return redirect(`${page}?error=scope`, [clear])
      const res = await fetchFn(STRAVA.token, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: process.env.STRAVA_CLIENT_ID, client_secret: process.env.STRAVA_CLIENT_SECRET, code: url.searchParams.get('code') || '', grant_type: 'authorization_code' })
      })
      if (!res.ok) return redirect(`${page}?error=strava`, [clear])
      const body = await res.json()
      const id = String(body.athlete?.id || '')
      if (!/^\d+$/.test(id)) return redirect(`${page}?error=strava`, [clear])
      const session = newSession()
      const name = [body.athlete?.firstname, body.athlete?.lastname].filter(Boolean).join(' ').slice(0, 80)
      await st.setJSON(`athlete-${id}`, {
        id, name, session, scope, connectedAt: new Date().toISOString(),
        tokens: { access_token: body.access_token, refresh_token: body.refresh_token, expires_at: body.expires_at }
      })
      return redirect(page, [clear, setCookie(COOKIE, sessionCookie(id, session), { maxAge: SESSION_DAYS * 86400, path: '/api/strava', secure })])
    }

    // the rest: only for the browser that connected the account
    const who = readSessionCookie(cookieValue(req, COOKIE))
    const athlete = who && (await st.get(`athlete-${who.id}`, { type: 'json' }))
    const signedOut = setCookie(COOKIE, '', { maxAge: 0, path: '/api/strava', secure })
    if (!athlete || athlete.session !== who.session) return json({ connected: false }, 200, who ? [signedOut] : [])

    if (route === 'disconnect') {
      if (req.method !== 'POST') return json({ error: 'POST' }, 405)
      try {
        const { token } = await accessToken(athlete, fetchFn)
        await fetchFn(STRAVA.deauthorize, { method: 'POST', headers: { Authorization: `Bearer ${token}` } })
      } catch {} // deleted here either way; they can also remove the app in Strava's settings
      await st.delete(`athlete-${athlete.id}`)
      await st.delete(`acts-${athlete.id}`)
      await st.delete(`club-${athlete.id}`)
      return json({ connected: false, disconnected: true }, 200, [signedOut])
    }

    if (route === 'activities') {
      const cache = (await st.get(`acts-${athlete.id}`, { type: 'json' })) || { activities: [], complete: false }
      const fresh = cache.fetchedAt && Date.now() - Date.parse(cache.fetchedAt) < FRESH_MINUTES * 60e3
      const me = { id: athlete.id, name: athlete.name }
      if (fresh && cache.complete && url.searchParams.get('refresh') !== '1') return json({ connected: true, athlete: me, ...cache })
      try {
        const { token, changed } = await accessToken(athlete, fetchFn)
        if (changed) await st.setJSON(`athlete-${athlete.id}`, athlete)
        const got = await readActivities(cache, token, { fetchFn })
        const saved = { fetchedAt: new Date().toISOString(), complete: got.complete, activities: got.activities }
        await st.setJSON(`acts-${athlete.id}`, saved)
        return json({ connected: true, athlete: me, ...saved, more: !got.complete })
      } catch (err) {
        // Strava withdrew access (removed in their Strava settings): sign this browser out
        if (err.status === 400 || err.status === 401) {
          await st.delete(`athlete-${athlete.id}`)
          return json({ connected: false, error: 'Strava access has been withdrawn: connect again to see your training' }, 200, [signedOut])
        }
        // what's kept so far, with the reason it couldn't be brought up to date
        return json({ connected: true, athlete: me, ...cache, stale: true, error: String(err.message || err) })
      }
    }
    // the club's latest activities, for a member who has connected: what Strava shows any member
    // of the club (first name and last initial, the activity, distance, time). Kept 15 minutes
    // under this athlete only (not shared between people), and deleted when they disconnect.
    if (route === 'club') {
      const cache = await st.get(`club-${athlete.id}`, { type: 'json' })
      if (cache && Date.now() - Date.parse(cache.fetchedAt) < FRESH_MINUTES * 60e3) return json({ connected: true, member: true, url: CLUB.url, ...cache })
      try {
        const { token, changed } = await accessToken(athlete, fetchFn)
        if (changed) await st.setJSON(`athlete-${athlete.id}`, athlete)
        const res = await fetchFn(`${STRAVA.api}/clubs/${encodeURIComponent(CLUB.id)}/activities?per_page=60`, { headers: { Authorization: `Bearer ${token}` } })
        // Strava only answers members of the club
        if (res.status === 403 || res.status === 404) return json({ connected: true, member: false, url: CLUB.url })
        if (res.status === 429) return json({ connected: true, error: 'Strava is busy: try again in a few minutes', url: CLUB.url })
        if (res.status === 401) throw Object.assign(new Error('Strava refused'), { status: 401 })
        if (!res.ok) throw new Error(`Strava answered ${res.status}`)
        const list = await res.json()
        const saved = { fetchedAt: new Date().toISOString(), activities: (Array.isArray(list) ? list : []).map(trimClubActivity) }
        await st.setJSON(`club-${athlete.id}`, saved)
        return json({ connected: true, member: true, url: CLUB.url, ...saved })
      } catch (err) {
        if (err.status === 400 || err.status === 401) {
          await st.delete(`athlete-${athlete.id}`)
          return json({ connected: false, error: 'Strava access has been withdrawn: connect again' }, 200, [signedOut])
        }
        return json({ connected: true, error: String(err.message || err), url: CLUB.url })
      }
    }
    return json({ error: 'not found' }, 404)
  }
}

export default makeHandler()
export const config = { path: ['/api/strava/*'] }
