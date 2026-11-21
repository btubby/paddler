// Strava: a paddler connects their own Strava account and sees charts of their own training
// (/my-training/). Strava's API terms only allow a person's Strava data to be shown to that
// person, so nothing here is shown to coaches or anyone else: the data is only ever sent to
// the browser that connected the account (a signed, http-only cookie says whose it is).
//
// Kept (Netlify Blobs, store "strava"), per athlete:
//   athlete-<id>  { id, name, tokens, session }   the Strava tokens (to read their activities)
//   acts-<id>     { fetchedAt, complete, activities: [...] }  activity summaries only: no
//                 GPS tracks, maps, photos, comments or followers
// Disconnecting deletes both and tells Strava to withdraw the app's access.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

export const STRAVA = {
  authorize: 'https://www.strava.com/oauth/authorize',
  token: 'https://www.strava.com/oauth/token',
  deauthorize: 'https://www.strava.com/oauth/deauthorize',
  api: 'https://www.strava.com/api/v3'
}
// read: their name; activity:read_all: their activities, including "only me" ones (ergo and
// gym sessions are often private)
export const SCOPE = 'read,activity:read_all'
// the club's Strava page (https://www.strava.com/clubs/stortcanoe): its numeric id is in the page's address
// for Strava's API. A member who has connected can see the club's latest activities (below).
export const CLUB = { id: process.env.STRAVA_CLUB_ID || '498340', url: 'https://www.strava.com/clubs/stortcanoe' }
export const COOKIE = 'bscc_strava'
export const STATE_COOKIE = 'bscc_strava_state'
export const YEARS_BACK = 5 // the first read goes back this far

export const configured = () => !!(process.env.STRAVA_CLIENT_ID && process.env.STRAVA_CLIENT_SECRET)
const key = () => 'bscc-strava-session:' + (process.env.STRAVA_CLIENT_SECRET || '')
const sign = body => createHmac('sha256', key()).update(body).digest('base64url').slice(0, 32)

export const newSession = () => randomBytes(18).toString('base64url')
// the cookie: "<athlete id>.<session>.<signature>"; the session is also kept with the athlete,
// so disconnecting (which deletes it) ends every browser's session
export function sessionCookie(id, session) {
  const body = `${id}.${session}`
  return `${body}.${sign(body)}`
}
export function readSessionCookie(value) {
  const m = String(value || '').match(/^(\d{1,15})\.([A-Za-z0-9_-]{10,60})\.([A-Za-z0-9_-]{32})$/)
  if (!m || !process.env.STRAVA_CLIENT_SECRET) return null
  const want = Buffer.from(sign(`${m[1]}.${m[2]}`))
  const got = Buffer.from(m[3])
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null
  return { id: m[1], session: m[2] }
}

export function cookieValue(req, name) {
  for (const part of (req.headers.get('cookie') || '').split(';')) {
    const i = part.indexOf('=')
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim()
  }
  return ''
}
export function setCookie(name, value, { maxAge, path = '/', secure = true } = {}) {
  return [`${name}=${value}`, `Path=${path}`, 'HttpOnly', 'SameSite=Lax', secure ? 'Secure' : '', maxAge != null ? `Max-Age=${maxAge}` : '']
    .filter(Boolean).join('; ')
}

export function authorizeUrl(origin, state) {
  const u = new URL(STRAVA.authorize)
  u.searchParams.set('client_id', process.env.STRAVA_CLIENT_ID)
  u.searchParams.set('redirect_uri', `${origin}/api/strava/callback`)
  u.searchParams.set('response_type', 'code')
  u.searchParams.set('approval_prompt', 'auto')
  u.searchParams.set('scope', SCOPE)
  u.searchParams.set('state', state)
  return u.toString()
}

// only what the charts use, from Strava's activity summary
export function trimActivity(a) {
  const n = v => (typeof v === 'number' && isFinite(v) ? +v.toFixed(2) : undefined)
  return {
    id: String(a.id),
    name: String(a.name || '').slice(0, 80),
    type: String(a.sport_type || a.type || 'Workout'),
    date: String(a.start_date_local || a.start_date || '').slice(0, 19), // their local time
    at: Math.floor(Date.parse(a.start_date || a.start_date_local) / 1000) || 0, // UTC seconds
    distance: n(a.distance) ?? 0, // m
    moving: n(a.moving_time) ?? 0, // s
    elapsed: n(a.elapsed_time),
    climb: n(a.total_elevation_gain),
    speed: n(a.average_speed), // m/s
    maxSpeed: n(a.max_speed),
    hr: n(a.average_heartrate),
    maxHr: n(a.max_heartrate),
    watts: n(a.average_watts),
    trainer: a.trainer ? true : undefined
  }
}

