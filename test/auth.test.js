// Sign in with Google, the session cookie, the roles list and the page gates that use them.
// All with made-up people and a throwaway signing key standing in for Google's.
import test from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync, createSign } from 'node:crypto'
import { signSession, readSession, sessionAllows } from '../netlify/edge-functions/lib/session.js'
import { signSessionSync, readSessionSync } from '../netlify/functions/lib/session.js'
import { verifyGoogleToken, _resetGoogleKeys } from '../netlify/functions/lib/google.js'
import { rolesFor, setRoles, readTable, adminEmails, normaliseEmail } from '../netlify/functions/lib/roles.js'

const SECRET = 'a-long-test-secret-for-sessions'
const CLIENT = 'test-client-id.apps.googleusercontent.com'
const future = () => Date.now() + 60_000

// a stand-in for Google: one RSA key, its public half as the "certs" Google would publish
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const other = generateKeyPairSync('rsa', { modulusLength: 2048 })
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' }
const fakeFetch = async () => new Response(JSON.stringify({ keys: [jwk] }))
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url')
function idToken(claims = {}, key = privateKey) {
  const head = b64({ alg: 'RS256', kid: 'k1', typ: 'JWT' })
  const body = b64({ iss: 'https://accounts.google.com', aud: CLIENT, exp: Math.floor(Date.now() / 1000) + 600, email: 'Sam.Test@Example.com', email_verified: true, name: 'Sam Test', given_name: 'Sam', ...claims })
  const sig = createSign('RSA-SHA256').update(head + '.' + body).sign(key).toString('base64url')
  return `${head}.${body}.${sig}`
}

test('the session cookie: signed, tamper-proof, expiring, and the same in the edge and function code', async () => {
  const payload = { e: 'sam@example.com', n: 'Sam', r: ['coach', 'bogus'], x: future() }
  const fromEdge = await signSession(payload, SECRET)
  const fromNode = signSessionSync(payload, SECRET)
  assert.equal(fromEdge, fromNode, 'both write the same cookie')
  for (const cookie of [fromEdge, fromNode]) {
    const a = await readSession(cookie, SECRET)
    const b = readSessionSync(cookie, SECRET)
    assert.deepEqual(a, b)
    assert.deepEqual(a.roles, ['coach'], 'unknown roles are ignored')
    assert.equal(a.email, 'sam@example.com')
    assert.equal(a.name, 'Sam')
    assert.equal(await readSession(cookie, 'another-secret-entirely'), null)
    assert.equal(readSessionSync(cookie, 'another-secret-entirely'), null)
  }
  const forged = signSessionSync({ ...payload, r: ['admin'] }, SECRET).split('.')[0] + '.' + fromNode.split('.')[1]
  assert.equal(await readSession(forged, SECRET), null, 'changing the roles breaks the signature')
  assert.equal(readSessionSync(forged, SECRET), null)
  const old = signSessionSync({ ...payload, x: Date.now() - 1 }, SECRET)
  assert.equal(readSessionSync(old, SECRET), null, 'expired')
  assert.equal(await readSession(old, SECRET), null)
  assert.equal(readSessionSync(fromNode, ''), null, 'no secret set: nobody is signed in')
  assert.equal(readSessionSync('rubbish', SECRET), null)
  assert.equal(sessionAllows({ roles: ['admin'] }, 'coach'), true, 'an admin may do everything')
  assert.equal(sessionAllows({ roles: ['coach'] }, 'coordinator'), false)
  assert.equal(sessionAllows(null, 'coach'), false)
})

test('Google ID tokens are checked: signature, audience, issuer, expiry, verified email', async () => {
  const ok = async t => verifyGoogleToken(t, { clientId: CLIENT, fetchFn: fakeFetch })
  _resetGoogleKeys()
  const who = await ok(idToken())
  assert.equal(who.email, 'sam.test@example.com', 'email is lower-cased')
  assert.equal(who.first, 'Sam')
  assert.equal((await ok(idToken({ given_name: undefined, name: 'Alex Q Example' }))).first, 'Alex', 'no given name: the first word of the name')
  await assert.rejects(ok(idToken({ aud: 'someone-elses-client' })), /not issued for this site/)
  await assert.rejects(ok(idToken({ iss: 'https://evil.example.com' })), /issuer/)
  await assert.rejects(ok(idToken({ exp: Math.floor(Date.now() / 1000) - 10 })), /expired/)
  await assert.rejects(ok(idToken({ email_verified: false })), /not verified/)
  await assert.rejects(ok(idToken({}, other.privateKey)), /signature/)
  await assert.rejects(ok('not.a.token'), /Not a Google token/)
  await assert.rejects(verifyGoogleToken(idToken(), { clientId: '', fetchFn: fakeFetch }), /not configured/)
})

