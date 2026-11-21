import test from 'node:test'
import assert from 'node:assert/strict'

process.env.STRAVA_CLIENT_ID = '12345'
process.env.STRAVA_CLIENT_SECRET = 'test-secret'
const { makeHandler, memStore, useStore } = await import('../netlify/functions/strava.js')
const { sessionCookie, readSessionCookie, trimActivity } = await import('../netlify/functions/lib/strava.js')
const stats = await import('../src/training/stats.js')
useStore(memStore)

// a pretend Strava: tokens, and an athlete with 450 activities (so reading them takes pages)
function fakeStrava() {
  const calls = []
  const acts = Array.from({ length: 450 }, (_, i) => {
    const at = Date.parse('2026-10-01T07:00:00Z') - i * 3 * 864e5
    return { id: 9000 + i, name: i % 7 ? 'Paddle' : 'K ergo', sport_type: 'Kayaking', start_date: new Date(at).toISOString(), start_date_local: new Date(at).toISOString().slice(0, 19), distance: 10000, moving_time: 3600, average_speed: 2.78, map: { summary_polyline: 'secret-route' }, trainer: i % 7 === 0 }
  })
  const fetchFn = async (url, opts = {}) => {
    calls.push({ url: String(url), opts })
    const u = new URL(url)
    const ok = body => ({ ok: true, status: 200, json: async () => body })
    if (u.pathname === '/oauth/token') {
      const p = new URLSearchParams(opts.body)
      if (p.get('grant_type') === 'authorization_code' && p.get('code') === 'good') return ok({ access_token: 'acc1', refresh_token: 'ref1', expires_at: Math.floor(Date.now() / 1000) + 21600, athlete: { id: 742265, firstname: 'Ben', lastname: 'Tubby' } })
      return { ok: false, status: 400, json: async () => ({}) }
    }
    if (u.pathname === '/oauth/deauthorize') return ok({})
    if (u.pathname === '/api/v3/athlete/activities') {
      assert.equal(opts.headers.Authorization, 'Bearer acc1')
      const before = +u.searchParams.get('before') || Infinity
      const after = +u.searchParams.get('after') || 0
      const page = +u.searchParams.get('page') || 1
      const list = acts.filter(a => { const t = Date.parse(a.start_date) / 1000; return t < before && t > after })
      return ok(list.slice((page - 1) * 200, page * 200))
    }
    throw new Error('unexpected ' + url)
  }
  return { fetchFn, calls }
}
const req = (path, { cookie = '', method = 'GET' } = {}) => new Request('https://bscc.example' + path, { method, headers: { cookie } })
const cookiesOf = res => res.headers.getSetCookie().map(c => c.split(';')[0])

test('session cookies are signed: an altered or made-up one is refused', () => {
  const c = sessionCookie('742265', 'abcdefghijklmnop')
  assert.deepEqual(readSessionCookie(c), { id: '742265', session: 'abcdefghijklmnop' })
  assert.equal(readSessionCookie(c.replace('742265', '742266')), null)
  assert.equal(readSessionCookie('742265.abcdefghijklmnop.' + 'A'.repeat(32)), null)
  assert.equal(readSessionCookie(''), null)
})

test('only summaries are kept from an activity: no map or route', () => {
  const t = trimActivity({ id: 1, name: 'x', sport_type: 'Kayaking', start_date: '2026-01-01T08:00:00Z', distance: 5000, moving_time: 1800, map: { summary_polyline: 'abc' }, start_latlng: [51.8, 0.15] })
  assert.equal(JSON.stringify(t).includes('abc'), false)
  assert.equal('start_latlng' in t || 'map' in t, false)
})

