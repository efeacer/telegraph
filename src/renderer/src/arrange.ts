/** How sessions are laid out side by side: in how many columns, and how many of them each takes. */
export interface Arrangement {
  columns: number
  spans: number[]
}

/**
 * Tiles of about the shape of the window: two columns up to four sessions,
 * three up to nine, four beyond. The last session fills what would
 * otherwise be left empty of its row.
 */
export function arrange(count: number): Arrangement {
  const columns = count <= 1 ? 1 : count <= 4 ? 2 : count <= 9 ? 3 : 4
  const spans = Array.from({ length: count }, () => 1)
  if (count > 0) spans[count - 1] = columns - ((count - 1) % columns)
  return { columns, spans }
}
