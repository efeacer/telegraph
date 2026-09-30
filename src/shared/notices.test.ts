import { describe, expect, it } from 'vitest'
import { checkNotice, describeNotice, noticeFor } from './notices'

describe('noticeFor', () => {
  it('says that a session waits when it has stopped working unseen', () => {
    expect(noticeFor('working', 'attention', false)).toBe('waiting')
    expect(noticeFor('idle', 'attention', false)).toBe('waiting')
  })

  it('says that a session has ended when nobody saw it end', () => {
    expect(noticeFor('working', 'exited', false)).toBe('ended')
    expect(noticeFor('attention', 'exited', false)).toBe('ended')
  })

  it('says nothing of a session that ended in front of the user', () => {
    expect(noticeFor('idle', 'exited', true)).toBeNull()
  })

  it('says nothing of a session that goes on, or comes to rest while it is watched', () => {
    expect(noticeFor('idle', 'working', false)).toBeNull()
    expect(noticeFor('working', 'idle', true)).toBeNull()
    expect(noticeFor('attention', 'idle', true)).toBeNull()
  })

  it('says a thing once', () => {
    expect(noticeFor('attention', 'attention', false)).toBeNull()
    expect(noticeFor('exited', 'exited', false)).toBeNull()
  })
})

describe('describeNotice', () => {
  it('names the session and the project it waits in', () => {
    expect(describeNotice('waiting', { session: 'Fix the seat picker', project: 'TakeYourSeat' })).toEqual({
      title: 'Fix the seat picker',
      body: 'Waiting for you in TakeYourSeat'
    })
  })

  it('says that a session has ended', () => {
    expect(describeNotice('ended', { session: 'Shell', project: 'telegraph' })).toEqual({
      title: 'Shell',
      body: 'Ended in telegraph'
    })
  })
})

describe('checkNotice', () => {
  const notice = { sessionId: '11111111-1111-4111-8111-111111111111', title: 'Claude', body: 'Waiting for you in telegraph' }

  it('takes a notice from the window', () => {
    expect(checkNotice(notice)).toEqual(notice)
  })

  it('cuts text that goes on and on', () => {
    const checked = checkNotice({ ...notice, title: 't'.repeat(500), body: 'b'.repeat(5000) })
    expect(checked?.title).toHaveLength(120)
    expect(checked?.body).toHaveLength(300)
  })

  it('makes one line of each text', () => {
    expect(checkNotice({ ...notice, title: ' two\nlines\t here ' })?.title).toBe('two lines here')
  })

  it('refuses what is not a notice', () => {
    for (const value of [null, 'text', {}, { ...notice, sessionId: 42 }, { ...notice, title: '' }, { ...notice, body: 7 }, { ...notice, sessionId: '../x' }]) {
      expect(checkNotice(value), JSON.stringify(value)).toBeNull()
    }
  })
})
