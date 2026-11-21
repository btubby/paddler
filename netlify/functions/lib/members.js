import { timingSafeEqual } from 'node:crypto'

// "Parker, Alice" -> "Alice Parker"; collapses whitespace.
export function cleanName(text) {
  const t = String(text).replace(/\s+/g, ' ').trim()
  if (!t) return ''
  const m = t.match(/^([^,]+),\s*(.+)$/)
  return m ? `${m[2].trim()} ${m[1].trim()}` : t
}

// Constant-time comparison so the access code can't be guessed by timing.
export function sameToken(given, expected) {
  if (!given || !expected) return false
  const a = Buffer.from(String(given))
  const b = Buffer.from(String(expected))
  return a.length === b.length && timingSafeEqual(a, b)
}

// Decide paddler/coach from the text MemberMojo shows next to a member, using
// keyword lists from the COACH_MATCH / PADDLER_MATCH environment variables.
// Coach wins if both match. Returns undefined when nothing matches.
export function guessRole(info, coachWords = [], paddlerWords = []) {
  const t = String(info || '').toLowerCase()
  if (coachWords.some(w => t.includes(w))) return 'coach'
  if (paddlerWords.some(w => t.includes(w))) return 'paddler'
  return undefined
}

// For the debug output: hide emails and digits (phone numbers, dates of birth).
export function maskInfo(text) {
  return String(text).replace(/\S+@\S+/g, '<email>').replace(/\d/g, '#')
}

// Access codes shorter than this are refused outright: a short code can be guessed.
export const MIN_TOKEN_LENGTH = 20

// Counts wrong access codes per client (IP) and blocks a client after `max` wrong
// tries within `windowMs`. Per function instance (in memory), which together with
// long codes makes guessing impractical.
export function makeAttemptLimiter({ max = 10, windowMs = 15 * 60 * 1000 } = {}) {
  const fails = new Map() // key -> { count, first }
  const entry = key => {
    const e = fails.get(key)
    if (e && Date.now() - e.first > windowMs) { fails.delete(key); return null }
    return e || null
  }
  return {
    // ms until the client may try again, or 0 when not blocked
    blockedFor(key) {
      const e = entry(key)
      return e && e.count >= max ? e.first + windowMs - Date.now() : 0
    },
    fail(key) {
      const e = entry(key) || { count: 0, first: Date.now() }
      e.count++
      fails.set(key, e)
      if (fails.size > 5000) fails.delete(fails.keys().next().value) // bound memory
    },
    reset(key) { fails.delete(key) }
  }
}
