// Share links: a coach sends a paddler a link to their own page (/my-racing/?t=<token>).
// The token names one paddler (their key in the race history, e.g. "kerry tubby|BSF") and is
// signed with a server-side secret, so it can't be changed to anyone else and can't be
// made up. It only ever opens that one paddler's results: no lookups, no other pages.
//
// The secret is SHARE_LINK_SECRET; without it, one is derived from SESSION_SECRET (changing that
// then stops every link working too). Changing the secret stops every link that has been shared.
// (Links made when the coaches had a password were signed with a key derived from it: to keep
// them working after the password is removed, set SHARE_LINK_SECRET to that key: see the README.)
import { createHmac, createHash, timingSafeEqual } from 'node:crypto'

function secret() {
  if (process.env.SHARE_LINK_SECRET) return process.env.SHARE_LINK_SECRET
  const base = process.env.COACHING_PAGE_PASSWORD || process.env.SESSION_SECRET // (the old password, while it is still set: keeps old links working)
  return base ? createHash('sha256').update('bscc-share-links:' + base).digest('hex') : ''
}
const sign = (body, key) => createHmac('sha256', key).update(body).digest('base64url').slice(0, 32)

// A password for the server's own calls to the background function that works out the ratings,
// for when a paddler (not a coach) has merged their results (crews.js, crews-fit.js)
export function fitToken() {
  const key = secret()
  return key ? createHash('sha256').update('bscc-fit:' + key).digest('hex') : ''
}

export function makeShareToken(personKey) {
  const key = secret()
  if (!key) throw new Error('No secret for share links: set SHARE_LINK_SECRET (or SESSION_SECRET)')
  const body = Buffer.from(JSON.stringify({ k: personKey, v: 1 })).toString('base64url')
  return `${body}.${sign(body, key)}`
}

// the paddler's key, or null if the token isn't one of ours
export function readShareToken(token) {
  const key = secret()
  const m = String(token || '').match(/^([A-Za-z0-9_-]{4,400})\.([A-Za-z0-9_-]{32})$/)
  if (!key || !m) return null
  const want = Buffer.from(sign(m[1], key))
  const got = Buffer.from(m[2])
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null
  try {
    const { k } = JSON.parse(Buffer.from(m[1], 'base64url').toString('utf8'))
    return typeof k === 'string' && /^[^|]{1,80}\|[A-Z0-9]{2,12}$/.test(k) ? k : null
  } catch {
    return null
  }
}
