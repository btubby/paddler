// The sign-in session for people who sign in with Google (netlify/functions/auth.js sets it
// after checking Google's ID token). A cookie, `bscc_session`, holding who they are and which
// roles they had at that moment, signed with SESSION_SECRET so it can't be made up or changed:
//
//   <base64url of {"e": email, "n": first name from Google, "r": ["coach", ...], "x": expiry in ms}>.<base64url HMAC-SHA256>
//
// Roles are looked up once, when someone signs in, and stay in the cookie until it expires: so
// a page gate (an edge function, which has no cheap way to read the roles list) can decide from
// the cookie alone. A role taken away on the roles page stops working when that person's
// session ends (SESSION_DAYS), and changing SESSION_SECRET signs everyone out at once.
//
// Web Crypto only, so it runs on Netlify's edge (Deno) and in Node. netlify/functions/lib/
// session.js is the same format with Node's own crypto, so function code can check it
// synchronously (test/auth.test.js checks the two agree).
export const SESSION_COOKIE = 'bscc_session'
export const SESSION_DAYS = 3
export const ROLE_NAMES = ['coach', 'coordinator', 'admin']

const enc = new TextEncoder()
const b64 = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const unb64 = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))

const hmacKey = (secret, usage) => crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [usage])

// payload: { e: email, n: first name (for "Welcome ..."), r: roles, x: expiry (ms) }
export async function signSession(payload, secret) {
  const body = b64(enc.encode(JSON.stringify(payload)))
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(secret, 'sign'), enc.encode(body)))
  return `${body}.${b64(sig)}`
}

// The session in a cookie value, or null (missing, changed, expired, or no secret set)
export async function readSession(value, secret, now = Date.now()) {
  if (!value || !secret || typeof value !== 'string') return null
  const dot = value.indexOf('.')
  if (dot < 1) return null
  try {
    const body = value.slice(0, dot)
    const ok = await crypto.subtle.verify('HMAC', await hmacKey(secret, 'verify'), unb64(value.slice(dot + 1)), enc.encode(body))
    if (!ok) return null
    const p = JSON.parse(new TextDecoder().decode(unb64(body)))
    if (typeof p.e !== 'string' || !Array.isArray(p.r) || !(p.x > now)) return null
    return { email: p.e, name: typeof p.n === 'string' ? p.n.slice(0, 60) : '', roles: p.r.filter(r => ROLE_NAMES.includes(r)), expires: p.x }
  } catch {
    return null
  }
}

// Does this session hold the role? An admin may do everything.
export const sessionAllows = (session, role) => !!session && (session.roles.includes(role) || session.roles.includes('admin'))

export const sessionCookie = (value, secure) =>
  `${SESSION_COOKIE}=${value}; Path=/; Max-Age=${SESSION_DAYS * 86400}; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`
export const clearSessionCookie = secure => `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`
