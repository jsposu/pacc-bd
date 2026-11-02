import type { MapAttributes } from './types.js'
import { genreChoices, languageChoices } from './filterOptions.js'

export const rangeKeys = ['stars', 'bpm', 'ar', 'od', 'cs', 'hp', 'length'] as const
export type RangeKey = typeof rangeKeys[number]
export type RangeBound = `${RangeKey}${'Min' | 'Max'}`
export type MapFilters = Record<RangeBound, number | null> & {
  includeUnknown: boolean; mode: string; status: string; genre: string; language: string
  explicit: string; video: boolean; storyboard: boolean; featuredArtist: boolean; excludeConverted: boolean
}
export type MapStats = MapAttributes & { stars: number | null; bpm?: number | null; difficultyId?: number | null; setDifficulties?: (MapAttributes & { stars: number | null; bpm: number | null })[] }
export const emptyFilters: MapFilters = {
  starsMin: null, starsMax: null, bpmMin: null, bpmMax: null, arMin: null, arMax: null,
  odMin: null, odMax: null, csMin: null, csMax: null, hpMin: null, hpMax: null, lengthMin: null, lengthMax: null,
  includeUnknown: false, mode: 'any', status: 'any', genre: 'any', language: 'any', explicit: 'any',
  video: false, storyboard: false, featuredArtist: false, excludeConverted: false,
}
export function filterActive(filters: MapFilters): boolean {
  return Object.entries(filters).some(([key, value]) => key !== 'includeUnknown' && value !== emptyFilters[key as keyof MapFilters])
}
function inRange(value: number | null | undefined, min: number | null, max: number | null, unknown: boolean): boolean {
  if (min === null && max === null) return true
  if (value === null || value === undefined || !Number.isFinite(value)) return unknown
  return (min === null || value >= min) && (max === null || value <= max)
}
export function matchesMapFilters(map: MapStats, filters: MapFilters): boolean {
  const candidates = map.difficultyId === null && map.setDifficulties?.length ? map.setDifficulties : [map]
  return candidates.some(item => {
    if (!rangeKeys.every(key => inRange(item[key], filters[`${key}Min`], filters[`${key}Max`], filters.includeUnknown))) return false
    for (const key of ['mode', 'status', 'genre', 'language'] as const) {
      const wanted = filters[key], value = item[key]
      if (wanted === 'any') continue
      if (value === null || value === undefined || value === 'unknown') { if (!filters.includeUnknown) return false }
      else if (key === 'status' && wanted === 'leaderboard' ? !['ranked', 'approved', 'qualified', 'loved'].includes(value) : wanted !== value) return false
    }
    if (filters.explicit === 'hide' && (item.explicit === true || item.explicit == null && !filters.includeUnknown)) return false
    for (const key of ['video', 'storyboard', 'featuredArtist'] as const) if (filters[key] && item[key] !== true && !(item[key] == null && filters.includeUnknown)) return false
    if (filters.excludeConverted && (item.convert === true || item.convert == null && !filters.includeUnknown)) return false
    return true
  })
}

export function parseMapFilters(input: Record<string, unknown>): MapFilters {
  const filters = { ...emptyFilters }
  for (const key of rangeKeys) {
    for (const bound of ['Min', 'Max'] as const) {
      const name = `${key}${bound}` as RangeBound, value = input[name]
      if (value === undefined) continue
      if (typeof value !== 'string' || !value.trim() || !Number.isFinite(Number(value)) || Number(value) < 0 || Number(value) > (key === 'length' ? 86400 : key === 'bpm' ? 10000 : 100)) throw new Error('Choose a valid star rating, BPM or difficulty range.')
      filters[name] = Number(value)
    }
    if (filters[`${key}Min`] !== null && filters[`${key}Max`] !== null && filters[`${key}Min`]! > filters[`${key}Max`]!) throw new Error('Choose a valid star rating, BPM or difficulty range.')
  }
  for (const key of ['includeUnknown', 'video', 'storyboard', 'featuredArtist', 'excludeConverted'] as const) filters[key] = input[key] === 'true'
  for (const key of ['mode', 'status', 'genre', 'language', 'explicit'] as const) {
    if (input[key] !== undefined) {
      if (typeof input[key] !== 'string' || input[key].length > 30) throw new Error('Choose a valid map filter.')
      filters[key] = input[key]
    }
  }
  if (!['any', 'osu', 'taiko', 'fruits', 'mania'].includes(filters.mode)
    || !['any', 'leaderboard', 'ranked', 'approved', 'qualified', 'loved', 'pending', 'wip', 'graveyard'].includes(filters.status)
    || !['any', 'hide'].includes(filters.explicit)
    || !genreChoices.some(([id]) => id === filters.genre)
    || !languageChoices.some(([id]) => id === filters.language)) throw new Error('Choose a valid map filter.')
  return filters
}
