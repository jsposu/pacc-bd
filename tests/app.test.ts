import assert from 'node:assert/strict'
import { test } from 'node:test'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import yazl from 'yazl'
import { Readable } from 'node:stream'
import { randomBytes } from 'node:crypto'
import { fetchCollection, normalizeMap, parseCollectionId } from '../server/collector.js'
import { validOsz } from '../server/files.js'
import { downloadURL, requestDownload, retryAfter } from '../server/mirrors.js'
import { migrateLegacyState } from '../server/migration.js'
import { Queue, selectedSets } from '../server/queue.js'
import { parseOsuInputs, resolveOsuInputs } from '../server/osu.js'
import type { Collection } from '../server/types.js'
import { copy, localizeError } from '../src/i18n.js'

const raw = (id: number, setId: number | null = 100) => ({ id, beatmapset_id: setId, checksum: 'a'.repeat(32), version: 'Insane', difficulty_rating: 5.7, beatmapset: { id: setId, title: 'Test song', artist: 'Test artist', creator: 'Mapper' } })
const coll: Collection = { id: 44, name: 'Test', uploader: 'Tester', reportedCount: 3, fetchedAt: new Date().toISOString(), maps: [raw(1), raw(2), raw(3, 101)].map(m => ({ id: m.id, beatmapsetId: m.beatmapset_id, checksum: m.checksum, version: m.version, stars: m.difficulty_rating, mode: 'osu', status: 'ranked', artist: m.beatmapset.artist, title: m.beatmapset.title, creator: m.beatmapset.creator, cover: null, bpm: null, length: null })) }

async function archive(): Promise<Buffer> {
  const zip = new yazl.ZipFile()
  zip.addBuffer(randomBytes(2000), 'map.osu')
  zip.end()
  const chunks: Buffer[] = []
  for await (const chunk of Readable.from(zip.outputStream)) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks)
}

test('accepts only numeric IDs and Collector collection URLs', () => {
  assert.equal(parseCollectionId(' 44 '), 44)
  assert.equal(parseCollectionId('https://osucollector.com/collections/44/speed-practice?foo=bar'), 44)
  for (const value of ['https://example.com/collections/44', 'http://osucollector.com/collections/44', 'https://osucollector.com.evil.org/collections/44', 'https://osucollector.com@evil.org/collections/44', 'https://osucollector.com/api/collections/44', '-44', '0']) assert.throws(() => parseCollectionId(value))
})

test('fetches all cursor pages, preserves IDs and checksum, deduplicates difficulties', async () => {
  const urls: string[] = []
  const request = (async (url: string) => { urls.push(url); return Response.json(url.includes('beatmapsV2') ? url.includes('cursor=9') ? { beatmaps: [raw(2), raw(3, null)], nextPageCursor: null, hasMore: false } : { beatmaps: [raw(1), raw(2)], nextPageCursor: 9, hasMore: true } : { id: 44, name: 'Test', uploader: { username: 'Tester' }, beatmapCount: 3 }) }) as typeof fetch
  const result = await fetchCollection(44, request)
  assert.deepEqual(result.maps.map(map => map.id), [1, 2, 3])
  assert.equal(result.maps[0].checksum, 'a'.repeat(32))
  assert.equal(result.maps[2].beatmapsetId, null)
  assert.equal(urls.length, 3)
  assert.match(urls[2], /cursor=9/)
})

test('fails closed on repeated cursor', async () => {
  const request = (async (url: string) => Response.json(url.includes('beatmapsV2') ? { beatmaps: [], hasMore: true, nextPageCursor: 'same' } : { id: 44 })) as typeof fetch
  await assert.rejects(fetchCollection(44, request), /repeated cursor/)
})

test('deduplicates selected difficulties into sets', () => {
  assert.deepEqual([...selectedSets(coll, [1, 2, 3])], [[100, [1, 2]], [101, [3]]])
})

const osuSet = { id: 100, artist: 'Test artist', title: 'Test song', creator: 'Mapper', status: 'ranked', bpm: 180, covers: { cover: 'https://assets.ppy.sh/beatmaps/100/covers/cover.jpg' }, beatmaps: [{ id: 11, version: 'Insane', checksum: 'a'.repeat(32), difficulty_rating: 5.2 }, { id: 12, version: 'Hard', checksum: 'b'.repeat(32), difficulty_rating: 3.7 }] }
const osuHTML = `<script id="json-beatmapset" type="application/json">${JSON.stringify(osuSet)}</script>`
test('parses pasted osu! IDs and links; rejects untrusted URLs and ambiguous values', () => {
  assert.deepEqual(parseOsuInputs('11, https://osu.ppy.sh/beatmapsets/100#osu/12\nhttps://osu.ppy.sh/beatmapsets/100', 'beatmap').map(({ kind, id }) => [kind, id]), [['beatmap', 11], ['beatmap', 12], ['beatmapset', 100]])
  assert.equal(parseOsuInputs('100', 'beatmapset')[0].kind, 'beatmapset')
  assert.equal(parseOsuInputs('11 11', 'beatmap').length, 1)
  for (const input of ['https://osu.ppy.sh.evil.test/beatmaps/11', 'http://osu.ppy.sh/beatmaps/11', 'https://osu.ppy.sh@evil.test/beatmaps/11', 'https://osu.ppy.sh/api/v2/beatmaps/11', '0', 'javascript:alert(1)']) assert.throws(() => parseOsuInputs(input, 'beatmap'))
  assert.throws(() => parseOsuInputs(Array.from({ length: 201 }, (_, i) => String(i + 1)).join(' '), 'beatmap'), /200/)
})

