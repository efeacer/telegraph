const NAME_LENGTH = 100

/**
 * A name as the user typed it, made fit to show and to type into a session:
 * one line, without keys a terminal would act on. Null for a name that is
 * nothing, which leaves a session to be called as its program calls it.
 */
export function tidyName(text: string): string | null {
  const name = text
    .replace(/[\t\r\n]/g, ' ')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NAME_LENGTH)
    .trim()
  return name === '' ? null : name
}
