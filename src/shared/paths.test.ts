import { describe, expect, it } from 'vitest'
import { escapePath, formatAttachment } from './paths'

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

describe('formatAttachment', () => {
  it('writes a file as a shell takes it', () => {
    expect(formatAttachment('/Users/ada/notes file.txt', false, 'path')).toBe('/Users/ada/notes\\ file.txt')
  })

  it('marks a folder by the slash at its end', () => {
    expect(formatAttachment('/Users/ada/my project', true, 'path')).toBe('/Users/ada/my\\ project/')
  })

  it('mentions a file for an agent that reads what is mentioned', () => {
    expect(formatAttachment('/Users/ada/notes.txt', false, 'mention')).toBe('@/Users/ada/notes.txt')
  })

  it('puts a name with spaces in quotes for such an agent, which is how it reads it', () => {
    expect(formatAttachment('/Users/ada/notes file.txt', false, 'mention')).toBe('@"/Users/ada/notes file.txt"')
    expect(formatAttachment('/Users/ada/my project', true, 'mention')).toBe('@"/Users/ada/my project/"')
  })

  it('writes a path as a shell takes it where a mention could not hold it', () => {
    expect(formatAttachment('/Users/ada/say "hi".txt', false, 'mention')).toBe('/Users/ada/say\\ \\"hi\\".txt')
  })

  it('leaves an image as a path, which such an agent takes in as an image', () => {
    expect(formatAttachment('/tmp/pasted-2026-10-02-101010.png', false, 'mention')).toBe('/tmp/pasted-2026-10-02-101010.png')
    expect(formatAttachment('/Users/ada/Screen Shot.JPG', false, 'mention')).toBe('/Users/ada/Screen\\ Shot.JPG')
  })

  it('writes nothing for a path that cannot be typed', () => {
    expect(formatAttachment('/tmp/two\nlines', false, 'mention')).toBeNull()
  })
})
