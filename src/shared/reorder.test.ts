import { describe, expect, it } from 'vitest'
import { reorder, step } from './reorder'

describe('reorder', () => {
  const ids = ['a', 'b', 'c', 'd']

  it('puts an item before another', () => {
    expect(reorder(ids, 'd', 'b', 'before')).toEqual(['a', 'd', 'b', 'c'])
    expect(reorder(ids, 'a', 'c', 'before')).toEqual(['b', 'a', 'c', 'd'])
  })

  it('puts an item after another', () => {
    expect(reorder(ids, 'a', 'c', 'after')).toEqual(['b', 'c', 'a', 'd'])
    expect(reorder(ids, 'd', 'a', 'after')).toEqual(['a', 'd', 'b', 'c'])
  })

  it('puts an item first and last', () => {
    expect(reorder(ids, 'c', 'a', 'before')).toEqual(['c', 'a', 'b', 'd'])
    expect(reorder(ids, 'b', 'd', 'after')).toEqual(['a', 'c', 'd', 'b'])
  })

  it('leaves the order as it is for an item dropped on itself, or one it does not have', () => {
    expect(reorder(ids, 'b', 'b', 'after')).toEqual(ids)
    expect(reorder(ids, 'x', 'b', 'after')).toEqual(ids)
    expect(reorder(ids, 'b', 'x', 'after')).toEqual(ids)
  })
})

describe('step', () => {
  const ids = ['a', 'b', 'c']

  it('moves an item one place up or down', () => {
    expect(step(ids, 'b', -1)).toEqual(['b', 'a', 'c'])
    expect(step(ids, 'b', 1)).toEqual(['a', 'c', 'b'])
  })

  it('goes no further than the ends', () => {
    expect(step(ids, 'a', -1)).toEqual(ids)
    expect(step(ids, 'c', 1)).toEqual(ids)
  })
})
