import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Queue } from '../server/queue.js'
import { exportLazerCollection, lazerPreview } from '../server/lazerExport.js'
import { parseCollectionDb } from '../server/stable.js'

test('lazer handoff exports only known filtered checksums, never changes saved state', () => {
  const queue = new Queue('/unused/state.json')
  queue.state.tournament = { fetchedAt: '', failures: [], entries: [{ source: '22', kind: 'beatmapset', requestedId: 22, beatmapsetId: 22, difficultyId: null, checksum: null, version: null, stars: null, artist: 'Artist', title: 'Title', creator: 'Mapper', cover: null, status: 'ranked', setDifficulties: [
    { id: 1, checksum: 'A'.repeat(32), stars: 4, bpm: 180, ar: 8, od: 7 },
    { id: 2, checksum: 'b'.repeat(32), stars: 6, bpm: 180, ar: 9, od: 9 },
    { id: 3, checksum: null, stars: 4, bpm: 180, ar: 8, od: 7 },
  ] }] }
  const before = JSON.stringify(queue.state)
  const preview = lazerPreview(queue, 'tournament')
  assert.equal(preview.maps.length, 3)
  const result = exportLazerCollection(queue, { source: 'tournament', name: 'Practice 🌸', odMax: '8' })
  assert.deepEqual(parseCollectionDb(result.bytes).collections, [{ name: 'Practice 🌸', hashes: ['a'.repeat(32)] }])
  assert.equal(result.count, 1)
  assert.equal(result.skipped, 1)
  assert.equal(JSON.stringify(queue.state), before)
  assert.throws(() => exportLazerCollection(queue, { source: 'invalid' }), /supported/)
  assert.throws(() => exportLazerCollection(queue, { source: 'tournament', arMin: '10' }), /No known/)
  assert.throws(() => exportLazerCollection(queue, { source: 'tournament', name: '' }), /name/)
})

test('missing checksums never become synthetic beatmap ID hashes', () => {
  const queue = new Queue('/unused/state.json')
  assert.throws(() => exportLazerCollection(queue, { source: 'collector' }), /No known/)
})