test('resolves public osu! pages, caches sibling difficulties, reports failures without losing successes', async () => {
  let calls = 0
  const request = (async (url: string) => { calls++; return url.endsWith('/999') ? new Response(null, { status: 404 }) : new Response(osuHTML) }) as typeof fetch
  const result = await resolveOsuInputs('11 12 https://osu.ppy.sh/beatmapsets/100 999', 'beatmap', request, 0)
  assert.equal(calls, 2)
  assert.deepEqual(result.entries.map(entry => [entry.beatmapsetId, entry.difficultyId, entry.checksum]), [[100, 11, 'a'.repeat(32)], [100, 12, 'b'.repeat(32)], [100, null, null]])
  assert.deepEqual(result.entries.map(entry => entry.bpm), [180, 180, 180])
  assert.deepEqual(result.entries[2].setDifficulties?.map(diff => diff.stars), [5.2, 3.7])
  assert.equal(result.failures.length, 1)
  assert.match(result.failures[0].reason, /404/)
  const redirect = (async () => new Response(null, { status: 302, headers: { location: 'https://localhost/private' } })) as typeof fetch
  const blocked = await resolveOsuInputs('11', 'beatmap', redirect, 0)
  assert.match(blocked.failures[0].reason, /unexpected host/)
  const wrong = await resolveOsuInputs('13', 'beatmap', (async () => new Response(osuHTML)) as typeof fetch, 0)
  assert.match(wrong.failures[0].reason, /not available/)
})

test('tournament previews persist; both sources share one queue per beatmapset', async t => {
  const dir = await fs.mkdtemp(path.join(tmpdir(), 'pacc-bd-tournament-'))
  t.after(() => fs.rm(dir, { recursive: true, force: true }))
  const zip = await archive()
  const request = (async () => new Response(new Uint8Array(zip))) as typeof fetch
  const q = new Queue(path.join(dir, 'state.json'), undefined, request)
  await q.settings({ directory: path.join(dir, 'out'), mirror: 'direct' })
  await q.setCollection(coll)
  const manifest = await resolveOsuInputs('11 12', 'beatmap', (async () => new Response(osuHTML)) as typeof fetch, 0)
  await q.setTournament(manifest)
  assert.equal(await q.enqueueTournament([100]), 1)
  await new Promise<void>((resolve, reject) => { const interval = setInterval(() => { if (q.state.queue[0]?.status === 'done') { clearInterval(interval); resolve() } else if (q.state.queue[0]?.status === 'failed') { clearInterval(interval); reject(new Error(q.state.queue[0].error || 'failed')) } }, 20) })
  assert.equal(await q.enqueue(44, [1, 2]), 0)
  assert.deepEqual(q.state.queue[0].difficultyIds.sort((a, b) => a - b), [1, 2, 11, 12])
  assert.equal(q.state.queue.length, 1)
  assert.equal((await Queue.open(path.join(dir, 'state.json'), request)).state.tournament?.entries.length, 2)
  await assert.rejects(q.enqueueTournament([999]), /outside/)
})

test('prefers full Collector cover for the map background and rejects untrusted image hosts', () => {
  const map = { ...raw(1), beatmapset: { ...raw(1).beatmapset, covers: { card: 'https://assets.ppy.sh/beatmaps/100/covers/card.jpg', cover: 'https://assets.ppy.sh/beatmaps/100/covers/cover.jpg' } } }
  assert.equal(normalizeMap(map)?.cover, map.beatmapset.covers.cover)
  map.beatmapset.covers.cover = 'https://example.com/other.jpg'
  assert.equal(normalizeMap(map)?.cover, map.beatmapset.covers.card)
  map.beatmapset.covers.card = 'https://example.com/card.jpg'
  assert.equal(normalizeMap(map)?.cover, null)
})