// One of the club's latest activities, as Strava gives it to a club member: who (first name and
// last initial: that is all Strava sends), what, how far and how long. No dates, routes or maps.
export function trimClubActivity(a) {
  const n = v => (typeof v === 'number' && isFinite(v) ? +v.toFixed(2) : undefined)
  const who = [a.athlete?.firstname, a.athlete?.lastname].filter(Boolean).join(' ').trim().slice(0, 40)
  return {
    who: who || 'A club member',
    name: String(a.name || '').slice(0, 80),
    type: String(a.sport_type || a.type || 'Workout'),
    distance: n(a.distance) ?? 0, // m
    moving: n(a.moving_time) ?? 0, // s
    climb: n(a.total_elevation_gain)
  }
}

// a fresh access token (Strava's last 6 hours; the refresh token gets a new one)
export async function accessToken(athlete, fetchFn = fetch) {
  const t = athlete.tokens
  if (t.access_token && t.expires_at * 1000 > Date.now() + 120e3) return { token: t.access_token, changed: false }
  const res = await fetchFn(STRAVA.token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: process.env.STRAVA_CLIENT_ID, client_secret: process.env.STRAVA_CLIENT_SECRET, grant_type: 'refresh_token', refresh_token: t.refresh_token })
  })
  if (!res.ok) throw Object.assign(new Error(`Strava token refresh failed (${res.status})`), { status: res.status })
  const body = await res.json()
  athlete.tokens = { access_token: body.access_token, refresh_token: body.refresh_token, expires_at: body.expires_at }
  return { token: body.access_token, changed: true }
}

// Adds their newest activities to what's kept (or reads back YEARS_BACK years the first time),
// a few pages per call so each request stays well inside the time limit:
// { activities, complete, added }. complete: the first read has reached YEARS_BACK (or their
// first activity); after that, each call only asks for what's newer.
export async function readActivities(cache, token, { fetchFn = fetch, now = Date.now(), pages = 4 } = {}) {
  const byId = new Map((cache.activities || []).map(a => [a.id, a]))
  const limit = Math.floor((now - YEARS_BACK * 365.25 * 864e5) / 1000)
  const ats = () => [...byId.values()].map(a => a.at).filter(Boolean)
  let complete = !!cache.complete
  let added = 0
  const get = async params => {
    const u = new URL(`${STRAVA.api}/athlete/activities`)
    u.searchParams.set('per_page', '200')
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v))
    const res = await fetchFn(u.toString(), { headers: { Authorization: `Bearer ${token}` } })
    if (res.status === 429) throw Object.assign(new Error('Strava is busy (rate limit): try again in 15 minutes'), { status: 429 })
    if (!res.ok) throw Object.assign(new Error(`Strava activities failed (${res.status})`), { status: res.status })
    const list = await res.json()
    let fresh = 0
    for (const a of list) {
      const t = trimActivity(a)
      if (!byId.has(t.id)) { fresh++; added++ }
      byId.set(t.id, t)
    }
    return { n: list.length, fresh }
  }
  if (!complete) {
    // walking back in time, newest first, from before the oldest kept so far
    for (let p = 0; p < pages; p++) {
      const have = ats()
      const { n, fresh } = await get(have.length ? { before: Math.min(...have) } : {})
      if (n < 200 || !fresh || Math.min(...ats()) < limit) { complete = true; break }
    }
  } else {
    // only what's newer than the newest kept (a minute's overlap; duplicates are dropped)
    const have = ats()
    const after = (have.length ? Math.max(...have) : limit) - 60
    for (let p = 1; p <= pages; p++) {
      const { n } = await get({ after, page: p })
      if (n < 200) break
    }
  }
  const activities = [...byId.values()].filter(a => !a.at || a.at >= limit).sort((a, b) => a.at - b.at)
  return { activities, complete, added }
}
