import { describe, expect, it } from 'vitest'
import { escapePath } from './paths'

describe('escapePath', () => {
  it('leaves a plain path as it is', () => {
    expect(escapePath('/Users/someone/shots/one-2.png')).toBe('/Users/someone/shots/one-2.png')
  })

  it('escapes the spaces in the name of a screenshot', () => {
    expect(escapePath('/Users/someone/Desktop/Screenshot 2026-09-29 at 18.10.12.png')).toBe(
      '/Users/someone/Desktop/Screenshot\\ 2026-09-29\\ at\\ 18.10.12.png'
    )
  })

  it('escapes the narrow space macOS puts before AM and PM', () => {
    expect(escapePath('/tmp/Screenshot at 6.10.12 PM.png')).toBe(
      '/tmp/Screenshot\\ at\\ 6.10.12\\ PM.png'
    )
  })

  it('escapes what a shell would read as something else', () => {
    expect(escapePath("/tmp/it's $(whoami) & `id`; (1) [2] {3} *?!~#.png")).toBe(
      "/tmp/it\\'s\\ \\$\\(whoami\\)\\ \\&\\ \\`id\\`\\;\\ \\(1\\)\\ \\[2\\]\\ \\{3\\}\\ \\*\\?\\!\\~\\#.png"
    )
  })

  it('keeps letters of other languages', () => {
    expect(escapePath('/tmp/ekran görüntüsü.png')).toBe('/tmp/ekran\\ görüntüsü.png')
  })

  it('cannot escape a line break, so there is no path', () => {
    expect(escapePath('/tmp/two\nlines.png')).toBeNull()
    expect(escapePath('')).toBeNull()
  })
})