test('English and Spanish copy and backend diagnostics stay available', () => {
  assert.equal(copy.es.downloadAll, 'Descargar todo')
  assert.equal(copy.en.downloadAll, 'Download all')
  assert.deepEqual([copy.en.themeTeam, copy.en.themeLight, copy.en.themeOled], ['Dark Theme', 'Light Theme', 'Oled Theme'])
  assert.deepEqual([copy.es.themeTeam, copy.es.themeLight, copy.es.themeOled], ['Tema oscuro', 'Tema claro', 'Tema OLED'])
  assert.match(copy.en.credit, /osakari · Vibecoded/)
  assert.match(copy.es.credit, /osakari · Vibecoded/)
  assert.equal(localizeError('Mirror rate limited (HTTP 429). Waiting 10s before retry 2/3.', 'es'), 'El mirror alcanzó su límite (HTTP 429). Esperando 10 s antes del reintento 2/3.')
  assert.equal(localizeError('Unexpected provider diagnostic', 'es'), 'Unexpected provider diagnostic')
})

test('renaming preserves Panama Maps and older legacy state without overwriting new state', async t => {
  const dir = await fs.mkdtemp(path.join(tmpdir(), 'panama-maps-rename-'))
  t.after(() => fs.rm(dir, { recursive: true, force: true }))
  const old = path.join(dir, '.aimthmus', 'state.json')
  const panama = path.join(dir, '.panama-maps', 'state.json')
  const current = path.join(dir, '.pacc-bd', 'state.json')
  await fs.mkdir(path.dirname(old))
  await fs.writeFile(old, 'old queue')
  assert.equal(await migrateLegacyState(old, panama), true)
  assert.equal(await migrateLegacyState(panama, current), true)
  assert.equal(await fs.readFile(current, 'utf8'), 'old queue')
  assert.equal(await fs.readFile(old, 'utf8'), 'old queue')
  assert.equal(await fs.readFile(panama, 'utf8'), 'old queue')
  await fs.writeFile(current, 'new queue')
  assert.equal(await migrateLegacyState(old, current), false)
  assert.equal(await fs.readFile(current, 'utf8'), 'new queue')
})

test('mirror routes are fixed; respects Retry-After and rejects unknown redirects', async () => {
  assert.equal(downloadURL('direct', 100), 'https://osu.direct/api/d/100')
  assert.equal(retryAfter('15'), 15000)
  assert.equal(retryAfter('Thu, 01 Jan 1970 00:00:20 GMT', 5000), 15000)
  const blocked = (async () => new Response(null, { status: 302, headers: { location: 'https://localhost/private' } })) as typeof fetch
  await assert.rejects(requestDownload('direct', 100, new AbortController().signal, blocked), /unapproved/)
})

test('validates .osz and downloads once, then recovers completed and interrupted jobs', async t => {
  const dir = await fs.mkdtemp(path.join(tmpdir(), 'panama-maps-test-'))
  t.after(() => fs.rm(dir, { recursive: true, force: true }))
  const zip = await archive()
  let calls = 0
  const request = (async () => { calls++; return new Response(new Uint8Array(zip), { status: 200, headers: { 'content-length': String(zip.length) } }) }) as typeof fetch
  const stateFile = path.join(dir, 'state.json')
  const q = new Queue(stateFile, undefined, request)
  await q.settings({ directory: path.join(dir, 'out'), mirror: 'direct' })
  await q.setCollection(coll)
  assert.equal(await q.enqueue(44, [1, 2]), 1)
  await new Promise<void>((resolve, reject) => { const interval = setInterval(() => { if (q.state.queue[0]?.status === 'done') { clearInterval(interval); resolve() } else if (q.state.queue[0]?.status === 'failed') { clearInterval(interval); reject(new Error(q.state.queue[0].error || 'failed')) } }, 20) })
  assert.equal(calls, 1)
  assert.equal(await validOsz(q.state.queue[0].filePath!), true)
  assert.equal(await q.enqueue(44, [1, 2]), 0)
  assert.equal(calls, 1)
  await q.pause()
  // Simulate a crash during another file: leave a partial file and downloading state on disk.
  const state = JSON.parse(await fs.readFile(stateFile, 'utf8'))
  state.queue.push({ ...state.queue[0], beatmapsetId: 101, key: '101', filename: '101 Test.osz', filePath: null, status: 'downloading', bytes: 500 })
   await fs.writeFile(path.join(dir, 'out', '101 Test.osz.panama-maps.part'), 'partial')
  await fs.writeFile(stateFile, JSON.stringify(state))
  const recovered = await Queue.open(stateFile, request)
  assert.equal(recovered.state.queue[0].status, 'done')
  assert.equal(recovered.state.queue[1].status, 'pending')
  await assert.rejects(fs.stat(path.join(dir, 'out', '101 Test.osz.panama-maps.part')))
  assert.equal(calls, 1)
  await fs.writeFile(recovered.state.queue[0].filePath!, 'broken')
  const reopened = await Queue.open(stateFile, request)
  assert.equal(reopened.state.queue[0].status, 'failed')
  assert.equal(reopened.state.queue[0].filePath, null)
})

