const path = require('node:path')
const fs = require('node:fs')

function configurePortable(app, env = process.env, platform = process.platform) {
  // electron-builder's launcher supplies the original location. process.execPath
  // points at its temporary extraction directory and must never hold user data.
  if (platform !== 'win32' || !app.isPackaged || !env.PORTABLE_EXECUTABLE_DIR) return null
  const directory = path.resolve(env.PACC_BD_DATA_DIR || env.PANAMA_MAPS_DATA_DIR || env.AIMTHMUS_DATA_DIR || path.join(env.PORTABLE_EXECUTABLE_DIR, 'PACC-BD-data'))
  try {
    fs.mkdirSync(directory, { recursive: true })
    const probe = path.join(directory, `.write-test-${process.pid}`)
    fs.writeFileSync(probe, '', { flag: 'wx' })
    fs.unlinkSync(probe)
    const electronData = path.join(directory, 'electron')
    const crashDumps = path.join(electronData, 'crashes')
    const logs = path.join(electronData, 'logs')
    for (const folder of [electronData, crashDumps, logs]) fs.mkdirSync(folder, { recursive: true })
    // Must run before ready and the single-instance lock, so neither session
    // storage, caches nor appearance settings use the installed app's profile.
    app.setPath('userData', electronData)
    app.setPath('sessionData', electronData)
    app.setPath('crashDumps', crashDumps)
    app.setAppLogsPath(logs)
    env.PACC_BD_DATA_DIR = directory
    return directory
  } catch (error) {
    throw new Error(`Cannot use portable data folder "${directory}". Move the portable .exe to a writable folder, or set PACC_BD_DATA_DIR to one. ${error.message}`)
  }
}

module.exports = { configurePortable }
