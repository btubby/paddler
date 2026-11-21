// Club code used in the Hasler results (Bishops Stortford CC = BSF).
export const CLUB_CODE = 'BSF'

// The roster itself (who exists, names, profile links) now comes from MemberMojo.
// This file only holds first-run defaults that MemberMojo can't know: who starts
// in which coaching group, and the role of people we already know by MemberMojo id.
// After first load, the browser's saved choices win.
const KNOWN = {
  // paddlers
  //'5046259': { role: 'paddler', group: 'g1' }, // Alice Parker
  //'4926310': { role: 'paddler', group: 'g1' }, // James Breeze
  //'4970888': { role: 'paddler' }, // Ben Spinola
  //'4846685': { role: 'paddler' }, // Jasper
  //'4859575': { role: 'paddler' }, // Oleh Kuzmenko
  //'4846684': { role: 'paddler' }, // Ed
  '4848813': { role: 'paddler' }, // KerstinQ
  // coaches
  //'4865540': { role: 'coach' }, // Jaroslav
  '4849207': { role: 'coach' }, // Dave
 // '4861714': { role: 'coach' }, // RobertG
 // '4882781': { role: 'coach' } // Petr
}

const GROUPS = [
  { id: 'g1', name: 'Group A' },
  { id: 'g2', name: 'Group B' }
]

export function buildSeed() {
  return {
    directory: [], // last list read from MemberMojo
    roles: Object.fromEntries(Object.entries(KNOWN).map(([id, k]) => [id, k.role])),
    divisions: {}, // per member id: { division, demotionOffered, divisionSource }
    groups: GROUPS.map(g => ({
      ...g,
      memberIds: Object.entries(KNOWN).filter(([, k]) => k.group === g.id).map(([id]) => id)
    }))
  }
}