test('roles: from the list, with ADMIN_EMAILS always admin', async () => {
  const mem = new Map()
  const store = { get: async (k, o) => (mem.has(k) ? (o?.type === 'json' ? JSON.parse(mem.get(k)) : mem.get(k)) : null), setJSON: async (k, v) => { mem.set(k, JSON.stringify(v)) } }
  assert.deepEqual(adminEmails({ ADMIN_EMAILS: ' Boss@Example.com; second@example.com ' }), ['boss@example.com', 'second@example.com'])
  await setRoles(store, 'Coach@Example.com', ['coach', 'nonsense'], 'boss@example.com')
  await setRoles(store, 'plan@example.com', ['coordinator', 'coach'], 'boss@example.com')
  const table = await readTable(store)
  assert.deepEqual(rolesFor('COACH@example.com', table, []), ['coach'])
  assert.deepEqual(rolesFor('plan@example.com', table, []), ['coach', 'coordinator'])
  assert.deepEqual(rolesFor('boss@example.com', table, ['boss@example.com']), ['admin'])
  assert.deepEqual(rolesFor('stranger@example.com', table, []), [])
  await setRoles(store, 'coach@example.com', [], 'boss@example.com')
  assert.deepEqual(rolesFor('coach@example.com', await readTable(store), []), [], 'an empty list removes them')
  await assert.rejects(setRoles(store, 'not an email', ['coach'], 'x'), /not an email/)
  assert.equal(normaliseEmail('  A@B.com '), 'a@b.com')
})

test('signing in: sets the cookie; roles come from the list; the roles page is for admins; whoami and access follow the session', async () => {
  const saved = { ...process.env }
  const realFetch = globalThis.fetch
  Object.assign(process.env, { GOOGLE_CLIENT_ID: CLIENT, SESSION_SECRET: SECRET, ADMIN_EMAILS: 'boss@example.com' })
  globalThis.fetch = fakeFetch
  _resetGoogleKeys()
  try {
    const mem = new Map()
    const { default: auth, _useStore } = await import('../netlify/functions/auth.js')
    _useStore({ get: async (k, o) => (mem.has(k) ? (o?.type === 'json' ? JSON.parse(mem.get(k)) : mem.get(k)) : null), setJSON: async (k, v) => { mem.set(k, JSON.stringify(v)) } }) // (like the real store: text unless asked for json)
    const { default: whoami } = await import('../netlify/functions/whoami.js')
    const { signedInAs } = await import('../netlify/functions/lib/access.js')
    const post = (path, body, cookie = '') => auth(new Request('https://x' + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) }))
    const cookieFrom = res => (res.headers.get('set-cookie') || '').split(';')[0]
    const asker = cookie => new Request('https://x/api/whoami', { headers: cookie ? { cookie } : {} })

    // an admin signs in
    let res = await post('/api/auth/google', { credential: idToken({ email: 'boss@example.com' }) })
    assert.equal(res.status, 200)
    assert.match(res.headers.get('set-cookie'), /HttpOnly/)
    assert.match(res.headers.get('set-cookie'), /SameSite=Lax/)
    const admin = cookieFrom(res)
    assert.deepEqual((await res.json()).roles, ['admin'])
    // not JSON / bad token / not set up
    assert.equal((await auth(new Request('https://x/api/auth/google', { method: 'POST', body: 'x' }))).status, 400)
    assert.equal((await post('/api/auth/google', { credential: 'nope' })).status, 401)
    // an admin gives someone the coach role
    res = await auth(new Request('https://x/api/auth/roles', { method: 'PUT', headers: { 'Content-Type': 'application/json', cookie: admin }, body: JSON.stringify({ email: 'sam.test@example.com', roles: ['coach'] }) }))
    assert.equal(res.status, 200)
    // they sign in, and have the coach role (and only that)
    res = await post('/api/auth/google', { credential: idToken() })
    const coach = cookieFrom(res)
    assert.deepEqual((await res.json()).roles, ['coach'])
    const reqWith = cookie => new Request('https://x/', { headers: { cookie } })
    assert.equal(signedInAs(reqWith(coach), 'coach'), true)
    assert.equal(signedInAs(reqWith(coach), 'coordinator'), false)
    assert.equal(signedInAs(reqWith(admin), 'coordinator'), true)
    assert.equal(signedInAs(reqWith(''), 'coach'), false)
    // the menu: who am I
    assert.deepEqual(await (await whoami(asker(coach))).json(), { coach: true, coordinator: false, admin: false, email: 'sam.test@example.com', name: 'Sam', googleClientId: CLIENT })
    assert.equal((await (await whoami(asker(admin))).json()).admin, true)
    assert.equal((await (await whoami(asker(''))).json()).email, '')
    // the roles page's data is for admins only
    assert.equal((await auth(new Request('https://x/api/auth/roles', { headers: { cookie: coach } }))).status, 401)
    assert.equal((await auth(new Request('https://x/api/auth/roles'))).status, 401)
    const list = await (await auth(new Request('https://x/api/auth/roles', { headers: { cookie: admin } }))).json()
    assert.deepEqual(list.people.map(p => p.email), ['sam.test@example.com'])
    assert.deepEqual(list.admins, ['boss@example.com'])
    // an unlisted Google account may sign in, but has no roles
    res = await post('/api/auth/google', { credential: idToken({ email: 'visitor@example.com' }) })
    assert.deepEqual((await res.json()).roles, [])
    // sign out
    res = await post('/api/auth/logout', {})
    assert.match(res.headers.get('set-cookie'), /Max-Age=0/)
    // without the server settings, nobody can sign in
    delete process.env.SESSION_SECRET
    assert.equal((await post('/api/auth/google', { credential: idToken() })).status, 500)
    assert.equal(signedInAs(reqWith(coach), 'coach'), false)
  } finally {
    globalThis.fetch = realFetch
    for (const k of ['GOOGLE_CLIENT_ID', 'SESSION_SECRET', 'ADMIN_EMAILS']) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] }
  }
})

