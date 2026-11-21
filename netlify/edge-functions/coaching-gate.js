// The pages for coaches (the *coach* role, or admin: see lib/role-gate.js):
//   /paddlers/       paddler detail (the board)
//   /bscc-stars/     BSCC Star Awards (and the certificate files, /certificates/)
//   /my-training/    training charts
// Left open: the paddler lookup (/paddlers/paddler/, only the public marathon results:
// netlify/functions/crews.js answers /api/paddler for anyone and leaves out everything from
// MemberMojo and anything only coaches may do), the homepage, resources and on the water.
// The race planner is for the race coordinator (race-planner-gate.js).
// The same session also lets the board's data calls through: netlify/functions/members.js
// checks it on /api/members and /api/board, crews.js on /api/crews.
import { roleGate } from './lib/role-gate.js'

const gate = roleGate({ role: 'coach' })

// the lookup pages are open to anyone
const OPEN = /^\/paddlers\/paddler(\/|$)/

export default (request, context) => (OPEN.test(new URL(request.url).pathname) ? context.next() : gate(request, context))

export const config = { path: ['/paddlers', '/paddlers/*', '/bscc-stars', '/bscc-stars/*', '/certificates/*', '/my-training', '/my-training/*'] }
