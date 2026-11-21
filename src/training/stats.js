// Turns a paddler's Strava activities (summaries from /api/strava/activities) into what the
// /my-training/ charts show. Pure functions, so they're tested on their own.

// what kind of training each activity was
export const GROUPS = [
  { key: 'paddle', label: 'Paddling', color: 'var(--teal)' },
  { key: 'ergo', label: 'Ergo', color: 'var(--clay)' },
  { key: 'gym', label: 'Gym and strength', color: 'var(--gold)' },
  { key: 'run', label: 'Running', color: '#7b5ea7' },
  { key: 'ride', label: 'Cycling', color: '#4f8fbf' },
  { key: 'other', label: 'Other', color: 'var(--muted)' }
]
const PADDLE = /^(Kayaking|Canoeing|StandUpPaddling)$/
const ERGO_NAME = /\b(k-?ergo|ergo|erg|paddle ?machine|kayak machine)\b/i
export function groupOf(a) {
  const type = String(a.type || '')
  if (PADDLE.test(type)) return a.trainer || ERGO_NAME.test(a.name || '') ? 'ergo' : 'paddle'
  if (/^(Rowing|VirtualRow)$/.test(type) || ERGO_NAME.test(a.name || '')) return 'ergo'
  if (/^(WeightTraining|Workout|Crossfit|HighIntensityIntervalTraining|Pilates|Yoga|StairStepper|Elliptical)$/.test(type)) return 'gym'
  if (/Run$/.test(type)) return 'run'
  if (/Ride$/.test(type) || type === 'Velomobile' || type === 'Handcycle') return 'ride'
  return 'other'
}

const DAY = 864e5
const ts = a => Date.parse(String(a.date).slice(0, 10) + 'T00:00:00Z') // their local day
const mondayOf = t => { const d = new Date(t); const back = (d.getUTCDay() + 6) % 7; return t - back * DAY }
const iso = t => new Date(t).toISOString().slice(0, 10)

export const inRange = (activities, from) => activities.filter(a => ts(a) >= from)

// hours of each kind of training, week by week (weeks start on Monday)
export function weekly(activities, from, now = Date.now()) {
  const start = mondayOf(Date.parse(iso(from) + 'T00:00:00Z'))
  const end = mondayOf(Date.parse(iso(now) + 'T00:00:00Z'))
  const weeks = []
  for (let t = start; t <= end; t += 7 * DAY) weeks.push({ start: iso(t), hours: Object.fromEntries(GROUPS.map(g => [g.key, 0])), total: 0, sessions: 0 })
  const at = new Map(weeks.map((w, i) => [w.start, i]))
  for (const a of activities) {
    const i = at.get(iso(mondayOf(ts(a))))
    if (i == null) continue
    const h = (a.moving || 0) / 3600
    weeks[i].hours[groupOf(a)] += h
    weeks[i].total += h
    weeks[i].sessions++
  }
  return weeks
}

// km paddled (on the water) and on the ergo, month by month
export function monthly(activities, from, now = Date.now()) {
  const months = []
  const d = new Date(from)
  let y = d.getUTCFullYear(), m = d.getUTCMonth()
  const endKey = iso(now).slice(0, 7)
  for (;;) {
    const key = `${y}-${String(m + 1).padStart(2, '0')}`
    months.push({ month: key, paddle: 0, ergo: 0 })
    if (key >= endKey || months.length > 240) break
    if (++m > 11) { m = 0; y++ }
  }
  const at = new Map(months.map((x, i) => [x.month, i]))
  for (const a of activities) {
    const g = groupOf(a)
    if (g !== 'paddle' && g !== 'ergo') continue
    const i = at.get(String(a.date).slice(0, 7))
    if (i != null) months[i][g] += (a.distance || 0) / 1000
  }
  return months
}

// on-the-water paddling speed (km/h), session by session, with a smoothed trend. Short
// paddles (under 2 km) and ones without a speed are left out: warm-ups, coaching sessions
// standing in a boat, GPS left running...
export function paddleSpeeds(activities) {
  const pts = activities
    .filter(a => groupOf(a) === 'paddle' && a.speed > 0.5 && a.speed < 7 && (a.distance || 0) >= 2000)
    .map(a => ({ id: a.id, date: String(a.date).slice(0, 10), name: a.name, kmh: a.speed * 3.6, km: a.distance / 1000, moving: a.moving, hr: a.hr }))
  return { points: pts, trend: smooth(pts, 'kmh') }
}
// a Gaussian-weighted average of the speeds around each point (about 6 weeks wide)
export function smooth(pts, key = 'kmh', days = 21) {
  if (pts.length < 4) return []
  const t = pts.map(p => Date.parse(p.date))
  const out = []
  const first = Math.min(...t), last = Math.max(...t)
  const step = Math.max(DAY * 3, (last - first) / 120)
  for (let x = first; x <= last + 1; x += step) {
    let w = 0, s = 0
    pts.forEach((p, i) => { const k = Math.exp(-(((t[i] - x) / (days * DAY)) ** 2) / 2); w += k; s += k * p[key] })
    if (w > 0.6) out.push({ date: iso(x), [key]: s / w })
  }
  return out
}