test('Strava: connect, read the activities a few pages at a time, only for that browser, then disconnect', async () => {
  const { fetchFn } = fakeStrava()
  const handler = makeHandler({ fetchFn })
  // not connected yet
  assert.equal((await (await handler(req('/api/strava/activities'))).json()).connected, false)
  // connect: off to Strava with a state, kept in a cookie
  const go = await handler(req('/api/strava/connect'))
  assert.equal(go.status, 302)
  const to = new URL(go.headers.get('location'))
  assert.equal(to.host, 'www.strava.com')
  assert.equal(to.searchParams.get('redirect_uri'), 'https://bscc.example/api/strava/callback')
  const state = to.searchParams.get('state')
  const stateCookie = cookiesOf(go)[0]
  // back from Strava without the matching state (someone else's link): refused
  const forged = await handler(req(`/api/strava/callback?state=${state}&code=good&scope=read,activity:read_all`))
  assert.match(forged.headers.get('location'), /error=expired/)
  // the real one
  const back = await handler(req(`/api/strava/callback?state=${state}&code=good&scope=read,activity:read_all`, { cookie: stateCookie }))
  assert.equal(back.headers.get('location'), 'https://bscc.example/my-training/')
  const session = cookiesOf(back).find(c => c.startsWith('bscc_strava='))
  assert.ok(session && back.headers.getSetCookie().some(c => /bscc_strava=.*HttpOnly/.test(c)))
  // reads in pages until all 450 are in
  let body
  for (let i = 0; i < 5; i++) {
    body = await (await handler(req('/api/strava/activities', { cookie: session }))).json()
    if (!body.more) break
  }
  assert.equal(body.connected, true)
  assert.equal(body.athlete.name, 'Ben Tubby')
  assert.equal(body.activities.length, 450)
  assert.equal(JSON.stringify(body).includes('secret-route'), false)
  assert.equal(JSON.stringify(body).includes('acc1'), false) // tokens never go to the browser
  // another browser (no cookie, or a made-up one): nothing
  assert.equal((await (await handler(req('/api/strava/activities'))).json()).connected, false)
  assert.equal((await (await handler(req('/api/strava/activities', { cookie: 'bscc_strava=742265.zzzzzzzzzzzzzzzzzzzz.' + 'B'.repeat(32) }))).json()).connected, false)
  // disconnect: everything kept is deleted, and the old cookie stops working
  const off = await handler(req('/api/strava/disconnect', { method: 'POST', cookie: session }))
  assert.equal((await off.json()).disconnected, true)
  assert.equal(await memStore.get('athlete-742265'), null)
  assert.equal(await memStore.get('acts-742265'), null)
  assert.equal((await (await handler(req('/api/strava/activities', { cookie: session }))).json()).connected, false)
})

test('Strava club feed: only a connected browser, who + what + how far only, kept per athlete, member or not', async () => {
  const base = fakeStrava()
  let member = true
  let hits = 0
  const fetchFn = async (url, opts = {}) => {
    const u = new URL(url)
    if (u.pathname === '/api/v3/clubs/498340/activities') {
      hits++
      assert.equal(opts.headers.Authorization, 'Bearer acc1')
      if (!member) return { ok: false, status: 403, json: async () => ({}) }
      return { ok: true, status: 200, json: async () => [{ athlete: { firstname: 'Sam', lastname: 'L.' }, name: 'Morning paddle', sport_type: 'Kayaking', distance: 12000, moving_time: 4000, total_elevation_gain: 0, start_latlng: [51.8, 0.15], map: { summary_polyline: 'secret-route' } }] }
    }
    return base.fetchFn(url, opts)
  }
  const handler = makeHandler({ fetchFn })
  assert.equal((await (await handler(req('/api/strava/club'))).json()).connected, false)
  const go = await handler(req('/api/strava/connect'))
  const state = new URL(go.headers.get('location')).searchParams.get('state')
  const back = await handler(req(`/api/strava/callback?state=${state}&code=good&scope=read,activity:read_all`, { cookie: cookiesOf(go)[0] }))
  const session = cookiesOf(back).find(c => c.startsWith('bscc_strava='))
  let body = await (await handler(req('/api/strava/club', { cookie: session }))).json()
  assert.equal(body.member, true)
  assert.deepEqual(body.activities.map(a => [a.who, a.type, a.distance]), [['Sam L.', 'Kayaking', 12000]])
  assert.equal(JSON.stringify(body).includes('secret-route') || JSON.stringify(body).includes('acc1'), false)
  await handler(req('/api/strava/club', { cookie: session })) // kept 15 minutes: no second call to Strava
  assert.equal(hits, 1)
  assert.ok(await memStore.get('club-742265'))
  // not a member of the club: told so, nothing kept
  await memStore.delete('club-742265')
  member = false
  body = await (await handler(req('/api/strava/club', { cookie: session }))).json()
  assert.equal(body.member, false)
  assert.equal(await memStore.get('club-742265'), null)
  // disconnect deletes the copy
  member = true
  await handler(req('/api/strava/club', { cookie: session }))
  await handler(req('/api/strava/disconnect', { method: 'POST', cookie: session }))
  assert.equal(await memStore.get('club-742265'), null)
})

