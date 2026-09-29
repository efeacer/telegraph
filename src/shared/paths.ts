// What a shell reads as it stands: letters and digits of any language, and
// the signs that mean nothing to it.
const PLAIN = /[\p{L}\p{N}\p{M}_\-.,:+@%/=]/u
const CONTROL = /\p{Cc}/u

/**
 * The path as it is typed at a prompt, the way a terminal writes a file that
 * was dropped on it. Null for a path that cannot be typed.
 */
export function escapePath(path: string): string | null {
  if (path === '' || CONTROL.test(path)) return null
  return Array.from(path, (character) => (PLAIN.test(character) ? character : `\\${character}`)).join('')
}
