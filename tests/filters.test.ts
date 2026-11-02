import assert from 'node:assert/strict'
import { test } from 'node:test'
import { emptyFilters, filterActive, matchesMapFilters } from '../src/mapFilters.js'

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

test('set-only IDs filter using sibling difficulties, but individual IDs do not', () => {
  const setDifficulties = [{ stars: 2, bpm: 140 }, { stars: 6, bpm: 220 }]
  const filters = { ...emptyFilters, starsMin: 5, bpmMin: 200 }
  assert.equal(matchesMapFilters({ difficultyId: null, stars: null, bpm: 140, setDifficulties }, filters), true)
  assert.equal(matchesMapFilters({ difficultyId: 1, stars: 2, bpm: 140, setDifficulties }, filters), false)
  assert.equal(matchesMapFilters({ difficultyId: null, stars: null, bpm: 140, setDifficulties }, { ...filters, bpmMax: 180 }), false)
})
