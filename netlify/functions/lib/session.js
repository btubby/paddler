// The sign-in session cookie, read and written with Node's crypto so function code can check
// it synchronously. The format and its reasons are in netlify/edge-functions/lib/session.js
// (the same cookie is checked there, by the page gates, with Web Crypto).
import { createHmac, timingSafeEqual } from 'node:crypto'
import { SESSION_COOKIE, SESSION_DAYS, ROLE_NAMES, sessionAllows, sessionCookie, clearSessionCookie } from '../../edge-functions/lib/session.js'

export { SESSION_COOKIE, SESSION_DAYS, ROLE_NAMES, sessionAllows, sessionCookie, clearSessionCookie }

const mac = (body, secret) => createHmac('sha256', secret).update(body).digest('base64url')

export function signSessionSync(payload, secret) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${body}.${mac(body, secret)}`
}

export function readSessionSync(value, secret, now = Date.now()) {
  if (!value || !secret || typeof value !== 'string') return null
  const dot = value.indexOf('.')
  if (dot < 1) return null
  const body = value.slice(0, dot)
  const given = Buffer.from(value.slice(dot + 1))
  const want = Buffer.from(mac(body, secret))
  if (given.length !== want.length || !timingSafeEqual(given, want)) return null
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString())
    if (typeof p.e !== 'string' || !Array.isArray(p.r) || !(p.x > now)) return null
    return { email: p.e, name: typeof p.n === 'string' ? p.n.slice(0, 60) : '', roles: p.r.filter(r => ROLE_NAMES.includes(r)), expires: p.x }
  } catch {
    return null
  }
}

export function cookieOf(req, name) {
  for (const part of (req.headers.get('cookie') || '').split(';')) {
    const i = part.indexOf('=')
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim()
  }
  return ''
}

// who is signed in with Google on this request: { email, roles, expires } or null
export const sessionOf = req => readSessionSync(cookieOf(req, SESSION_COOKIE), process.env.SESSION_SECRET || '')
