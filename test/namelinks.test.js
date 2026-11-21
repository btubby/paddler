import test from 'node:test'
import assert from 'node:assert/strict'
import { fitRatings } from '../netlify/functions/lib/crewfit.js'
import { earlierNames } from '../netlify/functions/lib/namelinks.js'

// A made-up few seasons: "Jane Old" (MAI) races up to div 5, marries and carries on as
// "Jane New" (EAL), starting in div 5, with the same K2 partner. Others for contrast:
// "Jane Other" (a different Jane, a man's class, still racing), and "Janet Fresh", a real
// newcomer starting in div 9.
function races() {
  const out = []
  const row = (tab, names, clubs, cls, divs, t) => ({ tab, names, clubs, cls, divs, pd: [], t })
  const day = (y, m, d) => Date.UTC(y, m - 1, d)
  const field = (d, t) => [row(`div${d}`, [`Filler ${d}a`], ['XYZ'], ['SMK'], [String(d)], t), row(`div${d}`, [`Filler ${d}b`], ['XYZ'], ['SMK'], [String(d)], t + 60)]
  let k = 0
  const race = (date, rows) => out.push({ key: `/r${k++}`, name: `Race ${k}`, date, rows: [...rows, ...field(5, 4300), ...field(9, 2400)] })
  race(day(2022, 5, 1), [row('div6', ['Jane Old'], ['MAI'], ['VFK'], ['6'], 4500), row('div7', ['Jane Other'], ['ABC'], ['VMK'], ['7'], 4700)])
  race(day(2023, 6, 1), [row('div5_5', ['Jane Old', 'Pat Partner'], ['MAI', 'MAI'], ['VFK', 'VFK'], ['5', '5'], 4100)])
  race(day(2024, 7, 13), [row('div5', ['Jane Old'], ['MAI'], ['VFK'], ['5'], 4320), row('div7', ['Jane Other'], ['ABC'], ['VMK'], ['7'], 4650)])
  race(day(2024, 8, 18), [row('div5', ['Jane New'], ['EAL'], ['VFK'], ['5'], 4310), row('div9', ['Janet Fresh'], ['EAL'], ['VFK'], ['9'], 2500)])
  race(day(2025, 5, 1), [row('div5_5', ['Jane New', 'Pat Partner'], ['EAL', 'MAI'], ['VFK', 'VFK'], ['5', '5'], 4090), row('div7', ['Jane Other'], ['ABC'], ['VMK'], ['7'], 4640)])
  return out
}

test('earlier names: a "new" paddler starting in div 5 is matched to the one who stopped just before', () => {
  const fit = fitRatings(races(), { now: Date.UTC(2026, 0, 1), historyClub: '*' })
  const hints = earlierNames(fit.paddlers)
  const forNew = hints.get('jane new|EAL')
  assert.ok(forNew, 'a guess for Jane New')
  assert.equal(forNew[0].key, 'jane old|MAI')
  assert.ok(forNew[0].why.some(w => /Pat Partner/.test(w)), 'the K2 partner in common counts')
  assert.ok(!forNew.some(h => h.key === 'jane other|ABC'), 'not someone still racing, in a man\'s class')
  assert.equal(hints.has('janet fresh|EAL'), false, 'a newcomer starting in div 9 needs no explaining')
})

test('earlier names: a confirmed link puts the two together, under the new name and club', () => {
  const fit = fitRatings(races(), { now: Date.UTC(2026, 0, 1), historyClub: '*', links: { 'jane old|MAI': { name: 'Jane New', club: 'EAL' } } })
  assert.equal(fit.paddlers.filter(p => /^jane (old|new)/.test(p.key)).length, 1)
  const jane = fit.paddlers.find(p => p.key === 'jane new|EAL')
  assert.equal(jane.name, 'Jane New')
  assert.ok(jane.names.includes('Jane Old'))
  assert.equal(fit.history.get('jane new|EAL').length, 5)
  assert.equal(earlierNames(fit.paddlers).has('jane new|EAL'), false) // nothing left to guess
})
