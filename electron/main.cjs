const { app, BrowserWindow, dialog, ipcMain, shell, session, Menu } = require('electron')
const path = require('node:path')
const fs = require('node:fs/promises')
const { configurePortable } = require('./portable.cjs')

let portableError = null
try { configurePortable(app) } catch (error) { portableError = error }

let window = null
let server = null
let localOrigin = ''
let zoomFactor = 1
let zoomWriting = Promise.resolve()
const validZoom = value => typeof value === 'number' && Number.isFinite(value) && value >= .75 && value <= 1.5
const trusted = event => window && event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame && event.sender.getURL().startsWith(`${localOrigin}/`)
const externalHosts = new Set(['osu.ppy.sh', 'osucollector.com', 'www.osucollector.com'])

function openTrustedExternal(url) {
  try {
    const target = new URL(url)
    if (target.protocol === 'https:' && (externalHosts.has(target.hostname) || (target.hostname === 'github.com' && /^\/jsposu\/pacc-bd\/releases\/tag\/v\d+\.\d+\.\d+$/.test(target.pathname)))) void shell.openExternal(target.toString())
  } catch { /* Ignore malformed links. */ }
}

async function main() {
  const { startServer } = await import('../build/server/app.js')
  const running = await startServer({ port: 0, root: app.getAppPath(), production: true })
  server = running.server
  localOrigin = `http://127.0.0.1:${running.port}`

  if (process.argv.includes('--smoke-test')) {
    const [state, page] = await Promise.all([fetch(`${localOrigin}/api/state`), fetch(localOrigin)])
    if (!state.ok || !page.ok || !(await page.text()).includes('PACC-BD')) throw new Error('Packaged app did not serve its API and interface.')
    console.log('Desktop smoke test passed.')
    app.quit()
    return
  }

  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  Menu.setApplicationMenu(null)
  try {
    const saved = JSON.parse(await fs.readFile(path.join(app.getPath('userData'), 'appearance.json'), 'utf8'))
    if (validZoom(saved.zoom)) zoomFactor = saved.zoom
  } catch { /* First launch or invalid preference: use 100%. */ }
  window = new BrowserWindow({
    width: 1230, height: 870, minWidth: 390, minHeight: 600,
    title: 'PACC-BD', backgroundColor: '#000000', show: false, autoHideMenuBar: true,
    icon: path.join(app.getAppPath(), 'build', 'icons', 'icon.png'),
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, preload: path.join(__dirname, 'preload.cjs') },
  })
  window.setMenu(null)
  window.webContents.on('did-finish-load', () => window?.webContents.setZoomFactor(zoomFactor))
  window.once('ready-to-show', () => window?.show())
  window.webContents.setWindowOpenHandler(({ url }) => { openTrustedExternal(url); return { action: 'deny' } })
  window.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(`${localOrigin}/`) && url !== localOrigin) { event.preventDefault(); openTrustedExternal(url) }
  })
  window.on('closed', () => { window = null })
  await window.loadURL(localOrigin)
}

if (portableError) {
  dialog.showErrorBox('PACC-BD portable could not start', portableError.message)
  app.exit(1)
} else if (!app.requestSingleInstanceLock()) app.quit()
else {
  app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.focus() } })
  app.on('before-quit', () => server?.close())
  ipcMain.handle('choose-directory', async event => {
    if (!window || event.sender !== window.webContents || !event.sender.getURL().startsWith(`${localOrigin}/`)) return null
    const result = await dialog.showOpenDialog(window, { properties: ['openDirectory', 'createDirectory'] })
    return result.canceled ? null : result.filePaths[0]
  })
  ipcMain.handle('get-zoom', event => {
    if (!trusted(event)) throw new Error('Untrusted window')
    return zoomFactor
  })
  ipcMain.handle('set-zoom', (event, value) => {
    if (!trusted(event) || !validZoom(value)) throw new Error('Invalid zoom')
    zoomWriting = zoomWriting.catch(() => {}).then(async () => {
      const directory = app.getPath('userData')
      const file = path.join(directory, 'appearance.json')
      await fs.mkdir(directory, { recursive: true })
      await fs.writeFile(`${file}.tmp`, JSON.stringify({ zoom: value }))
      await fs.rename(`${file}.tmp`, file)
      zoomFactor = value
      window?.webContents.setZoomFactor(value)
      return value
    })
    return zoomWriting
  })
  app.whenReady().then(main).catch(error => {
    console.error(error)
    dialog.showErrorBox('PACC-BD could not start', error instanceof Error ? error.message : String(error))
    app.exit(1)
  })
  app.on('window-all-closed', () => app.quit())
}
