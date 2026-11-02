import type { Collection, Difficulty } from './types.js'

const ORIGIN = 'https://osucollector.com'
const agent = 'PACC-BD/1.0 (local public collection downloader)'

export function parseCollectionId(input: string): number {
  if (typeof input !== 'string') throw new Error('Enter a numeric collection ID or an osucollector.com collection URL.')
  const value = input.trim()
  if (/^[1-9]\d{0,12}$/.test(value)) return Number(value)
  let url: URL
  try { url = new URL(value) } catch { throw new Error('Enter a numeric collection ID or an osucollector.com collection URL.') }
  if (url.protocol !== 'https:' || !['osucollector.com', 'www.osucollector.com'].includes(url.hostname) || url.port || url.username || url.password) {
    throw new Error('Only HTTPS osucollector.com collection links are supported.')
  }
  const match = /^\/collections\/([1-9]\d{0,12})(?:\/[^/]*)?\/?$/.exec(url.pathname)
  if (!match) throw new Error('The link must point to /collections/{id}.')
  return Number(match[1])
}

type Fetcher = typeof fetch
async function getJSON(url: string, request: Fetcher): Promise<any> {
  const response = await request(url, { headers: { 'User-Agent': agent, Accept: 'application/json' }, signal: AbortSignal.timeout(30000) })
  if (!response.ok) throw new Error(`Collector returned HTTP ${response.status}${response.status === 429 ? ' (rate limited; try again later)' : ''}.`)
  return response.json()
}

function text(value: unknown, fallback = ''): string { return typeof value === 'string' ? value : fallback }
function positive(value: unknown): number | null { const n = Number(value); return Number.isSafeInteger(n) && n > 0 ? n : null }
function finite(value: unknown): number | null { return typeof value === 'number' && Number.isFinite(value) ? value : null }

export function normalizeMap(raw: any): Difficulty | null {
  const id = positive(raw?.id)
  if (!id) return null
  const set = raw?.beatmapset ?? {}
  const cover = [set.covers?.cover, set.covers?.card].find((image): image is string => typeof image === 'string' && /^https:\/\/assets\.ppy\.sh\/beatmaps\/\d+\//.test(image)) ?? null
  return {
    id, beatmapsetId: positive(raw?.beatmapset_id ?? set.id),
    checksum: typeof raw?.checksum === 'string' && /^[a-f\d]{32}$/i.test(raw.checksum) ? raw.checksum : null,
    version: text(raw?.version, 'Unknown difficulty'), mode: text(raw?.mode, 'osu'),
    stars: finite(raw?.difficulty_rating), status: text(raw?.status, 'unknown'),
    artist: text(set.artist, 'Unknown artist'), title: text(set.title, 'Unknown title'), creator: text(set.creator, 'Unknown mapper'),
    cover, bpm: finite(raw?.bpm ?? set.bpm), length: finite(raw?.hit_length),
  }
}

export async function fetchCollection(id: number, request: Fetcher = fetch): Promise<Collection> {
  const info = await getJSON(`${ORIGIN}/api/collections/${id}`, request)
  if (positive(info?.id) !== id) throw new Error('Collection not found or not public.')
  const maps: Difficulty[] = []
  const seenIds = new Set<number>()
  const cursors = new Set<string>()
  let cursor: string | null = null
  for (let page = 0; page < 1000; page++) {
    const url = new URL(`${ORIGIN}/api/collections/${id}/beatmapsV2`)
    url.searchParams.set('perPage', '100')
    if (cursor) url.searchParams.set('cursor', cursor)
    const data = await getJSON(url.toString(), request)
    if (!Array.isArray(data?.beatmaps)) throw new Error('Collector returned an unexpected beatmap page.')
    for (const raw of data.beatmaps) {
      const map = normalizeMap(raw)
      if (map && !seenIds.has(map.id)) { seenIds.add(map.id); maps.push(map) }
    }
    if (!data.hasMore) return { id, name: text(info.name, `Collection ${id}`), uploader: text(info.uploader?.username, 'Unknown uploader'), reportedCount: Number(info.beatmapCount) || maps.length, maps, fetchedAt: new Date().toISOString() }
    const next = data.nextPageCursor
    if ((typeof next !== 'string' && typeof next !== 'number') || !String(next) || cursors.has(String(next))) throw new Error('Collector pagination returned a missing or repeated cursor; the preview is incomplete.')
    cursor = String(next)
    cursors.add(cursor)
  }
  throw new Error('Collector returned too many pages; the preview is incomplete.')
}
