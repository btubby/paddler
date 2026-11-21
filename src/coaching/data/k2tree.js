// Lays people out like a family tree of K2 partnerships: someone at the top, the people
// they have paddled K2 with on the line below, those people's other partners on the line
// below that, and so on, so everyone who is linked by K2s ends up together. Each group of
// linked paddlers is its own tree; people with no K2 partner on the board come last.
//
// people: [{ id, ... }]; pairs: [{ a, b, races }] (ids)
// returns [{ key, people: [...], kind: 'top' | 'next' | 'alone' }, ...] (one entry per line)
export function k2Tree(people, pairs) {
  const byId = new Map(people.map(p => [p.id, p]))
  const links = new Map(people.map(p => [p.id, new Map()])) // id -> (partner id -> races)
  for (const x of pairs) {
    if (!byId.has(x.a) || !byId.has(x.b)) continue
    links.get(x.a).set(x.b, (links.get(x.a).get(x.b) || 0) + x.races)
    links.get(x.b).set(x.a, (links.get(x.b).get(x.a) || 0) + x.races)
  }
  const weight = id => [...links.get(id).values()].reduce((s, r) => s + r, 0)
  const placed = new Set()
  const trees = []
  // biggest families first, each starting from its most-raced paddler
  const starts = people.filter(p => links.get(p.id).size).sort((a, b) => weight(b.id) - weight(a.id))
  for (const start of starts) {
    if (placed.has(start.id)) continue
    const lines = [[start.id]]
    placed.add(start.id)
    for (;;) {
      const prev = lines[lines.length - 1]
      // everyone not yet placed who paddled with someone on the line above, under the
      // partner they raced with most (so the lines between them stay short)
      const next = new Map() // id -> [position of that partner above, races together]
      prev.forEach((id, pos) => {
        for (const [mate, races] of links.get(id)) {
          if (placed.has(mate)) continue
          const had = next.get(mate)
          if (!had || races > had[1]) next.set(mate, [pos, races])
        }
      })
      if (!next.size) break
      const line = [...next.entries()].sort((a, b) => a[1][0] - b[1][0] || b[1][1] - a[1][1]).map(([id]) => id)
      line.forEach(id => placed.add(id))
      lines.push(line)
    }
    trees.push(lines)
  }
  trees.sort((a, b) => b.flat().length - a.flat().length)
  const out = []
  trees.forEach((lines, t) => lines.forEach((ids, i) => out.push({ key: `t${t}-${i}`, kind: i ? 'next' : 'top', people: ids.map(id => byId.get(id)) })))
  const alone = people.filter(p => !placed.has(p.id))
  if (alone.length) out.push({ key: 'alone', kind: 'alone', people: alone })
  return out
}
