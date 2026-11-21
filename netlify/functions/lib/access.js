// Who is signed in: with Google, and the roles an admin gave that account (the signed `bscc_session`
// cookie: lib/session.js; the roles list is edited at /roles/). An admin has every role.
//   coach:       the coaches' pages and member data   (/paddlers/, /my-training/, /bscc-stars/)
//   coordinator: the race planner                     (/race-planner/)
import { sessionOf, sessionAllows } from './session.js'

export const signedInAs = (req, role) => sessionAllows(sessionOf(req), role)
