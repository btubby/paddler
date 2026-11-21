// GET /api/race-plan?club=BSF        the race line-up
// PUT /api/race-plan?club=BSF        save it: { race, date, notes, lineup, base }
// The race coordinator only (signed in with Google with the coordinator role, or an admin).
// One plan per club, kept in Netlify Blobs, so every coordinator sees the same line-up. Paddlers are
// named by their key from the race results (crewfit.js personKey, e.g. "kerry tubby"), not
// by MemberMojo ids: the page only uses public race results. Each save bumps a version; a save made from an older
// version than the one stored is refused (409, with the stored plan), so two coaches
// editing at once don't silently overwrite each other.
import { signedInAs } from './lib/access.js'

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' } })

const signedIn = req => signedInAs(req, 'coordinator')

async function openStore() {
  const { getStore } = await import('@netlify/blobs')
  return getStore({ name: 'race-plans', consistency: 'strong' })
}
// without Blobs (plain `vite`, tests): kept in memory for as long as the process lives
const memory = new Map()
const memStore = { get: async k => memory.get(k) ?? null, setJSON: async (k, v) => { memory.set(k, v) } }

const SEATS = { K1: 1, K2: 2, C1: 1, C2: 2 } // kayaks and canoes: seats in each
// a paddler's key from the results: letters, spaces, apostrophes and hyphens
const ID = /^[a-z][a-z' -]{1,59}$/
const text = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
// only ids and boat shapes are kept: names and ratings are looked up on the page
export function cleanPlan(body) {
  const lineup = body?.lineup || {}
  const boats = (Array.isArray(lineup.boats) ? lineup.boats : []).slice(0, 200).map(b => ({
    id: text(b?.id, 40) || 'b',
    kind: SEATS[b?.kind] ? b.kind : 'K1',
    seats: (Array.isArray(b?.seats) ? b.seats : []).slice(0, SEATS[b?.kind] || 1).map(x => (ID.test(String(x)) ? String(x) : null))
  }))
  const out = (Array.isArray(lineup.out) ? lineup.out : []).map(String).filter(x => ID.test(x)).slice(0, 1000)
  const suggested = (Array.isArray(lineup.suggested) ? lineup.suggested : []).map(String).filter(k => /^K[12]:[a-z][a-z' -]{1,59}(\+[a-z][a-z' -]{1,59})?$/.test(k)).slice(0, 400)
  // the coordinator's rules: { kind: 'together' | 'apart', a, b } or { kind: 'K1' | 'K2', a }
  const rules = (Array.isArray(body?.rules) ? body.rules : []).slice(0, 100).flatMap(r => {
    const kind = String(r?.kind)
    const a = String(r?.a ?? '')
    const b = String(r?.b ?? '')
    if (!ID.test(a)) return []
    if (kind === 'K1' || kind === 'K2') return [{ kind, a }]
    if ((kind === 'together' || kind === 'apart') && ID.test(b) && a !== b) return [{ kind, a, b }]
    return []
  })
  return {
    rules,
    familiar: body?.familiar !== false,
    learning: body?.learning === true,
    race: text(body?.race, 80),
    date: /^\d{4}-\d{2}-\d{2}$/.test(String(body?.date || '')) ? body.date : '',
    notes: text(body?.notes, 500),
    lineup: { boats, out, suggested }
  }
}

export default async (req) => {
  if (!signedIn(req)) return json({ error: 'Not signed in: sign in with Google as the race coordinator' }, 401)
  const club = String(new URL(req.url).searchParams.get('club') || '').trim().toUpperCase()
  if (!/^[A-Z]{2,5}$/.test(club)) return json({ error: 'club is required, e.g. ?club=BSF' }, 400)
  let st = memStore
  try { st = await openStore(); await st.get('probe') } catch { st = memStore }
  const key = `plan-${club}`
  try {
    const stored = await st.get(key, { type: 'json' })
    if (req.method === 'GET') return json({ ...(stored || { version: 0, plan: null }), canEdit: signedIn(req) })
    if (req.method !== 'PUT') return json({ error: 'GET or PUT' }, 405)
    const body = await req.json().catch(() => null)
    if (!body) return json({ error: 'Send the plan as JSON' }, 400)
    const version = stored?.version || 0
    if (Number(body.base ?? -1) !== version) return json({ error: 'Someone else has saved a newer line-up', current: stored }, 409)
    const saved = { version: version + 1, savedAt: new Date().toISOString(), plan: cleanPlan(body) }
    await st.setJSON(key, saved)
    return json(saved)
  } catch (err) {
    return json({ error: 'Race plan failed', detail: String(err.message || err) }, 502)
  }
}

export const config = { path: '/api/race-plan' }
