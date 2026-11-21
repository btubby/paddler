// Pure helpers (no dependencies) so they can be unit tested offline.

export function norm(s) {
  return String(s)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z\s'-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// Names the Hasler results have spelled more than one way for the same club paddler: the
// misspelling (as norm() writes it) -> the usual spelling. Each pair was checked: same club,
// never both in one race. Add more here as they turn up.
export const MISSPELLINGS = {
  'alastair bruce': 'alasdair bruce',
  'conner higgins': 'connor higgins',
  'libby galton': 'libby gaulton',
  'josepha walbank': 'josepha wallbank',
  'edward kirkland': 'edward kirtland',
  'ed kirkland': 'ed kirtland',
  'eddie kirkland': 'eddie kirtland',
  'joshua renade': 'joshua ranade',
  'josh renade': 'josh ranade',
  'petr luksah': 'petr luksan',
  'jaroslav klumper': 'jaroslav klumpler',
  'finlay sandal': 'finlay sandall',
  'oliver klumper': 'oliver klumpler',
  'ollie klumper': 'ollie klumpler',
  'emilie klumper': 'emilie klumpler',
  'chris szechung': 'chris sze'
}
// Paddlers who changed their name (marriage, say): their old name (lower case, as in
// MISSPELLINGS) -> the name they race under now, and the club they race for now. Their old
// results join the new ones as one paddler, under the new name and club (the club too, as
// a name change often comes with a move: Catherine Ayling raced for MAI, then EAL).
export const NAME_CHANGES = {
  'catherine ayling': { name: 'Catherine Shirley', club: 'EAL' }
}
export const nameChange = n => NAME_CHANGES[n] || null
export const fixSpelling = n => MISSPELLINGS[n] || NAME_CHANGES[n]?.name.toLowerCase() || n

// "Ben Spinola" matches "Benjamin Spinola": same surname, and one first name
// is a prefix of the other (min 3 letters). The caller also filters by club.
// Known misspellings (above) count as the same name.
export function sameRacer(a, b) {
  const [fa, ...ra] = fixSpelling(norm(a)).split(' ')
  const [fb, ...rb] = fixSpelling(norm(b)).split(' ')
  if (!fa || !fb || ra.join(' ') !== rb.join(' ') || !ra.length) return false
  if (fa === fb) return true
  return Math.min(fa.length, fb.length) >= 3 && (fa.startsWith(fb) || fb.startsWith(fa))
}

// The results table has Div (division raced) and P/D (promotion / demotion):
//   P3 or P-GSB  -> promoted, that is the paddler's division from now on
//   D?           -> demotion offered (division unchanged until taken up)
export function resolveDivision(div, pd) {
  const p = String(pd || '').trim().toUpperCase()
  let division = String(div || '').trim().toUpperCase()
  const raced = division
  const m = p.match(/^P-?(.+)$/)
  if (m) division = m[1]
  return { division, raced, promoted: !!m, demotionOffered: /^D/.test(p) }
}

const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 }

// Finds "16 Aug 2026" anywhere in a string.
export function parseDate(text) {
  const m = String(text).match(/(\d{1,2})\s+([A-Za-z]{3})[a-z]*\.?\s+(\d{4})/)
  if (!m) return null
  const mon = MONTHS[m[2].toLowerCase()]
  return mon === undefined ? null : new Date(Date.UTC(+m[3], mon, +m[1]))
}

// Which club hosted a race, as a short club code ("Leighton Buzzard Hasler 2026" -> "LBZ").
// The results site doesn't say, so this goes by the race name: the codes below are the
// hosts' codes as they appear in the results. Races not listed get the first three letters
// of the place in their name ("Hastings 1066 Hasler" -> "HAS").
const HOSTS = [
  [/bishop'?s\s*stortford/, 'BSF'],
  [/cambridge/, 'CAM'],
  [/chelm(er|sford)/, 'CLM'],
  [/leighton buzzard|\blbcc\b/, 'LBZ'],
  [/norwich/, 'NOR'],
  [/maidstone/, 'MAI'],
  [/banbury/, 'BAN'],
  [/falcon/, 'FOX'],
  [/reading/, 'RDG'],
  [/pangbourne/, 'PAN'],
  [/royal leamington/, 'RLS'],
  [/royal (canoe club|paddling|k2)/, 'ROY'],
  [/richmond/, 'RIC'],
  [/elmbridge/, 'ELM'],
  [/\bwey\b/, 'WEY'],
  [/worcester/, 'WOR'],
  [/gloucester/, 'GLO'],
  [/hereford/, 'HER'],
  [/\bexe\b/, 'EXE'],
  [/tamar/, 'TAM'],
  [/fowey/, 'FOY'],
  [/bradford|\bbath\b/, 'BOA'],
  [/trentham/, 'TRE'],
  [/nottingham/, 'NOT'],
  [/lincoln/, 'LIN'],
  [/macclesfield|adelphi/, 'MAD'],
  [/tonbridge/, 'TON'],
  [/southampton/, 'SOU'],
  [/glasgow/, 'GLW'],
  [/malton/, 'MAL'],
  [/gailey/, 'GAI'],
  [/basingstoke|\bb3c\b/, 'B3C'],
  [/saltford/, 'SAL'],
  [/brigg/, 'BRI'],
  [/linlithgow/, 'LKR'],
  [/south lakes/, 'SLK'],
  [/camel/, 'CML'],
  [/assess?ment/, 'ASM'],
  [/national|championship/, 'NAT'],
  [/hasler final/, 'HF']
]
export function hostCode(raceName) {
  const n = String(raceName || '').toLowerCase()
  for (const [re, code] of HOSTS) if (re.test(n)) return code
  // otherwise the first word that names a place: skip numbers/ordinals and generic words
  const word = n
    .replace(/\b20\d\d\b/g, ' ')
    .split(/[^a-z]+/)
    .find(w => w.length >= 3 && !/^(st|nd|rd|th|\d+(st|nd|rd|th))$/.test(w) && !/^(the|tony|and|race|hasler|marathon|canoe|club|kayak|series|winter|circuit)$/.test(w))
  return word ? word.slice(0, 3).toUpperCase() : ''
}
