// Renders build/icon.svg into the app icon. Run with: npx electron scripts/make-icon.cjs
const { execFileSync } = require('node:child_process')
const { mkdirSync, readFileSync, rmSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')
const { BrowserWindow, app } = require('electron')

const SIZE = 1024
const ICONSET_SIZES = [16, 32, 128, 256, 512]
const build = join(__dirname, '..', 'build')

app.dock?.hide()
app.whenReady().then(async () => {
  const window = new BrowserWindow({
    width: SIZE,
    height: SIZE,
    show: false,
    frame: false,
    transparent: true,
    webPreferences: { offscreen: true }
  })
  const svg = readFileSync(join(build, 'icon.svg'), 'utf8')
  const page = `<body style="margin:0;background:transparent">${svg}</body>`
  await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(page)}`)
  const image = (await window.webContents.capturePage()).resize({ width: SIZE, height: SIZE })
  writeFileSync(join(build, 'icon.png'), image.toPNG())

  const iconset = join(build, 'icon.iconset')
  mkdirSync(iconset, { recursive: true })
  for (const size of ICONSET_SIZES) {
    for (const scale of [1, 2]) {
      const suffix = scale === 1 ? '' : '@2x'
      const pixels = size * scale
      const resized = image.resize({ width: pixels, height: pixels, quality: 'best' })
      writeFileSync(join(iconset, `icon_${size}x${size}${suffix}.png`), resized.toPNG())
    }
  }
  execFileSync('iconutil', ['--convert', 'icns', '--output', join(build, 'icon.icns'), iconset])
  rmSync(iconset, { recursive: true, force: true })
  app.quit()
})