test('the page gates: a Google role gets in; anyone else goes to the homepage with a reason; ?leave signs out', async () => {
  const saved = { ...process.env }
  const savedNetlify = globalThis.Netlify
  process.env.SESSION_SECRET = SECRET
  globalThis.Netlify = { env: { get: k => process.env[k] } }
  try {
    const { roleGate } = await import('../netlify/edge-functions/lib/role-gate.js')
    const coachGate = roleGate({ role: 'coach' })
    const plannerGate = roleGate({ role: 'coordinator' })
    const ctx = cookie => ({ cookies: { get: n => (cookie.split('; ').find(c => c.startsWith(n + '=')) || '').slice(n.length + 1) }, next: async () => new Response('the page') })
    const visit = async (gate, cookie = '', path = '/paddlers/?x=1') => gate(new Request('https://x' + path, { headers: cookie ? { cookie } : {} }), ctx(cookie))
    const sess = async roles => 'bscc_session=' + await signSession({ e: 'sam@example.com', r: roles, x: future() }, SECRET)

    // not signed in: no password box any more, just back to the homepage, which opens the sign-in box
    let res = await visit(coachGate)
    assert.equal(res.status, 303)
    assert.equal(res.headers.get('location'), '/?signin=signin&need=coach&next=' + encodeURIComponent('/paddlers/?x=1'))
    // a coach (and an admin) get the page; a coordinator does not, and is told why
    assert.equal(await (await visit(coachGate, await sess(['coach']))).text(), 'the page')
    assert.equal(await (await visit(coachGate, await sess(['admin']))).text(), 'the page')
    res = await visit(coachGate, await sess(['coordinator']))
    assert.match(res.headers.get('location'), /^\/\?signin=norole&need=coach/)
    // and the other way round
    assert.equal(await (await visit(plannerGate, await sess(['coordinator']), '/race-planner/')).text(), 'the page')
    assert.match((await visit(plannerGate, await sess(['coach']), '/race-planner/')).headers.get('location'), /need=coordinator/)
    // a forged cookie is no good
    const [body, sig] = (await sess(['coach'])).split('=')[1].split('.')
    assert.equal((await visit(coachGate, `bscc_session=${body}.${(sig[0] === 'A' ? 'B' : 'A') + sig.slice(1)}`)).status, 303)
    // the old password cookies open nothing now
    assert.equal((await visit(coachGate, 'bscc_coaching_page=anything')).status, 303)
    // no SESSION_SECRET on the server: nobody gets in
    delete process.env.SESSION_SECRET
    assert.equal((await visit(coachGate, await sess(['admin']))).status, 303)
    process.env.SESSION_SECRET = SECRET
    // ?leave signs out, clears the old cookies, and goes home
    res = await visit(coachGate, await sess(['coach']), '/paddlers/?leave')
    assert.equal(res.headers.get('location'), '/?signedout=1')
    const cleared = res.headers.getSetCookie()
    assert.ok(cleared.some(c => /^bscc_session=;/.test(c)))
    assert.ok(cleared.some(c => /^bscc_coaching_page=;/.test(c)))
  } finally {
    globalThis.Netlify = savedNetlify
    for (const k of ['SESSION_SECRET']) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] }
  }
})
