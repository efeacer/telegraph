import { describe, expect, it } from 'vitest'
import { describeAge } from './format'

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
