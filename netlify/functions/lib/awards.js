// The star awards record: a digital version of the club's assessment book. One row per
// assessment: date, paddler, assessor, award (1, 2 or 3 star). Pure functions (no Netlify
// imports) so they are unit-tested directly; netlify/functions/awards.js stores them.
export const AWARDS = [1, 2, 3]
export const MAX_RECORDS = 5000

const clean = (s, max) => String(s ?? '').replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
const isoDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z')) && new Date(s + 'T00:00:00Z').toISOString().startsWith(s)

// A record from what the page sent: { date, paddler, assessor, award, memberId? } or { error }
export function cleanRecord(input, now = Date.now()) {
  const date = clean(input?.date, 10)
  if (!isoDate(date)) return { error: 'Enter the date of the assessment' }
  if (date > new Date(now + 36e5 * 24).toISOString().slice(0, 10)) return { error: 'That date is in the future' }
  if (date < '2000-01-01') return { error: 'That date is too long ago' }
  const paddler = clean(input?.paddler, 80)
  if (paddler.length < 2) return { error: "Enter the paddler's name" }
  const assessor = clean(input?.assessor, 80)
  if (assessor.length < 2) return { error: "Enter the assessor's name" }
  const award = Number(input?.award)
  if (!AWARDS.includes(award)) return { error: 'Choose 1, 2 or 3 star' }
  const memberId = /^\d{1,12}$/.test(String(input?.memberId ?? '')) ? String(input.memberId) : ''
  return { date, paddler, assessor, award, memberId }
}

const key = r => (r.memberId ? 'm' + r.memberId : 'n' + r.paddler.toLowerCase())
export const isDuplicate = (records, r, exceptId = '') =>
  records.some(x => x.id !== exceptId && x.date === r.date && x.award === r.award && key(x) === key(r))

export const newId = (now = Date.now()) => 'a' + now.toString(36) + Math.random().toString(36).slice(2, 7)

// newest assessment first
export const sortRecords = records => [...records].sort((a, b) => b.date.localeCompare(a.date) || (b.at || '').localeCompare(a.at || ''))

// the highest award each paddler has, and when: [{ paddler, memberId, award, date, count }]
export function highest(records) {
  const best = new Map()
  for (const r of records) {
    const k = key(r)
    const cur = best.get(k)
    if (!cur) best.set(k, { paddler: r.paddler, memberId: r.memberId, award: r.award, date: r.date, count: 1 })
    else {
      cur.count++
      if (r.award > cur.award || (r.award === cur.award && r.date > cur.date)) Object.assign(cur, { award: r.award, date: r.date, paddler: r.paddler })
    }
  }
  return [...best.values()].sort((a, b) => b.award - a.award || a.paddler.localeCompare(b.paddler))
}

// The highest award (1-3) a paddler has, or 0. `sameName(a, b)` says whether two names are one person.
export function starLevelFor(records, name, sameName) {
  let best = 0
  for (const r of records || []) if (r && r.award > best && sameName(r.paddler, name)) best = r.award
  return best
}

// The newest award a paddler gained in the last `days` days, as { award, date } (nothing else:
// not who assessed them), or null. `sameName(a, b)` says whether two written names are one person.
export function recentAwardFor(records, name, sameName, now = Date.now(), days = 7) {
  const from = new Date(now - days * 86400000).toISOString().slice(0, 10)
  const to = new Date(now + 86400000).toISOString().slice(0, 10) // (a day's grace for time zones)
  let best = null
  for (const r of records || []) {
    if (!r || r.date < from || r.date > to || !sameName(r.paddler, name)) continue
    if (!best || r.award > best.award || (r.award === best.award && r.date > best.date)) best = { award: r.award, date: r.date }
  }
  return best
}

const csvCell = v => {
  let s = String(v ?? '')
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s // (so a spreadsheet doesn't run a name as a formula)
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}
export const toCsv = records =>
  ['Date of assessment,Paddler,Assessor,Award', ...sortRecords(records).map(r => [r.date, r.paddler, r.assessor, r.award + ' star'].map(csvCell).join(','))].join('\n') + '\n'
