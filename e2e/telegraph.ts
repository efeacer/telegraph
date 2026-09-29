import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
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
        { id: 'greeter', name: 'Greeter', command: 'echo "launched in $(basename "$PWD")"' }
      ]
    })
  )
  return { root, projectPath, userData }
}

export function removeWorkspace(workspace: Workspace): void {
  rmSync(workspace.root, { recursive: true, force: true })
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
      // A plain shell keeps the tests independent of the user's own setup.
      SHELL: '/bin/sh'
    }
  })
  return { app, page: await app.firstWindow() }
}
