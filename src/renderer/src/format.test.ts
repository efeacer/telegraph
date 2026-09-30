import { describe, expect, it } from 'vitest'
import { compact, describeAge, describeReset, modelName, newTokens, wholePercent } from './format'

const NOW = new Date('2026-09-29T18:00:00')

function ago(ms: number): string {
  return new Date(NOW.getTime() - ms).toISOString()
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

describe('describeAge', () => {
  it('says how long ago something was', () => {
    expect(describeAge(ago(20_000), NOW)).toBe('just now')
    expect(describeAge(ago(MINUTE), NOW)).toBe('1 minute ago')
    expect(describeAge(ago(59 * MINUTE), NOW)).toBe('59 minutes ago')
    expect(describeAge(ago(HOUR), NOW)).toBe('1 hour ago')
    expect(describeAge(ago(5 * HOUR), NOW)).toBe('5 hours ago')
  })

  it('counts days by the calendar', () => {
    expect(describeAge(ago(19 * HOUR), NOW)).toBe('yesterday')
    expect(describeAge(ago(40 * HOUR), NOW)).toBe('yesterday')
    expect(describeAge(ago(43 * HOUR), NOW)).toBe('2 days ago')
    expect(describeAge(ago(6 * DAY), NOW)).toBe('6 days ago')
  })

  it('gives the day of what is longer ago', () => {
    expect(describeAge(ago(7 * DAY), NOW)).toBe('22 Sep')
    expect(describeAge(ago(400 * DAY), NOW)).toBe('25 Aug 2025')
  })

  it('takes what lies ahead, by a clock that is off, for now', () => {
    expect(describeAge(ago(-5 * MINUTE), NOW)).toBe('just now')
  })

  it('says nothing about a time it cannot read', () => {
    expect(describeAge('nonsense', NOW)).toBe('')
  })
})

describe('compact', () => {
  it('writes a count in as few figures as say it', () => {
    expect(compact(0)).toBe('0')
    expect(compact(486)).toBe('486')
    expect(compact(999)).toBe('999')
    expect(compact(1_000)).toBe('1K')
    expect(compact(1_234)).toBe('1.23K')
    expect(compact(47_600)).toBe('47.6K')
    expect(compact(841_700)).toBe('842K')
    expect(compact(999_950)).toBe('1M')
    expect(compact(1_050_000)).toBe('1.05M')
    expect(compact(10_080_000)).toBe('10.1M')
    expect(compact(99_480_000)).toBe('99.5M')
    expect(compact(1_234_000_000)).toBe('1.23B')
  })
})

describe('describeReset', () => {
  it('says how long it is until a limit starts over', () => {
    expect(describeReset(new Date(NOW.getTime() + 40 * MINUTE).toISOString(), NOW)).toBe('in 40 min')
    expect(describeReset(new Date(NOW.getTime() + 130 * MINUTE).toISOString(), NOW)).toBe('in 2 h 10 min')
    expect(describeReset(new Date(NOW.getTime() + 2 * HOUR).toISOString(), NOW)).toBe('in 2 h')
    expect(describeReset(new Date(NOW.getTime() + 20_000).toISOString(), NOW)).toBe('in under a minute')
  })

  it('gives the day and the hour of what is further off', () => {
    // NOW is a Tuesday at six in the evening.
    expect(describeReset(new Date(2026, 9, 2, 9, 0).toISOString(), NOW)).toBe('on Fri at 09:00')
    expect(describeReset(new Date(2026, 8, 30, 18, 30).toISOString(), NOW)).toBe('on Wed at 18:30')
  })

  it('says nothing about a time it cannot read or that has passed', () => {
    expect(describeReset('nonsense', NOW)).toBe('')
    expect(describeReset(new Date(NOW.getTime() - HOUR).toISOString(), NOW)).toBe('')
  })
})

describe('modelName', () => {
  it('writes the name of a model the way it is said', () => {
    expect(modelName('claude-fable-5-1')).toBe('Fable 5.1')
    expect(modelName('claude-opus-5-5')).toBe('Opus 5.5')
    expect(modelName('claude-opus-5')).toBe('Opus 5')
    expect(modelName('claude-haiku-4-5-20251001')).toBe('Haiku 4.5')
    expect(modelName('claude-opus-4-5-20251101')).toBe('Opus 4.5')
  })

  it('leaves a name it does not know the make of as it is', () => {
    expect(modelName('gpt-6-sol')).toBe('gpt-6-sol')
    expect(modelName('claude-3-5-sonnet-20241022')).toBe('claude-3-5-sonnet-20241022')
  })
})

describe('newTokens', () => {
  it('counts what was read for the first time and what was written', () => {
    expect(newTokens({ input: 140, output: 47_600, cacheWrite: 1_050_000, cacheRead: 10_080_000 })).toBe(
      1_097_740
    )
  })
})

describe('wholePercent', () => {
  it('rounds to a whole figure', () => {
    expect(wholePercent(42.4)).toBe(42)
    expect(wholePercent(42.5)).toBe(43)
    expect(wholePercent(0.2)).toBe(0)
  })

  it('says all of it is used only when all of it is', () => {
    expect(wholePercent(99.5)).toBe(99)
    expect(wholePercent(99.99)).toBe(99)
    expect(wholePercent(100)).toBe(100)
  })
})