test('429 waits and retries same mirror, cancel aborts active response and clears partial file', async t => {
  const dir = await fs.mkdtemp(path.join(tmpdir(), 'panama-maps-cancel-'))
  t.after(() => fs.rm(dir, { recursive: true, force: true }))
  const zip = await archive()
  let calls = 0
  const request = (async () => { calls++; return calls === 1 ? new Response(null, { status: 429, headers: { 'retry-after': '0' } }) : new Response(new Uint8Array(zip), { headers: { 'content-length': String(zip.length) } }) }) as typeof fetch
  const q = new Queue(path.join(dir, 'state.json'), undefined, request)
  await q.settings({ directory: path.join(dir, 'out'), mirror: 'direct' })
  await q.setCollection(coll)
  await q.enqueue(44, [1])
  await new Promise<void>((resolve, reject) => { const interval = setInterval(() => { if (q.state.queue[0]?.status === 'done') { clearInterval(interval); resolve() } else if (q.state.queue[0]?.status === 'failed') { clearInterval(interval); reject(new Error(q.state.queue[0].error || 'failed')) } }, 20) })
  assert.equal(calls, 2)
  assert.equal(q.state.queue[0].attempts, 2)
  const slow = (async (_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true }))) as typeof fetch
  const q2 = new Queue(path.join(dir, 'second.json'), undefined, slow)
  await q2.settings({ directory: path.join(dir, 'other'), mirror: 'direct' })
  await q2.setCollection(coll)
  await q2.enqueue(44, [1])
  await assert.rejects(q2.clearQueue(), /Cancel pending downloads/)
  await q2.cancel()
  assert.equal(q2.state.queue[0].status, 'cancelled')
  await new Promise(resolve => setTimeout(resolve, 100)) // Let the aborted worker finish its final state write.
  assert.equal((await fs.readdir(path.join(dir, 'other'))).filter(x => x.endsWith('.part')).length, 0)
  await q2.clearQueue()
  assert.deepEqual(q2.state.queue, [])
})

test('cancelling a partially streamed file removes only its temporary file', async t => {
  const dir = await fs.mkdtemp(path.join(tmpdir(), 'panama-maps-partial-'))
  t.after(() => fs.rm(dir, { recursive: true, force: true }))
  const request = (async () => new Response(new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(2048)) } }), { status: 200 })) as typeof fetch
  const q = new Queue(path.join(dir, 'state.json'), undefined, request)
  await q.settings({ directory: path.join(dir, 'out'), mirror: 'direct' })
  await q.setCollection(coll)
  await q.enqueue(44, [1])
  const part = path.join(dir, 'out', `${q.state.queue[0].filename}.pacc-bd.part`)
  await new Promise<void>((resolve, reject) => {
    const start = Date.now()
    const check = async () => {
      if ((await fs.stat(part).catch(() => null))?.size === 2048) return resolve()
      if (Date.now() - start > 5000) return reject(new Error('No bytes written to the partial file'))
      setTimeout(() => { void check() }, 10)
    }
    void check()
  })
  assert.equal((await fs.stat(part)).size, 2048)
  await q.cancel()
  await new Promise(resolve => setTimeout(resolve, 100))
  assert.equal(q.state.queue[0].status, 'cancelled')
  assert.deepEqual(await fs.readdir(path.join(dir, 'out')), [])
})

test('recovery recognizes an already committed archive only when its app temp is the same file', async t => {
  const dir = await fs.mkdtemp(path.join(tmpdir(), 'panama-maps-commit-'))
  t.after(() => fs.rm(dir, { recursive: true, force: true }))
  const out = path.join(dir, 'out')
  await fs.mkdir(out)
  const name = '100 Test.osz'
  const final = path.join(out, name)
  const part = `${final}.panama-maps.part`
  await fs.writeFile(part, await archive())
  await fs.link(part, final)
  const stateFile = path.join(dir, 'state.json')
  const state = { settings: { directory: out, mirror: 'direct' }, collections: [coll], currentId: 44, paused: true, queue: [{ key: '100', collectionId: 44, collectionName: 'Test', beatmapsetId: 100, artist: 'Test artist', title: 'Test song', difficultyIds: [1], status: 'downloading', filename: name, filePath: null, bytes: 500, total: null, error: null, attempts: 1 }] }
  await fs.writeFile(stateFile, JSON.stringify(state))
  const q = await Queue.open(stateFile)
  assert.equal(q.state.queue[0].status, 'done')
  assert.equal(q.state.queue[0].filePath, final)
  assert.equal(await validOsz(final), true)
  await assert.rejects(fs.stat(part))
})
