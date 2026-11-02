import { setTimeout as wait } from 'node:timers/promises'
import { retryAfter } from './mirrors.js'
import type { TournamentEntry, TournamentManifest } from './types.js'
import { mapAttributes } from './mapMetadata.js'

export type IdKind = 'beatmap' | 'beatmapset'
export type OsuInput = { source: string; kind: IdKind; id: number }
const MAX_INPUTS = 200
const MAX_HTML_BYTES = 4 * 1024 * 1024
const ORIGIN = 'https://osu.ppy.sh'
const agent = 'PACC-BD/1.0 (local public beatmap metadata reader)'

export function parseOsuInputs(input: string, numberKind: IdKind): OsuInput[] {
  if (typeof input !== 'string' || !['beatmap', 'beatmapset'].includes(numberKind) || input.length > 30000) throw new Error('Enter up to 200 osu! beatmap IDs or links.')
  const tokens = input.trim().split(/[\s,;]+/).filter(Boolean)
  if (!tokens.length || tokens.length > MAX_INPUTS) throw new Error('Enter 1–200 osu! beatmap IDs or links.')
  const seen = new Set<string>()
  return tokens.map(source => {
    let kind: IdKind = numberKind
    let text = source
    if (!/^\d+$/.test(source)) {
      let url: URL
      try { url = new URL(source) } catch { throw new Error(`Invalid osu! link or ID: ${source.slice(0, 90)}`) }
      if (url.protocol !== 'https:' || url.hostname !== 'osu.ppy.sh' || url.port || url.username || url.password) throw new Error('Only HTTPS osu.ppy.sh beatmap links are supported.')
      const difficulty = /^\/beatmaps\/([1-9]\d{0,12})\/?$/.exec(url.pathname)
      const set = /^\/beatmapsets\/([1-9]\d{0,12})\/?$/.exec(url.pathname)
      if (difficulty) { kind = 'beatmap'; text = difficulty[1] }
      else if (set) {
        const hash = /^#(?:osu|taiko|fruits|mania)\/([1-9]\d{0,12})$/.exec(url.hash)
        if (hash) { kind = 'beatmap'; text = hash[1] }
        else if (url.hash) throw new Error(`Unrecognized osu! beatmap link: ${source.slice(0, 90)}`)
        else { kind = 'beatmapset'; text = set[1] }
      } else throw new Error(`Only /beatmaps/{id} and /beatmapsets/{id} links are supported: ${source.slice(0, 90)}`)
    }
    const id = Number(text)
    if (!Number.isSafeInteger(id) || id < 1) throw new Error(`Invalid osu! ID: ${source.slice(0, 90)}`)
    return { source, kind, id }
  }).filter(item => { const key = `${item.kind}:${item.id}`; if (seen.has(key)) return false; seen.add(key); return true })
}

function allowedURL(raw: string): boolean {
  const url = new URL(raw)
  return url.protocol === 'https:' && url.hostname === 'osu.ppy.sh' && !url.port && !url.username && !url.password && /^\/(?:beatmaps|beatmapsets)\/[1-9]\d*(?:\/)?$/.test(url.pathname)
}

async function getPage(input: OsuInput, request: typeof fetch): Promise<string> {
  let url = `${ORIGIN}/${input.kind === 'beatmap' ? 'beatmaps' : 'beatmapsets'}/${input.id}`
  for (let redirected = 0; redirected < 4; redirected++) {
    if (!allowedURL(url)) throw new Error('osu! redirected to an unexpected host or page.')
    const response = await request(url, { redirect: 'manual', headers: { 'User-Agent': agent, Accept: 'text/html' }, signal: AbortSignal.timeout(30000) })
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location')
      await response.body?.cancel()
      if (!location) throw new Error('osu! returned an invalid redirect.')
      url = new URL(location, url).toString()
      continue
    }
    if (response.status === 429) {
      const retry = retryAfter(response.headers.get('retry-after'))
      await response.body?.cancel()
      throw new OsuRateLimit(retry)
    }
    if (!response.ok) { await response.body?.cancel(); throw new Error(`osu! returned HTTP ${response.status}.`) }
    if (!response.body || Number(response.headers.get('content-length')) > MAX_HTML_BYTES) throw new Error('osu! metadata page is missing or too large.')
    let size = 0
    const chunks: Uint8Array[] = []
    const reader = response.body.getReader()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_HTML_BYTES) { await reader.cancel().catch(() => {}); throw new Error('osu! metadata page is too large.') }
      chunks.push(value)
    }
    return Buffer.concat(chunks).toString('utf8')
  }
  throw new Error('osu! redirected too many times.')
}

export class OsuRateLimit extends Error {
  constructor(public delay: number | null) { super('osu! rate limited metadata requests (HTTP 429).') }
}

