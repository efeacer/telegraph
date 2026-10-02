/** The ids with one moved before or after another. As it was, for a move that is none. */
export function reorder(ids: string[], moved: string, target: string, place: 'before' | 'after'): string[] {
  if (moved === target || !ids.includes(moved) || !ids.includes(target)) return ids
  const rest = ids.filter((id) => id !== moved)
  const at = rest.indexOf(target) + (place === 'after' ? 1 : 0)
  return [...rest.slice(0, at), moved, ...rest.slice(at)]
}

/** The ids with one moved a place up (-1) or down (1), as far as the ends allow. */
export function step(ids: string[], moved: string, by: -1 | 1): string[] {
  const at = ids.indexOf(moved)
  const neighbour = ids[at + by]
  if (at === -1 || neighbour === undefined) return ids
  return reorder(ids, moved, neighbour, by === -1 ? 'before' : 'after')
}
