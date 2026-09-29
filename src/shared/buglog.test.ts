import { describe, expect, it } from 'vitest'
import { LIMITS, checkWindowReport, clip, describeProblem } from './buglog'

describe('describeProblem', () => {
  it('takes the message and stack of an error', () => {
    const error = new TypeError('nothing to read')
    expect(describeProblem(error)).toEqual({
      message: 'TypeError: nothing to read',
      stack: error.stack
    })
  })

  it('follows the causes of an error', () => {
    const error = new Error('could not save', { cause: new Error('disk is full') })
    expect(describeProblem(error).message).toBe('Error: could not save (caused by Error: disk is full)')
  })

  it('stops following causes that lead back to themselves', () => {
    const error = new Error('round and round')
    error.cause = error
    expect(describeProblem(error).message).toBe('Error: round and round')
  })

  it('describes a thrown string', () => {
    expect(describeProblem('plain words')).toEqual({ message: 'plain words' })
  })

  it('describes a thrown object', () => {
    expect(describeProblem({ code: 'ENOENT' })).toEqual({ message: '{"code":"ENOENT"}' })
  })

  it('describes a value that cannot be written as JSON', () => {
    const loop: Record<string, unknown> = {}
    loop.self = loop
    expect(describeProblem(loop)).toEqual({ message: '[object Object]' })
  })

  it('describes nothing at all', () => {
    expect(describeProblem(undefined)).toEqual({ message: 'undefined' })
  })

  it('cuts a long message and stack down to size', () => {
    const error = new Error('x'.repeat(LIMITS.message * 2))
    error.stack = 'y'.repeat(LIMITS.stack * 2)
    const described = describeProblem(error)
    expect(described.message).toHaveLength(LIMITS.message)
    expect(described.stack).toHaveLength(LIMITS.stack)
  })
})

describe('clip', () => {
  it('leaves short text alone', () => {
    expect(clip('short', 10)).toBe('short')
  })

  it('marks text it has cut', () => {
    expect(clip('0123456789abcdef', 10)).toBe('012345678…')
  })
})

describe('checkWindowReport', () => {
  it('accepts a report from the window', () => {
    const report = { kind: 'window-error', message: 'boom', stack: 'at somewhere' }
    expect(checkWindowReport(report)).toEqual(report)
  })

  it('accepts a report with facts about the situation', () => {
    const report = { kind: 'bug-report', message: 'the wire flickers', detail: { projects: 2 } }
    expect(checkWindowReport(report)).toEqual(report)
  })

  it('rejects kinds that only the main process may record', () => {
    expect(checkWindowReport({ kind: 'window-crash', message: 'boom' })).toBeNull()
  })

  it('rejects a report without a message', () => {
    expect(checkWindowReport({ kind: 'window-error' })).toBeNull()
    expect(checkWindowReport({ kind: 'window-error', message: '   ' })).toBeNull()
  })

  it('rejects what is not a report', () => {
    expect(checkWindowReport(null)).toBeNull()
    expect(checkWindowReport('window-error')).toBeNull()
  })

  it('cuts long text down to size', () => {
    const checked = checkWindowReport({
      kind: 'bug-report',
      message: 'n'.repeat(LIMITS.message * 2),
      stack: 's'.repeat(LIMITS.stack * 2)
    })
    expect(checked?.message).toHaveLength(LIMITS.message)
    expect(checked?.stack).toHaveLength(LIMITS.stack)
  })

  it('drops a stack that is not text', () => {
    expect(checkWindowReport({ kind: 'window-error', message: 'boom', stack: 42 })).toEqual({
      kind: 'window-error',
      message: 'boom'
    })
  })

  it('drops facts that are too large to keep', () => {
    const detail = { blob: 'z'.repeat(LIMITS.detail * 2) }
    expect(checkWindowReport({ kind: 'window-error', message: 'boom', detail })).toEqual({
      kind: 'window-error',
      message: 'boom'
    })
  })

  it('drops facts that are not an object', () => {
    expect(checkWindowReport({ kind: 'window-error', message: 'boom', detail: [1, 2] })).toEqual({
      kind: 'window-error',
      message: 'boom'
    })
  })
})