type PageSet = { id: number; artist?: string; title?: string; creator?: string; status?: string; bpm?: number; covers?: { cover?: string; card?: string }; beatmaps?: Array<{ id: number; checksum?: string; version?: string; difficulty_rating?: number; bpm?: number; convert?: boolean } & Record<string, any>> } & Record<string, any>
function positiveStat(value: unknown): number | null { return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null }
export function parseOsuPage(html: string, requested: OsuInput): { set: PageSet; entry: TournamentEntry } {
  const match = /<script\b[^>]*\bid=["']json-beatmapset["'][^>]*>([\s\S]*?)<\/script>/i.exec(html)
  if (!match) throw new Error('osu! did not provide public beatmap metadata for this ID.')
  let set: PageSet
  try { set = JSON.parse(match[1]) } catch { throw new Error('osu! returned invalid beatmap metadata.') }
  if (!Number.isSafeInteger(set?.id) || set.id < 1 || !Array.isArray(set.beatmaps)) throw new Error('osu! returned incomplete beatmapset metadata.')
  if (requested.kind === 'beatmapset' && set.id !== requested.id) throw new Error('osu! returned a different beatmapset.')
  const diff = requested.kind === 'beatmap' ? set.beatmaps.find(m => m.id === requested.id) : undefined
  if (requested.kind === 'beatmap' && !diff) throw new Error(`Beatmap ${requested.id} is not available in this beatmapset.`)
  const cover = [set.covers?.cover, set.covers?.card].find(image => typeof image === 'string' && /^https:\/\/assets\.ppy\.sh\/beatmaps\/\d+\//.test(image)) ?? null
  return { set, entry: {
    ...mapAttributes(diff, set),
    source: requested.source, kind: requested.kind, requestedId: requested.id, beatmapsetId: set.id,
    difficultyId: diff?.id ?? null, checksum: diff?.checksum && /^[\da-f]{32}$/i.test(diff.checksum) ? diff.checksum : null,
    version: diff?.version ?? null, stars: positiveStat(diff?.difficulty_rating), bpm: positiveStat(diff?.bpm) ?? positiveStat(set.bpm),
    setDifficulties: set.beatmaps.filter(map => Number.isSafeInteger(map.id)).map(map => ({ ...mapAttributes(map, set), id: map.id, checksum: typeof map.checksum === 'string' && /^[\da-f]{32}$/i.test(map.checksum) ? map.checksum : null, stars: positiveStat(map.difficulty_rating), bpm: positiveStat(map.bpm) ?? positiveStat(set.bpm) })),
    artist: set.artist || 'Unknown artist', title: set.title || 'Unknown title', creator: set.creator || 'Unknown mapper',
    status: set.status || 'unknown', cover,
  } }
}

export async function resolveOsuInputs(input: string, numberKind: IdKind, request: typeof fetch = fetch, paceMs = 650): Promise<TournamentManifest> {
  const inputs = parseOsuInputs(input, numberKind)
  const entries: TournamentEntry[] = []
  const failures: TournamentManifest['failures'] = []
  const byDifficulty = new Map<number, { set: PageSet; entry: TournamentEntry }>()
  const bySet = new Map<number, { set: PageSet; entry: TournamentEntry }>()
  let lastRequest = 0
  for (let index = 0; index < inputs.length; index++) {
    const item = inputs[index]
    try {
      let resolved = item.kind === 'beatmap' ? byDifficulty.get(item.id) : bySet.get(item.id)
      if (!resolved) {
        const elapsed = Date.now() - lastRequest
        if (lastRequest && elapsed < paceMs) await wait(paceMs - elapsed)
        lastRequest = Date.now()
        let html: string
        try { html = await getPage(item, request) }
        catch (error) {
          if (!(error instanceof OsuRateLimit)) throw error
          if (error.delay === null || error.delay > 60000) throw error
          await wait(error.delay)
          lastRequest = Date.now()
          html = await getPage(item, request)
        }
        resolved = parseOsuPage(html, item)
        bySet.set(resolved.set.id, { set: resolved.set, entry: { ...resolved.entry, kind: 'beatmapset', difficultyId: null, checksum: null, version: null, stars: null } })
        for (const diff of resolved.set.beatmaps || []) byDifficulty.set(diff.id, { set: resolved.set, entry: { ...resolved.entry, ...mapAttributes(diff, resolved.set), status: diff.status || resolved.entry.status, difficultyId: diff.id, checksum: diff.checksum && /^[\da-f]{32}$/i.test(diff.checksum) ? diff.checksum : null, version: diff.version ?? null, stars: positiveStat(diff.difficulty_rating), bpm: positiveStat(diff.bpm) ?? positiveStat(resolved.set.bpm) } })
      }
      // Cache entries never change the original source, kind, and requested ID.
      entries.push({ ...resolved.entry, source: item.source, kind: item.kind, requestedId: item.id, difficultyId: item.kind === 'beatmap' ? item.id : null, checksum: item.kind === 'beatmap' ? resolved.entry.checksum : null, version: item.kind === 'beatmap' ? resolved.entry.version : null, stars: item.kind === 'beatmap' ? resolved.entry.stars : null })
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Could not resolve this ID.'
      failures.push({ source: item.source, reason })
      if (error instanceof OsuRateLimit) {
        for (const remaining of inputs.slice(index + 1)) failures.push({ source: remaining.source, reason: 'Skipped because osu! rate limited metadata requests. Try again later.' })
        break
      }
    }
  }
  return { entries, failures, fetchedAt: new Date().toISOString() }
}
