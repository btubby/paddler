// Checking a "Sign in with Google" ID token (a JWT the browser gets from Google and sends us).
// We verify it ourselves against Google's published public keys: the signature, who it was
// issued to (our client ID), who issued it, that it hasn't expired and that Google had verified
// the email address. Nothing is stored here; the caller turns it into a session cookie.
import { createPublicKey, createVerify } from 'node:crypto'

const CERTS_URL = 'https://www.googleapis.com/oauth2/v3/certs'
const ISSUERS = ['accounts.google.com', 'https://accounts.google.com']
let certs = { at: 0, keys: [] }

async function googleKeys(fetchFn, now) {
  if (certs.keys.length && now - certs.at < 60 * 60 * 1000) return certs.keys
  const res = await fetchFn(CERTS_URL)
  if (!res.ok) throw new Error('Could not fetch Google\'s keys')
  const { keys } = await res.json()
  certs = { at: now, keys: Array.isArray(keys) ? keys : [] }
  return certs.keys
}
export const _resetGoogleKeys = () => { certs = { at: 0, keys: [] } }

const part = s => JSON.parse(Buffer.from(s, 'base64url').toString())

// Returns { email, name, picture } or throws an Error saying why not
export async function verifyGoogleToken(token, { clientId, fetchFn = fetch, now = Date.now() } = {}) {
  if (!clientId) throw new Error('GOOGLE_CLIENT_ID is not configured on the server')
  const bits = String(token || '').split('.')
  if (bits.length !== 3) throw new Error('Not a Google token')
  let header, payload
  try { header = part(bits[0]); payload = part(bits[1]) } catch { throw new Error('Not a Google token') }
  if (header.alg !== 'RS256') throw new Error('Unexpected token type')
  let jwk = (await googleKeys(fetchFn, now)).find(k => k.kid === header.kid)
  if (!jwk) { _resetGoogleKeys(); jwk = (await googleKeys(fetchFn, now)).find(k => k.kid === header.kid) } // (keys rotate)
  if (!jwk) throw new Error('Unknown signing key')
  const ok = createVerify('RSA-SHA256').update(bits[0] + '.' + bits[1]).verify(createPublicKey({ key: jwk, format: 'jwk' }), Buffer.from(bits[2], 'base64url'))
  if (!ok) throw new Error('Bad signature')
  if (!ISSUERS.includes(payload.iss)) throw new Error('Wrong issuer')
  if (payload.aud !== clientId) throw new Error('Token was not issued for this site')
  if (!(payload.exp * 1000 > now)) throw new Error('Token has expired')
  if (!payload.email || !(payload.email_verified === true || payload.email_verified === 'true')) throw new Error('Email address not verified by Google')
  // the name Google has for them, for "Welcome Ben": their first name, or the first word of the full name
  const first = String(payload.given_name || payload.name || '').trim().split(/\s+/)[0].slice(0, 40)
  return { email: String(payload.email).toLowerCase(), name: payload.name || '', first }
}
