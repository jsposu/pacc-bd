import type { Queue } from './queue.js'
import type { MapAttributes } from './types.js'
import { encodeCollectionDb } from './stable.js'
import { matchesMapFilters, parseMapFilters } from './mapFilters.js'

export type ExportMap = MapAttributes & { id: number | null; checksum: string | null; artist: string; title: string; version: string | null; stars: number | null; bpm: number | null }
export function lazerPreview(queue: Queue, source: unknown) {
  if (source !== 'collector' && source !== 'tournament') throw new Error('Choose a supported preview source.')
  const collection = queue.state.collections.find(c => c.id === queue.state.currentId)
  const maps: ExportMap[] = source === 'collector' ? collection?.maps || [] : (queue.state.tournament?.entries || []).flatMap<ExportMap>(entry => {
    const base = { ...entry, id: entry.difficultyId, bpm: entry.bpm ?? null }
    return entry.difficultyId === null && entry.setDifficulties?.length
      ? entry.setDifficulties.map(diff => ({ ...base, ...diff, difficultyId: diff.id, setDifficulties: undefined, checksum: diff.checksum ?? null, version: null })) : [base]
  })
  return { name: source === 'collector' ? collection?.name || 'Collector' : 'Beatmap IDs', maps }
}
export function exportLazerCollection(queue: Queue, input: Record<string, unknown>) {
  const preview = lazerPreview(queue, input.source)
  const name = typeof input.name === 'string' ? input.name.trim() : preview.name
  if (!name || name.length > 100 || name.includes('\0')) throw new Error('Choose a collection name (up to 100 characters).')
  const filters = parseMapFilters(input)
  const visible = preview.maps.filter(map => matchesMapFilters(map, filters))
  const hashes = [...new Set(visible.flatMap(map => map.checksum && /^[a-f\d]{32}$/i.test(map.checksum) ? [map.checksum.toLowerCase()] : []))]
  if (!hashes.length) throw new Error('No known beatmap checksums match these filters. Refresh the downloader preview first.')
  return { bytes: encodeCollectionDb({ version: 20250101, collections: [{ name, hashes }] }), count: hashes.length, skipped: visible.filter(map => !map.checksum || !/^[a-f\d]{32}$/i.test(map.checksum)).length }
}
