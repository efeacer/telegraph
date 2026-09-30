import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { StateStore, parseState } from './store'

let directory: string

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'telegraph-theme-'))
})

afterEach(() => {
  rmSync(directory, { recursive: true, force: true })
})

describe('the theme', () => {
  it('is night until another is chosen', () => {
    expect(new StateStore(join(directory, 'state.json')).get().theme).toBe('night')
  })

  it('is kept across restarts', () => {
    const path = join(directory, 'state.json')
    new StateStore(path).saveTheme('creme')
    expect(new StateStore(path).get().theme).toBe('creme')
    expect(JSON.parse(readFileSync(path, 'utf8')).theme).toBe('creme')
  })

  it('is not one that does not exist', () => {
    const store = new StateStore(join(directory, 'state.json'))
    store.saveTheme('sepia')
    store.saveTheme(42)
    expect(store.get().theme).toBe('night')
    expect(parseState(JSON.stringify({ theme: 'sepia' })).theme).toBe('night')
  })
})