test('training charts: kinds of training, weekly hours and paddling speeds', () => {
  assert.equal(stats.groupOf({ type: 'Kayaking' }), 'paddle')
  assert.equal(stats.groupOf({ type: 'Kayaking', trainer: true }), 'ergo')
  assert.equal(stats.groupOf({ type: 'Workout', name: 'K-ergo 10 x 1 min' }), 'ergo')
  assert.equal(stats.groupOf({ type: 'WeightTraining', name: 'Club gym' }), 'gym')
  assert.equal(stats.groupOf({ type: 'TrailRun' }), 'run')
  const now = Date.parse('2026-10-22T12:00:00Z')
  const acts = [
    { id: '1', type: 'Kayaking', date: '2026-10-20T18:00:00', moving: 3600, distance: 10000, speed: 2.78 },
    { id: '2', type: 'Kayaking', trainer: true, date: '2026-10-21T18:00:00', moving: 1800, distance: 5000, speed: 2.78 },
    { id: '3', type: 'Kayaking', date: '2026-10-13T18:00:00', moving: 600, distance: 1500, speed: 2.5 } // short: not on the speed chart
  ]
  const weeks = stats.weekly(acts, Date.parse('2026-10-12'), now)
  assert.equal(weeks.length, 2)
  assert.equal(weeks[1].start, '2026-10-19')
  assert.equal(weeks[1].hours.paddle, 1)
  assert.equal(weeks[1].hours.ergo, 0.5)
  const sp = stats.paddleSpeeds(acts)
  assert.equal(sp.points.length, 1)
  assert.ok(Math.abs(sp.points[0].kmh - 10) < 0.01)
  const months = stats.monthly(acts, Date.parse('2026-09-01'), now)
  assert.deepEqual(months.map(m => m.month), ['2026-09', '2026-10'])
  assert.equal(months[1].paddle, 11.5)
  assert.ok(stats.demoActivities(now).length > 200)
})

// ---- a Strava download (archive zip / activities.csv), read in the browser ----
const exp = await import('../src/training/stravaExport.js')
const { deflateRawSync } = await import('node:zlib')

// Strava's activities.csv: some names twice (first in the athlete's units, then in metres/seconds)
const CSV = [
  '"Activity ID","Activity Date","Activity Name","Activity Type","Activity Description","Elapsed Time","Distance","Max Heart Rate","Relative Effort","Commute","Elapsed Time","Moving Time","Distance","Max Speed","Average Speed","Elevation Gain","Average Heart Rate"',
  '"101","Oct 20, 2026, 5:30:00 PM","Club session, intervals","Kayaking","4 x 5 min, then ""steady""\nback home","3700","10.00","171","40","false","3700","3600","10000.0","4.1","2.7777","2","148"',
  '"102","Oct 21, 2026, 6:00:00 PM","K ergo pyramid","Workout","","1800","5.00","","","false","1800","1800","5000.0","","2.7777","",""',
  '"103","Oct 22, 2026, 7:15:00 AM","Gym","Weight Training","","2700","0","","","false","2700","2700","0","","","",""'
].join('\n')

