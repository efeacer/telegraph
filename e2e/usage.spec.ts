import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { configDirOf, createWorkspace, launch, removeWorkspace, start, type Workspace } from './telegraph'

const HOUR_S = 60 * 60

let workspace: Workspace
let app: ElectronApplication
let page: Page

/** A launcher that reports the way Claude Code does, to where the session is told to. */
function meter(fiveHour: number, week = 18): Record<string, unknown> {
  const now = Math.floor(Date.now() / 1000)
  const report = JSON.stringify({
    model: { id: 'claude-opus-5-5', display_name: 'Opus 5.5' },
    cost: { total_cost_usd: 4.2088 },
    context_window: { used_percentage: 38 },
    rate_limits: {
      five_hour: { used_percentage: fiveHour, resets_at: now + 2 * HOUR_S + 30 },
      seven_day: { used_percentage: week, resets_at: now + 60 * HOUR_S }
    }
  })
  return {
    id: 'meter',
    name: 'Meter',
    command: `printf '%s' '${report}' > "$TELEGRAPH_USAGE_FILE" && echo reported-$((40 + 2))`
  }
}

function addLauncher(launcher: Record<string, unknown>): void {
  const path = join(workspace.userData, 'state.json')
  const state = JSON.parse(readFileSync(path, 'utf8'))
  state.launchers = [...state.launchers.filter((known: { id: string }) => known.id !== launcher.id), launcher]
  writeFileSync(path, JSON.stringify(state))
}

/** Writes answers into the records of Claude Code, as it would after giving them. */
function recordAnswers(
  answers: { daysAgo: number; model: string; input?: number; output?: number; cacheWrite?: number; cacheRead?: number }[]
): void {
  const folder = join(configDirOf(workspace), 'projects', '-somewhere')
  mkdirSync(folder, { recursive: true })
  const lines = answers.map((answer, index) => {
    const at = new Date()
    at.setDate(at.getDate() - answer.daysAgo)
    at.setHours(12, 0, 0, 0)
    // An answer of today is not from the future, whatever the hour.
    if (answer.daysAgo === 0) at.setTime(Math.min(at.getTime(), Date.now() - 1000))
    return JSON.stringify({
      type: 'assistant',
      timestamp: at.toISOString(),
      requestId: `req_${index}`,
      message: {
        id: `msg_${index}`,
        model: answer.model,
        usage: {
          input_tokens: answer.input ?? 0,
          output_tokens: answer.output ?? 0,
          cache_creation_input_tokens: answer.cacheWrite ?? 0,
          cache_read_input_tokens: answer.cacheRead ?? 0
        }
      }
    })
  })
  writeFileSync(join(folder, '11111111-1111-4111-8111-111111111111.jsonl'), `${lines.join('\n')}\n`)
}

test.beforeEach(() => {
  workspace = createWorkspace()
})

test.afterEach(async () => {
  await app.close()
  removeWorkspace(workspace)
})

async function open(): Promise<void> {
  ;({ app, page } = await launch(workspace))
}

function chip(): ReturnType<Page['locator']> {
  return page.getByRole('button', { name: /^Usage/ })
}

function panel(): ReturnType<Page['locator']> {
  return page.getByRole('region', { name: 'Usage' })
}

test('counts the tokens of today and of the week', async () => {
  recordAnswers([
    { daysAgo: 0, model: 'claude-fable-5-1', input: 140, output: 47_600, cacheWrite: 1_050_000, cacheRead: 10_080_000 },
    { daysAgo: 0, model: 'claude-haiku-4-5-20251001', output: 486 },
    { daysAgo: 2, model: 'claude-fable-5-1', output: 841_700 }
  ])
  await open()
  await expect(chip()).toContainText('1.1M')
  await chip().click()

  await expect(panel().getByText('Tokens today')).toBeVisible()
  await expect(panel().locator('.usage-figure')).toHaveText('1.1M')
  await expect(panel().getByText('10.1M read again from the cache')).toBeVisible()

  const days = panel().getByRole('list', { name: 'Tokens by day' }).getByRole('listitem')
  await expect(days).toHaveCount(7)
  await expect(days.last()).toHaveAccessibleName('Today: 1.1M')
  await expect(days.nth(4)).toHaveAccessibleName(/^\w{3}: 842K$/)
  await expect(days.first()).toHaveAccessibleName(/^\w{3}: 0$/)

  const models = panel().getByRole('list', { name: 'Tokens today by model' }).getByRole('listitem')
  await expect(models).toHaveText([/^Fable 5\.1\s*1\.1M$/, /^Haiku 4\.5\s*486$/])
})

test('knows no limits until a session has reported them', async () => {
  await open()
  await chip().click()
  await expect(panel()).toContainText('The limits of your plan show once a session of Claude started here has answered.')
  await expect(panel().getByRole('meter')).toHaveCount(0)
})