// heart rate, session by session: the average for each session (and its highest), for sessions
// of 10 minutes or more recorded with a heart rate. One trend for paddling on the water, and
// the typical numbers for each kind of training.
export function heartRates(activities) {
  const pts = activities
    .filter(a => a.hr > 30 && a.hr < 230 && (a.moving || 0) >= 600)
    .map(a => ({ id: a.id, date: String(a.date).slice(0, 10), name: a.name, group: groupOf(a), hr: a.hr, maxHr: a.maxHr > a.hr ? a.maxHr : undefined, moving: a.moving, km: (a.distance || 0) / 1000, kmh: a.speed ? a.speed * 3.6 : undefined }))
  const median = xs => { const v = [...xs].sort((a, b) => a - b); return v.length ? (v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2) : null }
  const byGroup = GROUPS.map(g => ({ ...g, n: pts.filter(p => p.group === g.key).length, avg: median(pts.filter(p => p.group === g.key).map(p => p.hr)) })).filter(g => g.n)
  const maxes = pts.map(p => p.maxHr).filter(Boolean)
  return {
    points: pts,
    trend: smooth(pts.filter(p => p.group === 'paddle'), 'hr'),
    byGroup,
    highest: maxes.length ? Math.max(...maxes) : null,
    // how many paddling sessions have a heart rate: the rest were recorded without one
    paddlesWithHr: pts.filter(p => p.group === 'paddle').length
  }
}

export function summary(activities, now = Date.now()) {
  const since = days => activities.filter(a => ts(a) >= now - days * DAY)
  const hours = list => list.reduce((s, a) => s + (a.moving || 0), 0) / 3600
  const last4 = since(28)
  const last12 = since(84)
  const year = String(new Date(now).getUTCFullYear())
  const paddles = activities.filter(a => groupOf(a) === 'paddle')
  const longest = paddles.reduce((m, a) => (!m || a.distance > m.distance ? a : m), null)
  return {
    hours4: hours(last4), sessions4: last4.length,
    perWeek12: hours(last12) / 12,
    paddleKmYear: paddles.filter(a => String(a.date).startsWith(year)).reduce((s, a) => s + a.distance / 1000, 0),
    ergoSessions12: last12.filter(a => groupOf(a) === 'ergo').length,
    longest
  }
}

export const fmtHours = h => {
  const mins = Math.round(h * 60)
  return mins < 60 ? `${mins} min` : `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m`
}

// example data for ?demo (and the page's look before Strava is set up): two years of a club
// paddler's training, made up
export function demoActivities(now = Date.now()) {
  let seed = 11
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  const out = []
  for (let d = 730; d >= 0; d--) {
    const t = now - d * DAY
    const day = new Date(t).getUTCDay()
    const winter = [10, 11, 0, 1].includes(new Date(t).getUTCMonth())
    const fitness = 1 - d / 2400 // slowly getting quicker
    const add = (type, km, kmh, extra = {}) => {
      const speed = kmh / 3.6
      out.push({ id: String(1e9 + out.length), name: extra.name || type, type, date: new Date(t).toISOString().slice(0, 10) + 'T18:30:00', at: Math.floor(t / 1000), distance: km * 1000, moving: (km * 1000) / speed, speed, hr: 128 + rnd() * 25, maxHr: 150 + rnd() * 30, ...extra })
    }
    if ((day === 2 || day === 4) && rnd() < 0.85) add('Kayaking', 8 + rnd() * 4, (9.6 + rnd() * 1.1) * fitness * (winter ? 0.96 : 1), { name: day === 2 ? 'Club session' : 'Intervals' })
    if (day === 0 && rnd() < 0.7) add('Kayaking', 14 + rnd() * 10, (9.2 + rnd() * 0.9) * fitness, { name: 'Long steady paddle' })
    if (day === 1 && (winter ? rnd() < 0.8 : rnd() < 0.3)) add('Kayaking', 7 + rnd() * 2, 10.5, { name: 'K ergo pyramid', trainer: true })
    if (day === 3 && rnd() < 0.6) out.push({ id: String(1e9 + out.length), name: 'Club gym', type: 'WeightTraining', date: new Date(t).toISOString().slice(0, 10) + 'T19:00:00', at: Math.floor(t / 1000), distance: 0, moving: 2700 + rnd() * 900 })
    if (day === 6 && rnd() < 0.4) add('Run', 5 + rnd() * 5, 10.5 + rnd(), { name: 'parkrun' })
  }
  return out
}
