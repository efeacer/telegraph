import { mkdtempSync, mkdirSync, realpathSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'

export interface Workspace {
  root: string
  projectPath: string
  userData: string
}

/** A folder with one project in it and the state file that lists it. */
export function createWorkspace(): Workspace {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'telegraph-e2e-')))
  const projectPath = join(root, 'signal-box')
  mkdirSync(projectPath)

  const userData = join(root, 'user-data')
  mkdirSync(userData)
  writeFileSync(
    join(userData, 'state.json'),
    JSON.stringify({
      projects: [{ id: 'project-1', name: 'signal-box', path: projectPath }],
      launchers: [
        { id: 'shell', name: 'Shell', command: null },
        { id: 'greeter', name: 'Greeter', command: 'echo "launched in $(basename "$PWD")"' },
        {
          // Says what it was started with, in place of an agent.
          id: 'parrot',
          name: 'Parrot',
          command: 'echo started with',
          modelFlag: '--model',
          providers: ['aviary'],
          models: [{ id: 'swift', name: 'Swift, latest' }],
          modes: [{ id: 'continue', name: 'continue last chat', args: '--continue' }],
          chats: { kind: 'claude', flag: '--resume' }
        },
        { id: 'missing', name: 'Missing', command: 'telegraph-no-such-program --flag' }
      ]
    })
  )
  // The catalogue as the app would have kept it, so that no test needs the network.
  writeFileSync(
    join(userData, 'models.json'),
    JSON.stringify({
      fetchedAt: Date.now(),
      providers: {
        aviary: [
          { id: 'swift-5', name: 'Swift 5', releasedAt: '2026-09-01' },
          { id: 'swift-4', name: 'Swift 4', releasedAt: '2026-03-01' }
        ]
      }
    })
  )
  return { root, projectPath, userData }
}

/** Where the tests keep chats, in place of the user's own. */
export function configDirOf(workspace: Workspace): string {
  return join(workspace.root, 'claude-config')
}

/** Writes the record of a chat the way Claude Code does. */
export function recordChat(
  workspace: Workspace,
  chat: { id: string; title: string; minutesAgo: number; folder?: string }
): void {
  const folder = chat.folder ?? workspace.projectPath
  const records = join(configDirOf(workspace), 'projects', folder.replace(/[^A-Za-z0-9]/g, '-'))
  mkdirSync(records, { recursive: true })
  const path = join(records, `${chat.id}.jsonl`)
  const lines = [
    { type: 'mode', mode: 'default' },
    { type: 'user', cwd: folder, entrypoint: 'cli', message: { role: 'user', content: 'hello' } },
    { type: 'ai-title', aiTitle: chat.title }
  ]
  writeFileSync(path, lines.map((line) => JSON.stringify(line)).join('\n'))
  const at = new Date(Date.now() - chat.minutesAgo * 60_000)
  utimesSync(path, at, at)
}

export function removeWorkspace(workspace: Workspace): void {
  rmSync(workspace.root, { recursive: true, force: true })
}

/** Fills in a blank of the sentence that starts a session. */
export async function choose(page: Page, blank: string, option: string): Promise<void> {
  await page.getByRole('combobox', { name: blank }).click()
  await page.getByRole('option', { name: option, exact: true }).click()
}

export async function start(page: Page, launcher: string): Promise<void> {
  await choose(page, 'Agent', launcher)
  await page.getByRole('button', { name: `Start ${launcher}` }).click()
}

export async function launch(
  workspace: Workspace
): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: [join(__dirname, '..')],
    env: {
      ...process.env,
      TELEGRAPH_E2E: '1',
      TELEGRAPH_USER_DATA: workspace.userData,
      CLAUDE_CONFIG_DIR: configDirOf(workspace),
      // A plain shell keeps the tests independent of the user's own setup.
      SHELL: '/bin/sh'
    }
  })
  return { app, page: await app.firstWindow() }
}
