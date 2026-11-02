import assert from 'node:assert/strict'
import { test } from 'node:test'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { request as httpRequest } from 'node:http'
import { startServer } from '../server/app.js'
import { encodeCollectionDb, parseCollectionDb } from '../server/stable.js'

test('production server serves the built app and local API on an ephemeral loopback port only', async t => {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'pacc-bd-desktop-'))
  await fs.mkdir(path.join(root, 'dist'))
  await fs.writeFile(path.join(root, 'dist', 'index.html'), '<title>PACC-BD</title>')
  const previous = process.env.PACC_BD_DATA_DIR
  process.env.PACC_BD_DATA_DIR = path.join(root, 'state')
  t.after(() => { if (previous === undefined) delete process.env.PACC_BD_DATA_DIR; else process.env.PACC_BD_DATA_DIR = previous })
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const { server, port } = await startServer({ port: 0, root, production: true })
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())))
  const address = server.address()
  assert.equal(address && typeof address !== 'string' ? address.address : null, '127.0.0.1')
  assert.ok(port > 0)
  const url = `http://127.0.0.1:${port}`
  const page = await fetch(url)
  assert.equal(page.status, 200)
  assert.match(await page.text(), /PACC-BD/)
  assert.match(page.headers.get('content-security-policy') || '', /script-src 'self'/)
  const state = await fetch(`${url}/api/state`)
  assert.equal(state.status, 200)
  assert.deepEqual((await state.json()).queue, [])
  assert.equal((await fetch(`${url}/api/missing`)).status, 404)
  const badHostStatus = await new Promise<number>((resolve, reject) => {
    const req = httpRequest(url, { headers: { Host: 'example.com' } }, res => { res.resume(); resolve(res.statusCode || 0) })
    req.on('error', reject); req.end()
  })
  assert.equal(badHostStatus, 403)
  assert.equal((await fetch(`${url}/api/pause`, { method: 'POST', headers: { Origin: 'https://evil.example' } })).status, 403)
})

test('local API clears only Collector previews and edits an isolated osu!stable library', async t => {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'pacc-bd-stable-api-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  await fs.mkdir(path.join(root, 'dist'))
  await fs.writeFile(path.join(root, 'dist', 'index.html'), '<title>PACC-BD</title>')
  const previous = process.env.PACC_BD_DATA_DIR
  process.env.PACC_BD_DATA_DIR = path.join(root, 'data')
  t.after(() => { if (previous === undefined) delete process.env.PACC_BD_DATA_DIR; else process.env.PACC_BD_DATA_DIR = previous })
  const osu = path.join(root, 'osu!')
  await fs.mkdir(path.join(osu, 'Songs'), { recursive: true })
  const dbFile = path.join(osu, 'collection.db')
  await fs.writeFile(dbFile, encodeCollectionDb({ version: 20250101, collections: [{ name: 'Original', hashes: [] }] }))
  const { server, port, queue } = await startServer({ root, port: 0, production: true })
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())))
  const base = `http://127.0.0.1:${port}/api`
  const post = async (route: string, body: object) => fetch(`${base}${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  queue.state.collections = [{ id: 1, name: 'Preview', uploader: '', maps: [], reportedCount: 0, fetchedAt: '' }]
  queue.state.currentId = 1
  queue.state.queue.push({ key: '100', collectionId: 1, collectionName: 'Preview', beatmapsetId: 100, artist: 'Artist', title: 'Song', difficultyIds: [1], status: 'done', filename: 'song.osz', filePath: 'existing.osz', bytes: 1, total: 1, error: null, attempts: 1 })
  const cleared = await post('/collections/clear', {})
  assert.equal(cleared.status, 200)
  const state = await (await fetch(`${base}/state`)).json()
  assert.deepEqual(state.collections, [])
  assert.equal(state.currentId, null)
  assert.equal(state.queue.length, 1)
  assert.equal((await post('/stable/connect', { directory: root })).status, 400)
  const connected = await (await post('/stable/connect', { directory: osu })).json()
  assert.equal(connected.collections[0].name, 'Original')
  assert.equal((await post('/stable/edit', { operation: 'create', newName: 'New', revision: connected.revision })).status, 400)
  assert.equal((await post('/stable/edit', { operation: 'create', newName: 'New', revision: connected.revision, confirmedClosed: true })).status, 200)
  assert.deepEqual(parseCollectionDb(await fs.readFile(dbFile)).collections.map(c => c.name), ['Original', 'New'])
  assert.equal((await fetch(`${base}/stable/collection?name=New`)).status, 200)
  assert.equal((await post('/stable/edit', { operation: 'add', name: 'New', hashes: ['b'.repeat(32)], revision: connected.revision, confirmedClosed: true })).status, 400)
  assert.equal((await post('/stable/edit', { operation: 'delete', name: 'New', revision: connected.revision, confirmedClosed: true })).status, 400)
})
