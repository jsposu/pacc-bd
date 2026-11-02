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
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ version: '1.1.0' }))
  const previous = process.env.PACC_BD_DATA_DIR
  process.env.PACC_BD_DATA_DIR = path.join(root, 'state')
  t.after(() => { if (previous === undefined) delete process.env.PACC_BD_DATA_DIR; else process.env.PACC_BD_DATA_DIR = previous })
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const updateRequest = (async () => Response.json({ tag_name: 'v1.2.0', body: 'New features' })) as typeof fetch
  const { server, port } = await startServer({ port: 0, root, production: true, updateRequest })
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
  const update = await (await fetch(`${url}/api/update`)).json()
  assert.equal(update.available, true)
  assert.equal(update.current, '1.1.0')
  assert.equal(update.url, 'https://github.com/jsposu/pacc-bd/releases/tag/v1.2.0')
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
  const map = Buffer.from('osu file format v14\n[Metadata]\nArtist:Artist\nTitle:Song\nVersion:Hard\nBeatmapID:123\nBeatmapSetID:456\n')
  await fs.writeFile(path.join(osu, 'Songs', 'Hard.osu'), map)
  const { server, port, queue } = await startServer({ root, port: 0, production: true })
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())))
  const base = `http://127.0.0.1:${port}/api`
  const post = async (route: string, body: object) => fetch(`${base}${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  queue.state.collections = [{ id: 1, name: 'Preview', uploader: '', maps: [], reportedCount: 0, fetchedAt: '' }]
  queue.state.currentId = 1
  queue.state.collections[0].maps = [{ id: 123, beatmapsetId: 456, checksum: null, version: 'Hard', mode: 'osu', stars: null, status: 'ranked', artist: 'Artist', title: 'Song', creator: 'Mapper', cover: null, bpm: null, length: null }]
  queue.state.queue.push({ key: '100', collectionId: 1, collectionName: 'Preview', beatmapsetId: 100, artist: 'Artist', title: 'Song', difficultyIds: [1], status: 'done', filename: 'song.osz', filePath: 'existing.osz', bytes: 1, total: 1, error: null, attempts: 1 })
  assert.equal((await post('/stable/connect', { directory: osu })).status, 200)
  const preview = await (await fetch(`${base}/stable/preview?source=collector`)).json()
  assert.equal(preview.maps[0].installed.beatmapId, 123)
  assert.equal((await fetch(`${base}/stable/preview?source=invalid`)).status, 400)
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
  assert.equal((await post('/theme', { theme: 'oled' })).status, 200)
  assert.equal((await post('/theme', { theme: 'unexpected' })).status, 400)
  assert.equal((await (await fetch(`${base}/state`)).json()).theme, 'oled')
  const download = path.join(root, 'keep.osz')
  await fs.writeFile(download, 'Leave downloads alone')
  queue.state.queue[0].filePath = download
  queue.state.queue[0].status = 'pending'
  assert.equal((await post('/queue/clear', {})).status, 400)
  assert.equal(queue.state.queue.length, 1)
  queue.state.queue[0].status = 'done'
  assert.equal((await post('/queue/clear', {})).status, 200)
  assert.deepEqual((await (await fetch(`${base}/state`)).json()).queue, [])
  assert.equal(await fs.readFile(download, 'utf8'), 'Leave downloads alone')
  assert.equal(queue.state.theme, 'oled')
  assert.equal(JSON.parse(await fs.readFile(path.join(root, 'data', 'state.json'), 'utf8')).theme, 'oled')
})
