export type MapFilters = { starsMin: number | null; starsMax: number | null; bpmMin: number | null; bpmMax: number | null; includeUnknown: boolean }
export type MapStats = { stars: number | null; bpm?: number | null; difficultyId?: number | null; setDifficulties?: { stars: number | null; bpm: number | null }[] }

export const emptyFilters: MapFilters = { starsMin: null, starsMax: null, bpmMin: null, bpmMax: null, includeUnknown: false }

export function filterActive(filters: MapFilters): boolean {
  return filters.starsMin !== null || filters.starsMax !== null || filters.bpmMin !== null || filters.bpmMax !== null
}

function inRange(value: number | null | undefined, min: number | null, max: number | null, includeUnknown: boolean): boolean {
  if (min === null && max === null) return true
  if (value === null || value === undefined || !Number.isFinite(value)) return includeUnknown
  return (min === null || value >= min) && (max === null || value <= max)
}

export function matchesMapFilters(map: MapStats, filters: MapFilters): boolean {
  const candidates = map.difficultyId === null && map.setDifficulties?.length ? map.setDifficulties : [map]
  return candidates.some(item => inRange(item.stars, filters.starsMin, filters.starsMax, filters.includeUnknown)
    && inRange(item.bpm, filters.bpmMin, filters.bpmMax, filters.includeUnknown))
}
