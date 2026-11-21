import test from 'node:test'
import assert from 'node:assert/strict'
import { sameRacer, resolveDivision, parseDate, hostCode } from '../netlify/functions/lib/match.js'

test('name matching', () => {
  //assert.ok(sameRacer('Ben Spinola', 'Benjamin Spinola'))
 // assert.ok(sameRacer('James Breeze', 'James Breeze'))
  assert.ok(!sameRacer('Ben Spinola', 'Joao Spinola'))
  assert.ok(!sameRacer('Alice Parker', 'Alex Parker'))
})

test('division resolution', () => {
  assert.deepEqual(resolveDivision('9', ''), { division: '9', raced: '9', promoted: false, demotionOffered: false })
  assert.equal(resolveDivision('4', 'P3').division, '3')
  assert.equal(resolveDivision('GSC', 'P-GSB').division, 'GSB')
  const d = resolveDivision('3', 'D?')
  assert.equal(d.division, '3')
  assert.ok(d.demotionOffered)
})

test('dates', () => {
  assert.equal(parseDate('Hurley Hasler 2026 Southern 16 Aug 2026').toISOString().slice(0, 10), '2026-08-16')
  assert.equal(parseDate('no date here'), null)
})

import { cleanName, sameToken } from '../netlify/functions/lib/members.js'

test('directory names', () => {
  assert.equal(cleanName('  Parker,   Alice '), 'Alice Parker')
  assert.equal(cleanName('Oleh Kuzmenko'), 'Oleh Kuzmenko')
  assert.equal(cleanName('   '), '')
})

test('access code check', () => {
  assert.ok(sameToken('abc123', 'abc123'))
  assert.ok(!sameToken('abc124', 'abc123'))
  assert.ok(!sameToken('', 'abc123'))
  assert.ok(!sameToken('abc123', ''))
})

import { guessRole, maskInfo } from '../netlify/functions/lib/members.js'

test('role guess from keywords', () => {
  assert.equal(guessRole('Coach - Level 2', ['coach'], ['paddler']), 'coach')
  assert.equal(guessRole('Racing paddler', ['coach'], ['paddler']), 'paddler')
  assert.equal(guessRole('Coach and paddler', ['coach'], ['paddler']), 'coach')
  assert.equal(guessRole('Parent', ['coach'], ['paddler']), undefined)
  assert.equal(guessRole('anything', [], []), undefined)
})

test('debug masking', () => {
  assert.equal(maskInfo('Call 07123 456789 or a@b.com'), 'Call ##### ###### or <email>')
})

test('race host club codes', () => {
  assert.equal(hostCode('Leighton Buzzard Hasler 2026'), 'LBZ')
  assert.equal(hostCode("Bishop's Stortford Hasler Race 2026"), 'BSF')
  assert.equal(hostCode('Bishops Stortford Winter Series marathon 2025'), 'BSF')
  assert.equal(hostCode('Chelmer Hasler 2026'), 'CLM')
  assert.equal(hostCode('Cambridge Winter Series marathon 2026'), 'CAM')
  assert.equal(hostCode('Royal Leamington Spa Hasler 2025'), 'RLS')
  assert.equal(hostCode('Royal Canoe Club Hasler 2025'), 'ROY')
  assert.equal(hostCode('Hastings 1066 Hasler 2026'), 'HAS')
  assert.equal(hostCode('71st BEDFORD HASLER MARATHON'), 'BED')
})

test('Chris Szechung is Chris Sze (the results spelled his name both ways)', async () => {
  const { sameRacer } = await import('../netlify/functions/lib/match.js')
  const { personKey } = await import('../netlify/functions/lib/crewfit.js')
  assert.ok(sameRacer('CHRIS SZECHUNG', 'Chris Sze'))
  assert.equal(personKey('CHRIS SZECHUNG'), personKey('Chris Sze'))
  assert.ok(!sameRacer('Chris Sze', 'Chris Szeto'))
})
