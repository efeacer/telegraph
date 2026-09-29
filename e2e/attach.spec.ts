/// <reference lib="dom" />
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { createWorkspace, launch, removeWorkspace, start, type Workspace } from './telegraph'

const PNG = [137, 80, 78, 71, 13, 10, 26, 10]

let workspace: Workspace
let app: ElectronApplication
let page: Page
let kept: string[]

test.beforeEach(async () => {
  workspace = createWorkspace()
  kept = []
  ;({ app, page } = await launch(workspace))
  await start(page, 'Shell')
  await input().focus()
  // What is typed before the prompt is there gets written twice, and long lines end up garbled.
  await expect(terminal()).toContainText('$')
})

test.afterEach(async () => {
  await app.close()
  for (const path of kept) rmSync(path, { force: true })
  removeWorkspace(workspace)
})

function terminal(): ReturnType<Page['locator']> {
  return page.locator('.terminal-view.is-active .xterm-rows')
}

function input(): ReturnType<Page['locator']> {
  return page.locator('.terminal-view.is-active .xterm-helper-textarea')
}

/** Drops files on the terminal the way the system does, which hands over where they are. */
async function drop(...files: string[]): Promise<void> {
  const box = (await page.locator('.terminal-view.is-active').boundingBox())!
  const cdp = await page.context().newCDPSession(page)
  const at = { x: Math.round(box.x + 120), y: Math.round(box.y + 80) }
  const data = { items: [], files, dragOperationsMask: 1 }
  for (const type of ['dragEnter', 'dragOver', 'drop'] as const) {
    await cdp.send('Input.dispatchDragEvent', { type, ...at, data })
  }
}

/** Pastes what Cmd+V would with files on the clipboard, without touching the clipboard. */
async function paste(files: { name: string; type: string; bytes: number[] }[], text?: string) {
  await input().evaluate(
    (element, given) => {
      const transfer = new DataTransfer()
      for (const { name, type, bytes } of given.files) {
        transfer.items.add(new File([new Uint8Array(bytes)], name, { type }))
      }
      if (given.text !== undefined) transfer.setData('text/plain', given.text)
      element.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true })
      )
    },
    { files, text }
  )
}

/** The path the app typed for a pasted image, read back from the terminal. */
async function pathOfPasted(): Promise<string> {
  await expect(terminal()).toContainText(/telegraph-attachments\/pasted-[0-9-]+\.png/)
  await page.keyboard.type(' # end')
  const text = (await terminal().innerText()).replace(/\s*\n\s*/g, '')
  const path = /(\/[^\s#]*telegraph-attachments\/pasted-[0-9-]+\.png)/.exec(text)![1]!
  kept.push(path)
  return path
}

test('types where a dropped screenshot is', async () => {
  const shot = join(workspace.root, 'Screenshot 2026-09-29 at 18.10.12.png')
  writeFileSync(shot, Buffer.from(PNG))
  await page.keyboard.type('test -f ')
  await drop(shot)
  await expect(terminal()).toContainText('Screenshot\\ 2026-09-29\\ at\\ 18.10.12.png')

  // The shell finds the file by what was typed.
  await page.keyboard.type('&& echo found-$((40 + 2))')
  await page.keyboard.press('Enter')
  await expect(terminal()).toContainText('found-42')
})

test('types where each of several dropped files is', async () => {
  const one = join(workspace.root, 'one.png')
  const two = join(workspace.root, 'two notes.txt')
  writeFileSync(one, Buffer.from(PNG))
  writeFileSync(two, 'notes')
  await page.keyboard.type('echo ')
  await drop(one, two)

  await expect(terminal()).toContainText('one.png')
  await expect(terminal()).toContainText('two\\ notes.txt')
  await page.keyboard.type('end-$((40 + 2))')
  await page.keyboard.press('Enter')
  await expect(terminal()).toContainText('two notes.txt end-42')
})

test('keeps a pasted screenshot as a file and types where it is', async () => {
  await page.keyboard.type('echo ')
  await paste([{ name: 'image.png', type: 'image/png', bytes: PNG }])

  const path = await pathOfPasted()
  expect([...readFileSync(path)]).toEqual(PNG)
})

test('still pastes text', async () => {
  await page.keyboard.type('echo ')
  await paste([], 'pasted-text')
  await expect(terminal()).toContainText('echo pasted-text')
})

test('says so when what was pasted cannot be attached', async () => {
  await paste([{ name: 'archive.zip', type: 'application/zip', bytes: [80, 75, 3, 4] }])

  await expect(page.getByRole('alert')).toContainText('Could not attach archive.zip')
  await page.keyboard.type('echo nothing-typed')
  await expect(terminal()).toContainText(/\$ echo nothing-typed/)
})

test('hands Ctrl+V on to the program, which is how Claude looks at the clipboard', async () => {
  // Reads one key the way an agent does, before the terminal line makes anything of it.
  await page.keyboard.type(
    `perl -e 'system("stty raw -echo"); $| = 1; print "set-", 40 + 2; sysread(STDIN, $c, 1); system("stty sane"); print " byte-", ord($c), "\\n"'`
  )
  await page.keyboard.press('Enter')
  await expect(terminal()).toContainText('set-42')
  await page.keyboard.press('Control+v')
  await expect(terminal()).toContainText('byte-22')
})

test('keeps no file when text was pasted', async () => {
  const folder = join(tmpdir(), 'telegraph-attachments')
  const before = existsSync(folder) ? readdirSync(folder) : []
  await page.keyboard.type('echo ')
  await paste([], 'only text')
  await expect(terminal()).toContainText('echo only text')
  expect(existsSync(folder) ? readdirSync(folder) : []).toEqual(before)
})
