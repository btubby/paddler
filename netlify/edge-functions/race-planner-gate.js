// /race-planner/ (the K1 / K2 race planner): for the *race coordinator* role, or admin
// (lib/role-gate.js). A coach without the coordinator role doesn't get in, and the coordinator
// doesn't get into the coaches' pages. The same session lets the page's data calls through
// (netlify/functions/race-plan.js, crews.js).
import { roleGate } from './lib/role-gate.js'

export default roleGate({ role: 'coordinator' })

export const config = { path: ['/race-planner', '/race-planner/*'] }
