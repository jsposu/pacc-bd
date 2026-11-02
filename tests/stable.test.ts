import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Queue } from '../server/queue.js'
import { StableManager, encodeCollectionDb, installedMap, parseCollectionDb } from '../server/stable.js'

const osu = Buffer.from('osu file format v14\n\n[General]\nAudioFilename: audio.mp3\n\n[Metadata]\nTitle:A Song\nArtist:An Artist\nCreator:Mapper\nVersion:Hard\nBeatmapID:12345\nBeatmapSetID:6789\n\n[Difficulty]\nHPDrainRate:5\n')
const hash = createHash('md5').update(osu).digest('hex')
const otherHash = 'a'.repeat(32)

async function fixture(t: TestContext, running: () => Promise<boolean> = async () => false) {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'pacc-bd-stable-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const previous = process.env.PACC_BD_DATA_DIR
  process.env.PACC_BD_DATA_DIR = path.join(root, 'data')
  t.after(() => { if (previous === undefined) delete process.env.PACC_BD_DATA_DIR; else process.env.PACC_BD_DATA_DIR = previous })
  const directory = path.join(root, 'osu!')
  const songs = path.join(directory, 'Songs', '6789 An Artist - A Song')
  await fs.mkdir(songs, { recursive: true })
  const dbFile = path.join(directory, 'collection.db')
  await fs.writeFile(dbFile, encodeCollectionDb({ version: 20250101, collections: [{ name: 'Untouched 🌸', hashes: [otherHash] }, { name: 'Target', hashes: [] }] }))
  const queue = new Queue(path.join(root, 'data', 'state.json'))
  const manager = new StableManager(queue, running)
  return { root, songs, directory, dbFile, queue, manager }
}

test('collection.db round-trips names, unicode, hashes and rejects truncated or trailing bytes', () => {
  const data = { version: 20250101, collections: [{ name: '', hashes: [] }, { name: 'Maps 🌸', hashes: [hash, otherHash] }] }
  const bytes = encodeCollectionDb(data)
  assert.deepEqual(parseCollectionDb(bytes), data)
  assert.equal(bytes[8], 0, 'empty osu! string uses marker 0')
  assert.throws(() => parseCollectionDb(bytes.subarray(0, -1)), /Invalid/)
  assert.throws(() => parseCollectionDb(Buffer.concat([bytes, Buffer.from([0])])), /Invalid/)
  const invalid = Buffer.from(bytes)
  invalid.writeInt32LE(-1, 4)
  assert.throws(() => parseCollectionDb(invalid), /Invalid/)
  assert.throws(() => parseCollectionDb(Buffer.alloc(8)), /Invalid/)
  assert.equal(installedMap(osu).checksum, hash)
  assert.equal(installedMap(osu).beatmapId, 12345)
})

test('installed-map scan matches MD5 and writes backup while preserving other collections', async t => {
  const { root, songs, directory, dbFile, manager } = await fixture(t)
  const mapFile = path.join(songs, 'Hard.osu')
  await fs.writeFile(mapFile, osu)
  const view = await manager.connect(directory)
  assert.equal(view.installedCount, 1)
  assert.equal((await manager.search('12345'))[0].checksum, hash)
  assert.equal((await manager.search('an artist'))[0].version, 'Hard')
  const before = await fs.readFile(dbFile)
  const edited = await manager.edit({ operation: 'add', name: 'Target', hashes: [hash], revision: view.revision, confirmedClosed: true })
  assert.deepEqual(await fs.readFile(edited.backup), before)
  assert.ok(edited.backup.startsWith(path.join(root, 'data', 'stable-backups')))
  assert.deepEqual(parseCollectionDb(await fs.readFile(dbFile)).collections, [{ name: 'Untouched 🌸', hashes: [otherHash] }, { name: 'Target', hashes: [hash] }])
  assert.equal((await manager.collection('Target')).maps[0].installed?.title, 'A Song')
  const repeat = await manager.edit({ operation: 'add', name: 'Target', hashes: [hash], revision: edited.revision, confirmedClosed: true })
  assert.equal(parseCollectionDb(await fs.readFile(dbFile)).collections[1].hashes.length, 1)
  const renamed = await manager.edit({ operation: 'rename', name: 'Target', newName: 'Renamed', revision: repeat.revision, confirmedClosed: true })
  const removed = await manager.edit({ operation: 'remove', name: 'Renamed', hashes: [hash], revision: renamed.revision, confirmedClosed: true })
  const deleted = await manager.edit({ operation: 'delete', name: 'Renamed', revision: removed.revision, confirmedClosed: true })
  assert.deepEqual(parseCollectionDb(await fs.readFile(dbFile)).collections, [{ name: 'Untouched 🌸', hashes: [otherHash] }])
  assert.ok(deleted.backup)
})

