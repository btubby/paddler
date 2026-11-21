// Paddlers who raced under another name before (a married name, a misspelling, Tom for
// Thomas): a guess, for a coach to confirm on the paddler page, never linked by itself.
//
// The tell: someone "new" whose first result is already in a middling division (div 6 or
// quicker). A newcomer starts in div 9 (7 or 8 at most), so they must have raced before,
// under another name. Earlier paddlers who could be them are scored on:
//   - the same first name (or a nickname of it), a different surname
//   - the same sex in the Class column, and an age group that fits (it only goes up)
//   - the old name stopping shortly before the new one starts, with no overlap
//   - the division the old name finished in matching the one the new name started in, and
//     a similar speed
//   - K2 partners in common (a strong sign), and the same club (a weak one: people move)
// Confirmed links ("same person") are kept in Netlify Blobs (name-links) and applied when
// the ratings are worked out (crewfit.js fitRatings, option links).

const DAY = 864e5
const AGE = { junior: 0, senior: 1, veteran: 2 }
export const sexOf = cls => { const c = String(cls || '').toUpperCase(); return /F/.test(c) ? 'F' : /M/.test(c) ? 'M' : '' }
const ageOf = cls => { const c = String(cls || '').trim().toUpperCase(); return /^(J|U\d)/.test(c) ? 0 : /^V/.test(c) ? 2 : /^S/.test(c) ? 1 : null }
const sameFirst = (a, b) => a === b || (Math.min(a.length, b.length) >= 3 && (a.startsWith(b) || b.startsWith(a)))
export const KEY = /^[a-z][a-z' -]{1,79}\|[A-Z0-9]{2,12}$/

// what's needed from each paddler (crewfit.js paddler objects: ent = their results)
export function summarise(p) {
  const ent = [...p.ent].sort((a, b) => (a.race.date || 0) - (b.race.date || 0))
  if (!ent.length) return null
  const divs = ent.map(e => { const i = e.ms.indexOf(p); const d = e.ms.length === 1 || e.x.divs?.length === e.x.names.length ? String(e.x.divs?.[i] ?? '') : ''; return /^[1-9]$/.test(d.trim()) ? +d : null })
  const cls = ent.map(e => e.x.cls?.[e.ms.indexOf(p)] ?? '')
  const partners = new Map()
  for (const e of ent) for (const m of e.ms) if (m !== p) partners.set(m.key, m.name)
  const [nm, club] = p.key.split('|')
  const [first, ...rest] = nm.split(' ')
  return {
    key: p.key, name: p.name, club, first, surname: rest.join(' '), a: p.a, n: ent.length,
    from: ent[0].race.date, to: ent[ent.length - 1].race.date,
    firstDiv: divs.find(d => d != null) ?? null, lastDiv: [...divs].reverse().find(d => d != null) ?? null,
    sex: sexOf(cls.find(c => sexOf(c))), ageFrom: ageOf(cls.find(c => ageOf(c) != null)), ageTo: ageOf([...cls].reverse().find(c => ageOf(c) != null)),
    partners
  }
}

const month = t => new Date(t).toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' })

// one possible earlier name for b: { score, why } or null
export function scorePair(a, b) {
  if (a.key === b.key || a.surname === b.surname || !sameFirst(a.first, b.first)) return null
  if (a.sex && b.sex && a.sex !== b.sex) return null
  if (!(a.from < b.from) || a.to > b.from) return null // the old name ends before the new one starts
  const gap = (b.from - a.to) / DAY
  if (gap > 548) return null
  if (a.ageTo != null && b.ageFrom != null && (b.ageFrom < a.ageTo || b.ageFrom - a.ageTo > 1)) return null
  if (a.lastDiv != null && b.firstDiv != null && Math.abs(a.lastDiv - b.firstDiv) > 2) return null
  let score = 0
  const why = []
  const weeks = Math.max(1, Math.round(gap / 7))
  score += gap < 92 ? 3 : gap < 183 ? 2 : gap < 365 ? 1 : 0
  why.push(`stopped ${gap < 60 ? weeks + ' week' + (weeks === 1 ? '' : 's') : Math.round(gap / 30.4) + ' months'} before ${b.name} started`)
  if (a.lastDiv != null && b.firstDiv != null) {
    const d = Math.abs(a.lastDiv - b.firstDiv)
    score += d === 0 ? 3 : d === 1 ? 1.5 : -1
    why.push(d === 0 ? `last raced in div ${a.lastDiv}, where ${b.name} started` : `last raced in div ${a.lastDiv}; ${b.name} started in div ${b.firstDiv}`)
  }
  const da = Math.abs(a.a - b.a)
  if (da < 0.03) { score += 2; why.push('about the same speed') } else if (da < 0.06) score += 1
  const shared = [...a.partners.keys()].filter(k => b.partners.has(k) && k !== a.key && k !== b.key)
  if (shared.length) {
    score += Math.min(6, shared.length * 3)
    why.push(`raced K2 with ${shared.slice(0, 3).map(k => b.partners.get(k)).join(', ')}, as ${b.name} has`)
  }
  if (a.club === b.club) { score += 1.5; why.push(`same club (${a.club})`) }
  if (a.sex && a.sex === b.sex) score += 0.5
  return { score: +score.toFixed(1), why }
}

// for everyone who looks like they raced before under another name: up to 3 candidates,
// best first: Map(key -> [{ key, name, club, n, from, to, lastDiv, score, why }])
export function earlierNames(paddlers, { minScore = 5 } = {}) {
  const all = paddlers.map(summarise).filter(Boolean)
  const byFirst = new Map()
  for (const s of all) {
    const k = s.first.slice(0, 3)
    if (!byFirst.has(k)) byFirst.set(k, [])
    byFirst.get(k).push(s)
  }
  const out = new Map()
  for (const b of all) {
    if (b.firstDiv == null || b.firstDiv > 6) continue // started where a newcomer would: nothing to explain
    const hints = []
    for (const a of byFirst.get(b.first.slice(0, 3)) || []) {
      const s = scorePair(a, b)
      if (s && s.score >= minScore) hints.push({ key: a.key, name: a.name, club: a.club, n: a.n, from: month(a.from), to: month(a.to), lastDiv: a.lastDiv, ...s })
    }
    if (hints.length) out.set(b.key, hints.sort((x, y) => y.score - x.score).slice(0, 3))
  }
  return out
}
