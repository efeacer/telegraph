import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Attachments, kindsOf } from './attachments'

const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
const DAY_MS = 24 * 60 * 60 * 1000
const NOW = Date.parse('2026-09-29T18:10:12.000Z')

let root: string
let directory: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'telegraph-attachments-'))
  directory = join(root, 'nested', 'attachments')
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function open(options: Partial<ConstructorParameters<typeof Attachments>[0]> = {}): Attachments {
  return new Attachments({ directory, now: () => NOW, ...options })
}

describe('Attachments', () => {
  it('keeps a pasted image as a file', () => {
    const path = open().save('image/png', PNG)
    expect(path).not.toBeNull()
    expect(dirname(path!)).toBe(directory)
    expect(new Uint8Array(readFileSync(path!))).toEqual(PNG)
  })

  it('names the file after what it is and when it was pasted', () => {
    expect(open().save('image/png', PNG)).toBe(join(directory, 'pasted-2026-09-29-181012.png'))
    expect(open().save('image/jpeg', PNG)).toBe(join(directory, 'pasted-2026-09-29-181012.jpg'))
  })

  it('names the file so that it needs no escaping', () => {
    const name = open().save('image/png', PNG)!.slice(directory.length + 1)
    expect(name).toMatch(/^[a-z0-9.-]+$/)
  })

  it('keeps images pasted in the same second apart', () => {
    const attachments = open()
    const paths = [attachments.save('image/png', PNG), attachments.save('image/png', PNG)]
    expect(paths).toEqual([
      join(directory, 'pasted-2026-09-29-181012.png'),
      join(directory, 'pasted-2026-09-29-181012-2.png')
    ])
  })

  it('keeps the file to the user', () => {
    const path = open().save('image/png', PNG)!
    expect(statSync(path).mode & 0o777).toBe(0o600)
  })

  it('takes a file of any kind', () => {
    expect(open().save('application/pdf', PNG)).toBe(join(directory, 'pasted-2026-09-29-181012.pdf'))
    expect(open().save('text/plain', PNG)).toBe(join(directory, 'pasted-2026-09-29-181012.txt'))
    expect(open().save('application/x-unheard-of', PNG)).toBe(join(directory, 'pasted-2026-09-29-181012.bin'))
    // The second of the same kind in the same second.
    expect(open().save('', PNG)).toBe(join(directory, 'pasted-2026-09-29-181012-2.bin'))
  })

  it('keeps the name the file had, so that the agent knows what it is', () => {
    expect(open().save('application/pdf', PNG, 'Quarterly report.pdf')).toBe(
      join(directory, 'pasted-2026-09-29-181012-Quarterly-report.pdf')
    )
    expect(open().save('', PNG, 'schema.sql')).toBe(join(directory, 'pasted-2026-09-29-181012-schema.sql'))
  })

  it('keeps nothing of a name that could lead elsewhere or would need escaping', () => {
    const path = open().save('text/plain', PNG, '../../etc/pass wd;$(x).txt')!
    expect(dirname(path)).toBe(directory)
    expect(path.slice(directory.length + 1)).toMatch(/^[A-Za-z0-9._-]+$/)
  })

  it('names the file by its kind when its name has nothing to keep', () => {
    expect(open().save('image/png', PNG, '…')).toBe(join(directory, 'pasted-2026-09-29-181012.png'))
    // The name the clipboard gives every image says nothing.
    expect(open().save('image/png', PNG, 'image.png')).toBe(join(directory, 'pasted-2026-09-29-181012-2.png'))
    expect(open().save('image/png', PNG, 42 as never)).toBe(join(directory, 'pasted-2026-09-29-181012-3.png'))
  })

  it('refuses what is not data', () => {
    expect(open().save('image/png', 'text' as never)).toBeNull()
    expect(open().save('image/png', new Uint8Array(0))).toBeNull()
    expect(open().save(42 as never, PNG)).toBeNull()
    expect(existsSync(directory)).toBe(false)
  })

  it('refuses a file that is too large', () => {
    const attachments = open({ maxBytes: 16 })
    expect(attachments.save('image/png', new Uint8Array(17))).toBeNull()
    expect(attachments.save('image/png', new Uint8Array(16))).not.toBeNull()
  })

  it('takes the data as the window sends it', () => {
    const path = open().save('image/png', PNG.buffer as ArrayBuffer)
    expect(new Uint8Array(readFileSync(path!))).toEqual(PNG)
  })

  it('says so when the file cannot be written', () => {
    writeFileSync(join(root, 'nested'), 'in the way')
    expect(open().save('image/png', PNG)).toBeNull()
  })

  it('clears out what was pasted last week', () => {
    mkdirSync(directory, { recursive: true })
    const old = join(directory, 'pasted-2026-09-20-100000.png')
    const recent = join(directory, 'pasted-2026-09-28-100000.png')
    for (const [path, age] of [[old, 9 * DAY_MS], [recent, 1 * DAY_MS]] as const) {
      writeFileSync(path, PNG)
      utimesSync(path, new Date(NOW - age), new Date(NOW - age))
    }

    open().clearOld()
    expect(readdirSync(directory)).toEqual(['pasted-2026-09-28-100000.png'])
  })

  it('leaves alone what it did not put there', () => {
    mkdirSync(directory, { recursive: true })
    const other = join(directory, 'notes.txt')
    writeFileSync(other, 'mine')
    utimesSync(other, new Date(NOW - 30 * DAY_MS), new Date(NOW - 30 * DAY_MS))

    open().clearOld()
    expect(readdirSync(directory)).toEqual(['notes.txt'])
  })

  it('has nothing to clear out before anything was pasted', () => {
    expect(() => open().clearOld()).not.toThrow()
  })
})

describe('kindsOf', () => {
  it('tells folders from files', () => {
    mkdirSync(directory, { recursive: true })
    const file = join(directory, 'notes.txt')
    writeFileSync(file, 'notes')
    expect(kindsOf([directory, file, join(directory, 'gone')])).toEqual(['folder', 'file', null])
  })

  it('reads nothing but a list of paths', () => {
    expect(kindsOf('/' as never)).toEqual([])
    expect(kindsOf([42, '', 'relative/path'] as never)).toEqual([null, null, null])
  })
})
