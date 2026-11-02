const { app, BrowserWindow, dialog, ipcMain, shell, session } = require('electron')
const path = require('node:path')

let window = null
let server = null
let localOrigin = ''
const externalHosts = new Set(['osu.ppy.sh', 'osucollector.com', 'www.osucollector.com'])

function openTrustedExternal(url) {
  try {
    const target = new URL(url)
    if (target.protocol === 'https:' && externalHosts.has(target.hostname)) void shell.openExternal(target.toString())
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
  window = new BrowserWindow({
    width: 1230, height: 870, minWidth: 390, minHeight: 600,
    title: 'PACC-BD', backgroundColor: '#1b151b', show: false,
    icon: path.join(app.getAppPath(), 'build', 'icons', 'icon.png'),
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, preload: path.join(__dirname, 'preload.cjs') },
  })
  window.once('ready-to-show', () => window?.show())
  window.webContents.setWindowOpenHandler(({ url }) => { openTrustedExternal(url); return { action: 'deny' } })
  window.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(`${localOrigin}/`) && url !== localOrigin) { event.preventDefault(); openTrustedExternal(url) }
  })
  window.on('closed', () => { window = null })
  await window.loadURL(localOrigin)
}

if (!app.requestSingleInstanceLock()) app.quit()
else {
  app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.focus() } })
  app.on('before-quit', () => server?.close())
  ipcMain.handle('choose-directory', async event => {
    if (!window || event.sender !== window.webContents || !event.sender.getURL().startsWith(`${localOrigin}/`)) return null
    const result = await dialog.showOpenDialog(window, { properties: ['openDirectory', 'createDirectory'] })
    return result.canceled ? null : result.filePaths[0]
  })
  app.whenReady().then(main).catch(error => {
    console.error(error)
    dialog.showErrorBox('PACC-BD could not start', error instanceof Error ? error.message : String(error))
    app.exit(1)
  })
  app.on('window-all-closed', () => app.quit())
}
