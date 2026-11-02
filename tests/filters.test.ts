import assert from 'node:assert/strict'
import { test } from 'node:test'
import { emptyFilters, filterActive, matchesMapFilters } from '../src/mapFilters.js'
import { parseMapFilters } from '../server/mapFilters.js'
import { languageChoices } from '../server/filterOptions.js'
import { difficultyColour, difficultyHandleColour, difficultySpectrum, difficultyTextColour } from '../src/difficultyColours.js'
import { normalizeMap } from '../server/collector.js'
import { parseOsuPage, resolveOsuInputs } from '../server/osu.js'

test('star and BPM ranges apply to the same difficulty and preserve unknowns only when requested', () => {
  const maps = [{ stars: 3.2, bpm: 180 }, { stars: 6.1, bpm: 220 }, { stars: null, bpm: null }]
  assert.equal(filterActive(emptyFilters), false)
  assert.ok(maps.every(map => matchesMapFilters(map, emptyFilters)))
  const filters = { ...emptyFilters, starsMin: 5, bpmMax: 200 }
  assert.equal(filterActive(filters), true)
  assert.ok(maps.every(map => !matchesMapFilters(map, filters)))
  assert.equal(matchesMapFilters(maps[2], { ...filters, includeUnknown: true }), true)
  assert.equal(matchesMapFilters(maps[1], { ...emptyFilters, starsMin: 5, bpmMin: 200 }), true)
})

test('each extra slider independently filters both inclusive bounds, unknowns, and resets', () => {
  for (const key of ['ar', 'od', 'cs', 'hp', 'length'] as const) {
    const maps = [0, 4, 7, null].map(value => ({ stars: null, [key]: value }))
    const filter = { ...emptyFilters, [`${key}Min`]: 4, [`${key}Max`]: 7 }
    assert.deepEqual(maps.map(map => matchesMapFilters(map, filter)), [false, true, true, false], key)
    assert.equal(matchesMapFilters(maps[3], { ...filter, includeUnknown: true }), true, key)
    assert.equal(matchesMapFilters(maps[0], { ...emptyFilters, [`${key}Max`]: 0 }), true, key)
    assert.ok(maps.every(map => matchesMapFilters(map, emptyFilters)), key)
  }
})

test('all unmodded ranges and categories match the same difficulty', () => {
  const map = { stars: 5, bpm: 180, ar: 9, od: 8, hp: 6, cs: 4, length: 120, mode: 'osu', status: 'ranked', genre: '3', language: '7', video: true, explicit: false }
  const filters = { ...emptyFilters, arMin: 9, odMax: 8, hpMin: 6, csMax: 4, lengthMax: 120, mode: 'osu', status: 'leaderboard', genre: '3', language: '7', video: true, explicit: 'hide' }
  assert.equal(matchesMapFilters(map, filters), true)
  for (const key of ['ar', 'od', 'hp', 'cs', 'length'] as const) {
    assert.equal(matchesMapFilters({ ...map, [key]: null }, filters), false)
    assert.equal(matchesMapFilters({ ...map, [key]: null }, { ...filters, includeUnknown: true }), true)
  }
  assert.equal(matchesMapFilters({ ...map, mode: 'mania' }, filters), false)
  assert.equal(matchesMapFilters({ ...map, explicit: true }, filters), false)
  assert.equal(matchesMapFilters({ stars: null, difficultyId: null, setDifficulties: [{ ...map, ar: 7, od: 8 }, { ...map, ar: 9, od: 9 }] }, filters), false)
  assert.equal(matchesMapFilters(map, { ...emptyFilters, excludeConverted: true }), false)
  assert.equal(matchesMapFilters({ ...map, convert: false }, { ...emptyFilters, excludeConverted: true }), true)
})

test('server filters validate bounds, reject arrays and invalid categories, and preserve no upper limit', () => {
  assert.equal(parseMapFilters({ arMin: '0', odMax: '9', mode: 'mania' }).arMin, 0)
  assert.equal(parseMapFilters({}).starsMax, null)
  for (const input of [{ arMin: '9', arMax: '8' }, { odMax: 'NaN' }, { csMin: ['4'] }, { hpMax: '-1' }, { lengthMax: '999999' }, { mode: 'invalid' }]) assert.throws(() => parseMapFilters(input), /valid/)
})

test('lazer spectrum keeps official stop colours and dark high-star handles', () => {
  for (const [stars, colour] of difficultySpectrum) assert.equal(difficultyColour(stars), colour)
  assert.equal(difficultyHandleColour(0), '#4290fb')
  assert.equal(difficultyHandleColour(8), '#444444')
  assert.equal(difficultyTextColour(7), '#ffd966')
  assert.equal(difficultyTextColour(9), '#f6f05c')
})

test('Collector keeps AR, OD (accuracy), CS, HP, categories and unknown flags', () => {
  const map = normalizeMap({ id: 1, mode: 'osu', ar: 9, accuracy: 8, cs: 4, drain: 0, beatmapset: { id: 2, status: 'ranked', genre: { id: 3 }, language: { id: 7 }, nsfw: false, video: true, track_id: null } })!
  assert.deepEqual([map.ar, map.od, map.cs, map.hp, map.genre, map.language, map.explicit, map.video, map.featuredArtist, map.storyboard], [9, 8, 4, 0, '3', '7', false, true, false, null])
  assert.equal(map.status, 'ranked')
})

test('language filter IDs follow osu!, not the order of displayed names', () => {
  const languages = new Map(languageChoices.map(([id, name]) => [name, id]))
  assert.equal(languages.get('Japanese'), '3')
  assert.equal(languages.get('Chinese'), '4')
  assert.equal(languages.get('Instrumental'), '5')
  assert.equal(languages.get('Spanish'), '10')
})

test('osu! ID metadata and cached siblings retain their own unmodded stats', async () => {
  const set = { id: 22, status: 'ranked', beatmaps: [{ id: 1, ar: 7, accuracy: 6, cs: 4, drain: 5, mode: 'osu', checksum: 'a'.repeat(32) }, { id: 2, ar: 9, accuracy: 8, cs: 5, drain: 6, mode: 'osu', checksum: 'b'.repeat(32) }] }
  const html = `<script id="json-beatmapset">${JSON.stringify(set)}</script>`
  assert.equal(parseOsuPage(html, { source: '1', kind: 'beatmap', id: 1 }).entry.ar, 7)
  const resolved = await resolveOsuInputs('1 2 https://osu.ppy.sh/beatmapsets/22', 'beatmap', (async () => new Response(html)) as typeof fetch, 0)
  assert.deepEqual(resolved.entries.map(entry => entry.ar), [7, 9, 7])
  assert.deepEqual(resolved.entries[2].setDifficulties?.map(diff => diff.od), [6, 8])
})

test('set-only IDs filter using sibling difficulties, but individual IDs do not', () => {
  const setDifficulties = [{ stars: 2, bpm: 140 }, { stars: 6, bpm: 220 }]
  const filters = { ...emptyFilters, starsMin: 5, bpmMin: 200 }
  assert.equal(matchesMapFilters({ difficultyId: null, stars: null, bpm: 140, setDifficulties }, filters), true)
  assert.equal(matchesMapFilters({ difficultyId: 1, stars: 2, bpm: 140, setDifficulties }, filters), false)
  assert.equal(matchesMapFilters({ difficultyId: null, stars: null, bpm: 140, setDifficulties }, { ...filters, bpmMax: 180 }), false)
})