test('shows the limits a session reports', async () => {
  addLauncher(meter(42))
  await open()
  await start(page, 'Meter')
  await expect(page.locator('.terminal-view.is-active .xterm-rows')).toContainText('reported-42')

  await expect(chip()).toContainText('42%')
  await chip().click()
  const fiveHour = panel().getByRole('meter', { name: '5-hour limit' })
  await expect(fiveHour).toHaveAttribute('aria-valuenow', '42')
  await expect(fiveHour).toHaveAttribute('data-level', 'fine')
  await expect(panel()).toContainText(/starts over in 2 h/)

  const week = panel().getByRole('meter', { name: 'Weekly limit' })
  await expect(week).toHaveAttribute('aria-valuenow', '18')
  await expect(panel()).toContainText(/starts over on \w{3} at \d\d:\d\d/)
})

test('says so when a limit is running out', async () => {
  addLauncher(meter(93, 80))
  await open()
  await start(page, 'Meter')
  await expect(chip()).toContainText('93%')
  await chip().click()

  await expect(panel().getByRole('meter', { name: '5-hour limit' })).toHaveAttribute('data-level', 'high')
  await expect(panel().getByRole('meter', { name: 'Weekly limit' })).toHaveAttribute('data-level', 'raised')
  await expect(panel()).toContainText('Nearly used up')
  await expect(panel()).toContainText('Running low')
  // Said to a screen reader as well, which does not read what is inside a meter.
  await expect(panel().getByRole('meter', { name: '5-hour limit' })).toHaveAttribute(
    'aria-valuetext',
    /^93% used, nearly used up, starts over in 2 h/
  )
})

test('closes with Escape', async () => {
  await open()
  await chip().click()
  await expect(panel()).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(panel()).toHaveCount(0)
  await expect(chip()).toBeFocused()
})

test('shows what the session in front has cost and how full its context is', async () => {
  addLauncher(meter(42))
  await open()
  await start(page, 'Meter')
  await chip().click()

  const session = panel().locator('.usage-session')
  await expect(session).toContainText('Opus 5.5')
  await expect(session).toContainText('38% of its context')
  await expect(session).toContainText('$4.21')
})

test('stays open or collapsed as it was left', async () => {
  await open()
  await expect(panel()).toHaveCount(0)
  await chip().click()
  await expect(panel()).toBeVisible()
  await expect(chip()).toHaveAttribute('aria-expanded', 'true')

  await app.close()
  await open()
  await expect(panel()).toBeVisible()

  await chip().click()
  await expect(panel()).toHaveCount(0)
  await app.close()
  await open()
  await expect(chip()).toBeVisible()
  await expect(panel()).toHaveCount(0)
})

test('asks a session to report, unless the project has a status line of its own', async () => {
  addLauncher({ id: 'asked', name: 'Asked', command: 'echo started with', reports: { kind: 'claude' } })
  await open()
  await start(page, 'Asked')
  await expect(page.locator('.terminal-view.is-active .xterm-rows')).toContainText('started with --settings {"statusLine"')
  await page.getByRole('button', { name: /^End / }).click()

  mkdirSync(join(workspace.projectPath, '.claude'))
  writeFileSync(join(workspace.projectPath, '.claude', 'settings.json'), JSON.stringify({ statusLine: { type: 'command', command: 'theirs' } }))
  await start(page, 'Asked')
  await expect(page.locator('.terminal-view.is-active .xterm-rows')).toContainText('started with')
  await expect(page.locator('.terminal-view.is-active .xterm-rows')).not.toContainText('--settings')
})

test('keeps the limits of a session that has ended, and nothing else of it', async () => {
  addLauncher(meter(42))
  await open()
  await start(page, 'Meter')
  await expect(chip()).toContainText('42%')
  await page.locator('.terminal-view.is-active .xterm-helper-textarea').focus()
  await page.keyboard.type('exit')
  await page.keyboard.press('Enter')
  await expect(page.locator('.session')).toHaveAttribute('data-status', 'exited')

  await expect.poll(() => readdirSync(join(workspace.userData, 'usage'))).toEqual(['_limits.json'])
  await expect(chip()).toContainText('42%')
  await app.close()
  await open()
  await expect(chip()).toContainText('42%')
})

test('hands every session the place to report to, and nothing of how it was started', async () => {
  await open()
  await start(page, 'Shell')
  const input = page.locator('.terminal-view.is-active .xterm-helper-textarea')
  await input.focus()
  await page.keyboard.type('echo "to: ${TELEGRAPH_USAGE_FILE##*/usage/}"')
  await page.keyboard.press('Enter')
  await expect(page.locator('.terminal-view.is-active .xterm-rows')).toContainText(/to: [0-9a-f-]{36}\.json/)
})
