import assert from 'node:assert/strict'
import { test } from 'node:test'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const { configurePortable } = createRequire(import.meta.url)('../electron/portable.cjs')
function fakeApp(isPackaged = true) {
  const paths: Record<string, string> = {}
  return { isPackaged, paths, setPath: (key: string, value: string) => { paths[key] = value }, setAppLogsPath: (value: string) => { paths.logs = value } }
}
test('Windows portable keeps state, Electron profile, caches and logs beside the original launcher', async t => {
  const folder = await fs.mkdtemp(path.join(tmpdir(), 'pacc portable-'))
  t.after(() => fs.rm(folder, { recursive: true, force: true }))
  const app = fakeApp(), env: Record<string, string> = { PORTABLE_EXECUTABLE_DIR: folder }
  const directory = path.join(folder, 'PACC-BD-data')
  assert.equal(configurePortable(app, env, 'win32'), directory)
  assert.equal(env.PACC_BD_DATA_DIR, directory)
  assert.equal(app.paths.userData, path.join(directory, 'electron'))
  assert.equal(app.paths.sessionData, app.paths.userData)
  assert.equal(app.paths.crashDumps, path.join(directory, 'electron', 'crashes'))
  assert.equal(app.paths.logs, path.join(directory, 'electron', 'logs'))
  const saved = path.join(directory, 'state.json')
  await fs.writeFile(saved, '{"queue":[]}')
  configurePortable(fakeApp(), { PORTABLE_EXECUTABLE_DIR: folder }, 'win32')
  assert.equal(await fs.readFile(saved, 'utf8'), '{"queue":[]}', 'relaunch does not overwrite data')
  assert.equal((await fs.readdir(directory)).some(name => name.startsWith('.write-test-')), false)
})
test('portable honours existing data-directory overrides without using the old installed profile', async t => {
  const folder = await fs.mkdtemp(path.join(tmpdir(), 'pacc-override-'))
  t.after(() => fs.rm(folder, { recursive: true, force: true }))
  for (const variable of ['PACC_BD_DATA_DIR', 'PANAMA_MAPS_DATA_DIR', 'AIMTHMUS_DATA_DIR']) {
    const override = path.join(folder, variable), app = fakeApp()
    const env: Record<string, string> = { PORTABLE_EXECUTABLE_DIR: folder, [variable]: override }
    assert.equal(configurePortable(app, env, 'win32'), override)
    assert.equal(env.PACC_BD_DATA_DIR, override)
    assert.equal(app.paths.userData, path.join(override, 'electron'))
  }
})
test('Linux, unpacked Windows and development runs keep their original data behaviour', () => {
  for (const [platform, packaged, env] of [['linux', true, { PORTABLE_EXECUTABLE_DIR: '/unused' }], ['win32', true, {}], ['win32', false, { PORTABLE_EXECUTABLE_DIR: '/unused' }]] as const) {
    const app = fakeApp(packaged), before = { ...env }
    assert.equal(configurePortable(app, env, platform), null)
    assert.deepEqual(app.paths, {})
    assert.deepEqual(env, before)
  }
})
test('unwritable portable location fails clearly instead of silently writing to the user profile', async t => {
  const folder = await fs.mkdtemp(path.join(tmpdir(), 'pacc-blocked-'))
  t.after(() => fs.rm(folder, { recursive: true, force: true }))
  await fs.writeFile(path.join(folder, 'PACC-BD-data'), 'Do not overwrite')
  const app = fakeApp(), env: Record<string, string> = { PORTABLE_EXECUTABLE_DIR: folder }
  assert.throws(() => configurePortable(app, env, 'win32'), /Move the portable .exe to a writable folder/)
  assert.deepEqual(app.paths, {})
  assert.equal(env.PACC_BD_DATA_DIR, undefined)
  assert.equal(await fs.readFile(path.join(folder, 'PACC-BD-data'), 'utf8'), 'Do not overwrite')
})
