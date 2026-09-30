import { describe, expect, it } from 'vitest'
import { arrange } from './arrange'

describe('arrange', () => {
  it('gives one session the whole space', () => {
    expect(arrange(1)).toEqual({ columns: 1, spans: [1] })
  })

  it('puts two sessions next to each other', () => {
    expect(arrange(2)).toEqual({ columns: 2, spans: [1, 1] })
  })

  it('puts up to four in two columns', () => {
    expect(arrange(4)).toEqual({ columns: 2, spans: [1, 1, 1, 1] })
  })

  it('lets the last session fill the row it would leave half empty', () => {
    expect(arrange(3)).toEqual({ columns: 2, spans: [1, 1, 2] })
    expect(arrange(5)).toEqual({ columns: 3, spans: [1, 1, 1, 1, 2] })
    expect(arrange(7)).toEqual({ columns: 3, spans: [1, 1, 1, 1, 1, 1, 3] })
  })

  it('puts up to nine in three columns, and more in four', () => {
    expect(arrange(9).columns).toBe(3)
    expect(arrange(10)).toEqual({ columns: 4, spans: [1, 1, 1, 1, 1, 1, 1, 1, 1, 3] })
    expect(arrange(16).spans.every((span) => span === 1)).toBe(true)
  })

  it('has nothing to arrange without sessions', () => {
    expect(arrange(0)).toEqual({ columns: 1, spans: [] })
  })
})
