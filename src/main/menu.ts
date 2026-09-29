import { Menu, type MenuItemConstructorOptions } from 'electron'
import { CLAUDE_LAUNCHER_ID, SHELL_LAUNCHER_ID } from '@shared/launchers'
import type { Launcher, MenuCommand } from '@shared/types'

const LAUNCHER_SHORTCUTS: Record<string, string> = {
  [SHELL_LAUNCHER_ID]: 'CmdOrCtrl+T',
  [CLAUDE_LAUNCHER_ID]: 'CmdOrCtrl+N'
}

const NUMBERED_SESSIONS = 9

export interface MenuOptions {
  launchers: Launcher[]
  includeDeveloperTools: boolean
  send(command: MenuCommand): void
  showBugLog(): void
}

export function buildMenu(options: MenuOptions): Menu {
  const { launchers, includeDeveloperTools, send, showBugLog } = options
  const startItems: MenuItemConstructorOptions[] = launchers.map((launcher) => ({
    label: `Start ${launcher.name}`,
    accelerator: LAUNCHER_SHORTCUTS[launcher.id],
    click: () => send({ type: 'launch', launcherId: launcher.id })
  }))

  const selectItems: MenuItemConstructorOptions[] = Array.from(
    { length: NUMBERED_SESSIONS },
    (_, index) => ({
      label: `Session ${index + 1}`,
      accelerator: `CmdOrCtrl+${index + 1}`,
      click: () => send({ type: 'select-session', index })
    })
  )

  const template: MenuItemConstructorOptions[] = [
    { role: 'appMenu' },
    {
      label: 'Session',
      submenu: [
        ...startItems,
        { type: 'separator' },
        {
          label: 'Add Project…',
          accelerator: 'CmdOrCtrl+O',
          click: () => send({ type: 'add-project' })
        },
        { type: 'separator' },
        {
          label: 'Clear',
          accelerator: 'CmdOrCtrl+K',
          click: () => send({ type: 'clear' })
        },
        {
          label: 'End Session',
          accelerator: 'CmdOrCtrl+W',
          click: () => send({ type: 'close-session' })
        }
      ]
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        {
          label: 'Next Session',
          accelerator: 'CmdOrCtrl+Shift+]',
          click: () => send({ type: 'next-session' })
        },
        {
          label: 'Previous Session',
          accelerator: 'CmdOrCtrl+Shift+[',
          click: () => send({ type: 'previous-session' })
        },
        { type: 'separator' },
        ...selectItems,
        { type: 'separator' },
        { role: 'togglefullscreen' },
        ...(includeDeveloperTools
          ? ([
              { type: 'separator' },
              { role: 'reload' },
              { role: 'toggleDevTools' }
            ] satisfies MenuItemConstructorOptions[])
          : [])
      ]
    },
    {
      role: 'window',
      submenu: [{ role: 'minimize' }, { role: 'zoom' }, { type: 'separator' }, { role: 'front' }]
    },
    {
      role: 'help',
      submenu: [
        {
          id: 'report-bug',
          label: 'Report a Bug…',
          accelerator: 'CmdOrCtrl+Shift+B',
          click: () => send({ type: 'report-bug' })
        },
        { label: 'Show Bug Log', click: showBugLog }
      ]
    }
  ]

  return Menu.buildFromTemplate(template)
}
