// The K1 / K2 planner's ratings and the club's K2 pairings over all the results, from
// /api/crews (netlify/functions/crews.js). Loaded once per page and shared by the planner
// and the K2 family tree. The first load ever reads every race since 2010 and takes a few
// minutes (the server answers { more: true } until it's done, then works out the ratings in
// the background, answering { more: true, working: true }); after that it's quick.
import { reactive } from 'vue'
import { sameRacer } from '../../../netlify/functions/lib/match.js'
import { personKey } from '../../../netlify/functions/lib/crewfit.js'

// read / total: races read so far (for the loading animation, LoadingRiver.vue); working:
// all read, the ratings being worked out
export const crews = reactive({ state: 'idle', progress: '', error: '', data: null, read: 0, total: 0, working: false })
let loading = null

export function loadCrews(club, { force = false } = {}) {
  if (loading) return loading
  if (crews.data && !force) return Promise.resolve(crews.data)
  loading = (async () => {
    crews.state = 'loading'
    crews.progress = ''
    crews.working = false
    crews.error = ''
    try {
      let body = null
      const started = Date.now()
      for (let round = 0; round < 200 && Date.now() - started < 10 * 60e3; round++) {
        const res = await fetch(`/api/crews?club=${encodeURIComponent(club)}`, { credentials: 'same-origin' })
        body = await res.json().catch(() => null)
        if (!res.ok) throw new Error(body?.detail || body?.error || `HTTP ${res.status}${res.status >= 500 ? ' (the server stopped: it may have run out of time)' : ''}`)
        if (!body?.more) break
        crews.read = body.racesChecked || 0
        crews.total = body.racesTotal || crews.total
        crews.working = !!body.working
        if (body.working) {
          // all the races are read; the ratings are being worked out in the background
          crews.progress = `all ${body.racesChecked} races read; working out the ratings (about a minute)`
          await new Promise(r => setTimeout(r, 4000))
        } else {
          crews.progress = `${body.racesChecked} of ${body.racesTotal} races read`
        }
      }
      if (body?.more) throw new Error('still reading results; try again in a minute')
      crews.data = body
      crews.state = 'ok'
      return body
    } catch (e) {
      crews.state = 'error'
      crews.error = e.message
      return null
    } finally {
      loading = null
    }
  })()
  return loading
}

// a board member and a name from the results are the same person ("Dave" for "David"
// and so on count as the same)
export function isNamed(member, names) {
  const own = member.fullName || member.name
  return names.some(n => sameRacer(own, n) || personKey(own) === personKey(n))
}

// K2 partnerships between people on the board: [{ a: id, b: id, races, first, last, list }]
// (list: each race they did together, newest first: { date, race, venue, event, pos, of })
export function boardPairs(people, pairs) {
  const out = []
  for (const x of pairs || []) {
    const pa = people.find(m => isNamed(m, x.a))
    const pb = people.find(m => isNamed(m, x.b))
    if (!pa || !pb || pa.id === pb.id) continue
    const same = out.find(o => (o.a === pa.id && o.b === pb.id) || (o.a === pb.id && o.b === pa.id))
    if (same) { // the same two under other spellings: add up
      same.races += x.races
      same.first = x.first < same.first ? x.first : same.first
      same.last = x.last > same.last ? x.last : same.last
      same.list = [...same.list, ...(x.list || [])].sort((p, q) => (p.date < q.date ? 1 : -1))
    } else out.push({ a: pa.id, b: pb.id, races: x.races, first: x.first, last: x.last, list: x.list || [] })
  }
  return out
}
