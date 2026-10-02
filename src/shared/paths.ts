// What a shell reads as it stands: letters and digits of any language, and
// the signs that mean nothing to it.
const PLAIN = /[\p{L}\p{N}\p{M}_\-.,:+@%/=]/u
const CONTROL = /\p{Cc}/u
const IMAGE = /\.(png|jpe?g|gif|webp)$/i

/**
 * The path as it is typed at a prompt, the way a terminal writes a file that
 * was dropped on it. Null for a path that cannot be typed.
 */
export function escapePath(path: string): string | null {
  if (path === '' || CONTROL.test(path)) return null
  return Array.from(path, (character) => (PLAIN.test(character) ? character : `\\${character}`)).join('')
}

/**
 * How a file is written into a session: as a shell takes it, or as a mention,
 * `@path`, which an agent such as Claude reads the file or folder by.
 */
export type AttachStyle = 'path' | 'mention'

/**
 * A file or folder written into a session so that what runs there knows of
 * it. A folder ends in a slash, so that it is not taken for a file. Null for
 * a path that cannot be typed.
 */
export function formatAttachment(path: string, folder: boolean, style: AttachStyle): string | null {
  if (path === '' || CONTROL.test(path)) return null
  const written = folder && !path.endsWith('/') ? `${path}/` : path
  // An image stays a path: an agent takes in a path to an image as the image itself.
  if (style === 'mention' && !written.includes('"') && (folder || !IMAGE.test(written))) {
    // Claude reads a mention up to the first space, and a mention in quotes whole; it does not read escapes.
    return /\s/u.test(written) ? `@"${written}"` : `@${written}`
  }
  return escapePath(written)
}
