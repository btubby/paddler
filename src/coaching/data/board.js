// The shared board: groups and roles are stored on the server (/api/board) so every
// coach sees the same thing. Each change is applied here straight away and sent as a
// small operation ("move 123 to g1"); the server applies operations one at a time, so
// coaches editing at once don't overwrite each other. Other coaches' changes are picked
// up every 15 seconds and whenever the tab comes back into view.
const POLL_MS = 15000
const RETRY_MS = 5000

export function createBoardSync(state, status) {
  const queue = []
  let sending = false
  let loaded = false
  let version = -1

  // the page-password sign-in cookie goes with every request (same site)
  const headers = () => ({ 'Content-Type': 'application/json' })
  const set = (s, extra = {}) => { status.value = { state: s, ...extra } }

  function adopt(board) {
    if (!board || typeof board.version !== 'number') return
    version = board.version
    state.groups = board.groups || []
    state.roles = board.roles || {}
    set('saved', { updatedAt: board.updatedAt })
  }

  async function get() {
    const res = await fetch('/api/board', { headers: headers() })
    if (res.status === 401) { set('denied'); return null }
    if (!res.ok) throw new Error('HTTP ' + res.status)
    return res.json()
  }

  // first load: take the shared board, or, if nobody has saved one yet, upload ours
  async function load() {
    try {
      const board = await get()
      if (!board) return
      loaded = true
      const serverEmpty = !board.groups?.length && !Object.keys(board.roles || {}).length
      const localHasSome = state.groups.some(g => g.memberIds.length) || Object.keys(state.roles).length
      if (serverEmpty && localHasSome) {
        console.log('[board] no shared board yet: uploading this browser\'s groups as the starting point')
        send({ type: 'init', board: { groups: state.groups, roles: state.roles } })
      } else if (!queue.length) adopt(board)
    } catch (e) {
      console.warn('[board] could not load the shared board:', e.message)
      set('offline')
    }
  }

  async function refresh() {
    if (!loaded || queue.length || sending || document.hidden) return
    try {
      const board = await get()
      if (board && board.version !== version && !queue.length && !sending) adopt(board)
    } catch {}
  }

  function send(op) {
    queue.push(op)
    set('saving')
    pump()
  }

  async function pump() {
    if (sending) return
    sending = true
    while (queue.length) {
      const op = queue[0]
      try {
        const res = await fetch('/api/board', { method: 'POST', headers: headers(), body: JSON.stringify({ op }) })
        const data = await res.json().catch(() => null)
        if (res.status === 401) { set('denied'); break }
        if (res.status === 400) { console.warn('[board] change refused:', data?.error, op); queue.shift(); continue }
        if (!res.ok) throw new Error(data?.error || 'HTTP ' + res.status)
        queue.shift()
        if (!queue.length) adopt(data) // the server's copy includes everyone's changes
      } catch (e) {
        console.warn('[board] not saved yet, retrying:', e.message)
        set('offline')
        await new Promise(r => setTimeout(r, RETRY_MS))
      }
    }
    sending = false
  }

  setInterval(refresh, POLL_MS)
  document.addEventListener('visibilitychange', refresh)
  window.addEventListener('focus', refresh)

  return { load, send }
}