function zip(files) {
  const parts = [], dir = []
  let off = 0
  for (const [name, text] of Object.entries(files)) {
    const data = Buffer.from(text), comp = deflateRawSync(data), nm = Buffer.from(name)
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(8, 8); local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nm.length, 26)
    const cen = Buffer.alloc(46); cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(8, 10); cen.writeUInt32LE(comp.length, 20); cen.writeUInt32LE(data.length, 24); cen.writeUInt16LE(nm.length, 28); cen.writeUInt32LE(off, 42)
    parts.push(local, nm, comp); dir.push(cen, nm)
    off += 30 + nm.length + comp.length
  }
  const d = Buffer.concat(dir)
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10); end.writeUInt32LE(d.length, 12); end.writeUInt32LE(off, 16)
  return Buffer.concat([...parts, d, end])
}

test('Strava download: activities.csv is read (metres and seconds, quoted commas and new lines)', () => {
  const acts = exp.activitiesFromCsv(CSV)
  assert.equal(acts.length, 3)
  const [a, b, c] = acts
  assert.equal(a.name, 'Club session, intervals')
  assert.equal(a.type, 'Kayaking')
  assert.equal(a.date, '2026-10-20T17:30:00')
  assert.equal(a.distance, 10000)
  assert.equal(a.moving, 3600)
  assert.equal(a.hr, 148)
  assert.equal(stats.groupOf(b), 'ergo') // a Workout called "K ergo..."
  assert.equal(c.type, 'WeightTraining')
  assert.equal(stats.groupOf(c), 'gym')
  assert.equal(exp.parseStravaDate('5 Jan 2023, 18:30:12'), Date.UTC(2023, 0, 5, 18, 30, 12))
  assert.equal(exp.parseStravaDate('Jan 5, 2023, 12:05:00 AM'), Date.UTC(2023, 0, 5, 0, 5, 0))
  assert.equal(exp.typeFromExport('Canoe'), 'Canoeing')
  assert.equal(exp.typeFromExport('Stand Up Paddling'), 'StandUpPaddling')
  assert.throws(() => exp.activitiesFromCsv('"Name","Email"\n"x","y"'), /activities\.csv/)
})

test('Strava download: the zip is opened in the browser, activities.csv and just the name from profile.csv', async () => {
  const file = new File([zip({
    'profile.csv': '"Athlete ID","Email Address","First Name","Last Name"\n"742265","ben@example.com","Ben","Tubby"',
    'activities/101.fit.gz': 'x'.repeat(5000),
    'activities.csv': CSV
  })], 'export_742265.zip')
  const got = await exp.readStravaFile(file)
  assert.equal(got.activities.length, 3)
  assert.equal(got.name, 'Ben Tubby')
  assert.equal(JSON.stringify(got).includes('ben@example.com'), false)
  // activities.csv on its own (unzipped by the computer)
  assert.equal((await exp.readStravaFile(new File([CSV], 'activities.csv'))).activities.length, 3)
  await assert.rejects(() => exp.readStravaFile(new File([zip({ 'other.txt': 'hi' })], 'x.zip')), /no activities\.csv/)
  await assert.rejects(() => exp.readStravaFile(new File(['not a zip'], 'x.zip')), /zip/)
})

test('heart rate: sessions with one (10 min or more), typical numbers by kind, the highest', () => {
  const acts = [
    { id: '1', type: 'Kayaking', date: '2026-10-01T18:00:00', moving: 3600, distance: 10000, speed: 2.78, hr: 120, maxHr: 150 },
    { id: '2', type: 'Kayaking', date: '2026-10-03T18:00:00', moving: 3600, distance: 10000, speed: 2.78, hr: 130, maxHr: 162 },
    { id: '3', type: 'Kayaking', date: '2026-10-05T18:00:00', moving: 3600, distance: 10000, speed: 2.78 }, // no heart rate
    { id: '4', type: 'Run', date: '2026-10-06T08:00:00', moving: 1800, distance: 5000, hr: 150, maxHr: 171 },
    { id: '5', type: 'Kayaking', date: '2026-10-07T18:00:00', moving: 300, distance: 1000, hr: 90 } // too short
  ]
  const h = stats.heartRates(acts)
  assert.equal(h.points.length, 3)
  assert.equal(h.paddlesWithHr, 2)
  assert.equal(h.byGroup.find(g => g.key === 'paddle').avg, 125)
  assert.equal(h.byGroup.find(g => g.key === 'run').avg, 150)
  assert.equal(h.highest, 171)
})
