// Member photos need a signed-in MemberMojo session, so our server fetches them.
// To keep MemberMojo sign-ins to a minimum (it rate-limits them), the app asks for
// photos in batches: requests made within a short window are collected and sent as
// /api/members/photos?ids=..., one batch at a time. Each photo is fetched once per page load.
const BATCH_SIZE = 40
const COLLECT_MS = 150

const cache = new Map() // member id -> Promise<string|null>
const waiting = new Map() // member id -> resolve
let timer = null
let chain = Promise.resolve()

const idFromPath = path => (String(path || '').match(/(\d+)\/?$/) || [])[1]

async function fetchBatch(ids) {
  // signed-in coaches only: the page-password cookie goes with the request
  const res = await fetch('/api/members/photos?ids=' + ids.join(','), { credentials: 'same-origin' })
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    console.warn('[photos] batch failed:', res.status, data?.error || '')
    return {}
  }
  const found = Object.values(data?.photos || {}).filter(Boolean).length
  console.log(`[photos] ${found} of ${ids.length} members have a photo`)
  return data?.photos || {}
}

function flush() {
  timer = null
  const ids = [...waiting.keys()]
  const resolvers = new Map(waiting)
  waiting.clear()
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const batch = ids.slice(i, i + BATCH_SIZE)
    // one batch after another, never in parallel
    chain = chain.then(() => fetchBatch(batch)).catch(() => ({})).then(photos => {
      batch.forEach(id => resolvers.get(id)(photos?.[id] || null))
    })
  }
}

// Resolves to an image URL for the member's photo, or null when there is none.
export function photoUrl(path) {
  const id = idFromPath(path)
  if (!id) return Promise.resolve(null)
  if (!cache.has(id)) {
    cache.set(id, new Promise(resolve => waiting.set(id, resolve)))
    if (!timer) timer = setTimeout(flush, COLLECT_MS)
  }
  return cache.get(id)
}