test('editing refuses unimported maps, stale revisions, duplicate names and an open game', async t => {
  let running = false
  const { songs, directory, dbFile, manager } = await fixture(t, async () => running)
  const view = await manager.connect(directory)
  const original = await fs.readFile(dbFile)
  const edit = { operation: 'add', name: 'Target', hashes: [hash], revision: view.revision, confirmedClosed: true }
  await assert.rejects(manager.edit(edit), /Import these maps/)
  assert.deepEqual(await fs.readFile(dbFile), original)
  await fs.writeFile(path.join(songs, 'Hard.osu'), osu)
  await assert.rejects(manager.edit(edit), /Import these maps/, 'a refresh is required after importing')
  await manager.list(true)
  await assert.rejects(manager.edit({ ...edit, confirmedClosed: false }), /Confirm/)
  running = true
  await assert.rejects(manager.edit(edit), /Close osu!stable/)
  running = false
  await assert.rejects(manager.edit({ ...edit, revision: 'outdated' }), /changed on disk/)
  await assert.rejects(manager.edit({ operation: 'create', newName: 'target', revision: view.revision, confirmedClosed: true }), /unique/)
  assert.deepEqual(await fs.readFile(dbFile), original)
  const created = await manager.edit({ operation: 'create', newName: 'New', revision: view.revision, confirmedClosed: true })
  await fs.writeFile(dbFile, original)
  await assert.rejects(manager.edit({ operation: 'delete', name: 'New', revision: created.revision, confirmedClosed: true }), /changed on disk/)
  assert.deepEqual(await fs.readFile(dbFile), original)
})

test('a game starting before commit prevents overwrite and leaves a recovery backup', async t => {
  let checks = 0
  const { root, directory, dbFile, manager } = await fixture(t, async () => ++checks > 1)
  const view = await manager.connect(directory)
  const before = await fs.readFile(dbFile)
  await assert.rejects(manager.edit({ operation: 'delete', name: 'Target', revision: view.revision, confirmedClosed: true }), /started during editing/)
  assert.deepEqual(await fs.readFile(dbFile), before)
  assert.equal((await fs.readdir(path.join(root, 'data', 'stable-backups'))).length, 1)
  assert.equal((await fs.readdir(directory)).filter(name => name.endsWith('.tmp')).length, 0)
})

test('saved Collector and ID previews match only imported maps, expanding set-only IDs after import', async t => {
  const { directory, songs, manager, queue } = await fixture(t)
  await fs.writeFile(path.join(songs, 'Hard.osu'), osu)
  const other = Buffer.from(osu.toString().replace('Version:Hard', 'Version:Normal').replace('BeatmapID:12345', 'BeatmapID:54321'))
  await fs.writeFile(path.join(songs, 'Normal.osu'), other)
  await manager.connect(directory)
  queue.state.currentId = 12
  queue.state.collections = [{ id: 12, name: 'Collector set', uploader: '', reportedCount: 4, fetchedAt: '', maps: [
    { id: 12345, beatmapsetId: 6789, checksum: hash, artist: 'An Artist', title: 'A Song', creator: 'Mapper', version: 'Hard', mode: 'osu', stars: 2, status: 'ranked', cover: null, bpm: null, length: null },
    { id: 99999, beatmapsetId: 999, checksum: 'b'.repeat(32), artist: 'Not installed', title: 'Other song', creator: 'Mapper', version: 'Missing', mode: 'osu', stars: null, status: 'ranked', cover: null, bpm: null, length: null },
    { id: 54321, beatmapsetId: 6789, checksum: null, artist: 'An Artist', title: 'A Song', creator: 'Mapper', version: 'Normal', mode: 'osu', stars: null, status: 'ranked', cover: null, bpm: null, length: null },
    { id: 12345, beatmapsetId: 6789, checksum: 'c'.repeat(32), artist: 'An Artist', title: 'A Song', creator: 'Mapper', version: 'Changed checksum', mode: 'osu', stars: null, status: 'ranked', cover: null, bpm: null, length: null },
  ] }]
  const collector = await manager.preview('collector')
  assert.equal(collector.name, 'Collector set')
  assert.equal(collector.total, 4)
  assert.equal(collector.maps.find(map => map.beatmapId === 12345)?.installed?.checksum, hash)
  assert.equal(collector.maps.find(map => map.beatmapId === 54321)?.installed?.beatmapId, 54321)
  assert.equal(collector.maps.find(map => map.beatmapId === 99999)?.installed, null)
  assert.equal(collector.maps.find(map => map.key === `missing:${'c'.repeat(32)}`)?.installed, null, 'do not match a differing checksum by ID')
  queue.state.tournament = { fetchedAt: '', failures: [], entries: [
    { source: '6789', kind: 'beatmapset', requestedId: 6789, beatmapsetId: 6789, difficultyId: null, checksum: null, version: null, stars: null, artist: 'An Artist', title: 'A Song', creator: 'Mapper', cover: null, status: 'ranked' },
    { source: '999', kind: 'beatmapset', requestedId: 999, beatmapsetId: 999, difficultyId: null, checksum: null, version: null, stars: null, artist: 'Not installed', title: 'Other song', creator: 'Mapper', cover: null, status: 'ranked' },
  ] }
  const ids = await manager.preview('tournament')
  assert.equal(ids.maps.filter(map => map.installed).length, 2)
  assert.equal(ids.maps.filter(map => !map.installed).length, 1)
  const edit = await manager.edit({ operation: 'add', name: 'Target', hashes: ids.maps.filter(map => map.installed).map(map => map.installed!.checksum), revision: (await manager.list()).revision, confirmedClosed: true })
  assert.equal(edit.collections.find(c => c.name === 'Target')?.count, 2)
  await assert.rejects(manager.preview('invalid' as 'collector'), /supported preview source/)
})
