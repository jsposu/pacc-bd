import { createHash, randomBytes } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { execFile } from 'node:child_process'
import type { Queue } from './queue.js'
import type { MapAttributes, TournamentEntry } from './types.js'
import { matchesMapFilters, parseMapFilters } from './mapFilters.js'

const run = promisify(execFile)
const HASH = /^[a-f0-9]{32}$/i
const MAX_DB = 64 * 1024 * 1024
const MAX_MAPS = 100000
type StableCollection = { name: string; hashes: string[] }
export type InstalledMap = MapAttributes & { checksum: string; artist: string; title: string; creator: string; version: string; beatmapId: number | null; beatmapsetId: number | null; stars: number | null; bpm: number | null }
export type ScanProgress = { phase: 'idle' | 'counting' | 'scanning' | 'ready' | 'error'; processed: number; total: number | null; percent: number | null; error?: string }
type Database = { version: number; collections: StableCollection[] }

export function parseCollectionDb(buffer: Buffer): Database {
  if (buffer.length < 8 || buffer.length > MAX_DB) throw new Error('Unsupported or oversized osu!stable collection.db.')
  let offset = 0
  const fail = () => { throw new Error('Invalid or unsupported osu!stable collection.db; no changes were made.') }
  const int = () => { if (offset + 4 > buffer.length) return fail(); const n = buffer.readInt32LE(offset); offset += 4; return n }
  const text = () => {
    if (offset >= buffer.length) return fail()
    const marker = buffer[offset++]
    if (marker === 0) return ''
    if (marker !== 11) return fail()
    let length = 0, shift = 0, digit = 0
    do {
      if (offset >= buffer.length || shift > 28) return fail()
      digit = buffer[offset++]
      length += (digit & 0x7f) * 2 ** shift
      shift += 7
    } while (digit & 0x80)
    if (length > 32768 || offset + length > buffer.length) return fail()
    const bytes = buffer.subarray(offset, offset + length)
    offset += length
    const value = bytes.toString('utf8')
    if (!Buffer.from(value, 'utf8').equals(bytes)) return fail()
    return value
  }
  const version = int(), count = int()
  if (version < 20000101 || version > 20991231 || count < 0 || count > 10000) return fail()
  const collections: StableCollection[] = []
  let total = 0
  for (let i = 0; i < count; i++) {
    const name = text(), amount = int()
    if (amount < 0 || amount > MAX_MAPS || (total += amount) > MAX_MAPS) return fail()
    const hashes: string[] = []
    for (let j = 0; j < amount; j++) {
      const hash = text()
      if (!HASH.test(hash)) return fail()
      hashes.push(hash)
    }
    collections.push({ name, hashes })
  }
  if (offset !== buffer.length) return fail()
  return { version, collections }
}

function encodeString(value: string): Buffer {
  if (!value.length) return Buffer.from([0])
  const bytes = Buffer.from(value, 'utf8')
  let length = bytes.length
  const prefix = [11]
  do { const digit = length % 128; length = Math.floor(length / 128); prefix.push(digit | (length ? 128 : 0)) } while (length)
  return Buffer.concat([Buffer.from(prefix), bytes])
}

export function encodeCollectionDb(db: Database): Buffer {
  const head = Buffer.alloc(8)
  head.writeInt32LE(db.version, 0)
  head.writeInt32LE(db.collections.length, 4)
  const chunks: Buffer[] = [head]
  for (const collection of db.collections) {
    chunks.push(encodeString(collection.name))
    const count = Buffer.alloc(4)
    count.writeInt32LE(collection.hashes.length)
    chunks.push(count)
    for (const hash of collection.hashes) chunks.push(encodeString(hash))
  }
  const result = Buffer.concat(chunks)
  if (result.length > MAX_DB || result.length < 8) throw new Error('Collection database would exceed the safe size limit.')
  parseCollectionDb(result)
  return result
}

function checksum(buffer: Buffer): string { return createHash('sha256').update(buffer).digest('hex') }
function md5(buffer: Buffer): string { return createHash('md5').update(buffer).digest('hex') }
function positive(value: string | undefined): number | null { const n = Number(value); return Number.isSafeInteger(n) && n > 0 ? n : null }
export function installedMap(buffer: Buffer): InstalledMap {
  const content = buffer.subarray(0, 128 * 1024).toString('utf8')
  const fields: Record<string, string> = {}
  let section = ''
  let bpm: number | null = null
  for (const line of content.split(/\r?\n/)) {
    const heading = /^\[(.*)\]$/.exec(line.trim())
    if (heading) { section = heading[1]; continue }
    if (section === 'TimingPoints' && bpm === null) {
      const parts = line.split(',')
      const beatLength = Number(parts[1])
      if (parts.length >= 7 && Number(parts[6]) === 1 && Number.isFinite(beatLength) && beatLength > 0) bpm = Math.round(60000 / beatLength * 10) / 10
    }
    if (!['Metadata', 'Difficulty', 'General'].includes(section)) continue
    const at = line.indexOf(':')
    if (at > 0) fields[line.slice(0, at).trim()] = line.slice(at + 1).trim()
  }
  const stat = (name: string) => fields[name] !== undefined && Number.isFinite(Number(fields[name])) && Number(fields[name]) >= 0 ? Number(fields[name]) : null
  return { checksum: md5(buffer), artist: fields.Artist || 'Unknown artist', title: fields.Title || 'Unknown title', creator: fields.Creator || 'Unknown mapper', version: fields.Version || 'Unknown difficulty', beatmapId: positive(fields.BeatmapID), beatmapsetId: positive(fields.BeatmapSetID), stars: null, bpm,
    ar: stat('ApproachRate') ?? stat('OverallDifficulty'), od: stat('OverallDifficulty'), cs: stat('CircleSize'), hp: stat('HPDrainRate'), mode: ['osu', 'taiko', 'fruits', 'mania'][Number(fields.Mode ?? 0)] ?? null, convert: false }
}

async function osuRunning(): Promise<boolean> {
  const { stdout } = process.platform === 'win32'
    ? await run('tasklist', ['/FI', 'IMAGENAME eq osu!.exe', '/FO', 'CSV', '/NH'], { timeout: 8000 })
    : await run('ps', ['-eo', 'comm='], { timeout: 8000 })
  return process.platform === 'win32' ? /"osu!\.exe"/i.test(stdout) : stdout.split('\n').some(name => name.trim().toLowerCase() === 'osu!.exe')
}

export class StableManager {
  private installed = new Map<string, InstalledMap>()
  private scannedDirectory: string | null = null
  private scanning: Promise<void> | null = null
  private writing: Promise<unknown> = Promise.resolve()
  private connecting = false
  private progress: ScanProgress = { phase: 'idle', processed: 0, total: null, percent: null }
  scanProgress(): ScanProgress { return { ...this.progress } }
  constructor(private queue: Queue, private isRunning: () => Promise<boolean> = osuRunning) {}

  private metadata(): Map<number, MapAttributes & { stars: number | null; bpm: number | null }> {
    const metadata = new Map<number, MapAttributes & { stars: number | null; bpm: number | null }>()
    const add = (id: number, entry: MapAttributes & { stars: number | null; bpm?: number | null }) => {
      const old = metadata.get(id)
      const value = { ...entry, stars: old?.stars ?? entry.stars, bpm: old?.bpm ?? entry.bpm ?? null }
      for (const key of ['ar', 'od', 'cs', 'hp', 'length', 'mode', 'status', 'genre', 'language', 'explicit', 'video', 'storyboard', 'featuredArtist', 'convert'] as const) {
        if (old?.[key] != null) Object.assign(value, { [key]: old[key] })
      }
      metadata.set(id, value)
    }
    for (const collection of this.queue.state.collections) for (const map of collection.maps) add(map.id, map)
    for (const entry of this.queue.state.tournament?.entries || []) {
      if (entry.difficultyId) add(entry.difficultyId, entry)
      for (const diff of entry.setDifficulties || []) add(diff.id, diff)
    }
    return metadata
  }

  private withStats(map: InstalledMap, metadata: ReturnType<StableManager['metadata']>): InstalledMap {
    const match = map.beatmapId ? metadata.get(map.beatmapId) : null
    // An installed difficulty must never inherit set-only sibling matching from metadata.
    const result = { ...match, ...map, difficultyId: map.beatmapId, setDifficulties: undefined, stars: match?.stars ?? null, bpm: map.bpm ?? match?.bpm ?? null }
    for (const key of ['ar', 'od', 'cs', 'hp', 'length', 'mode', 'status', 'genre', 'language', 'explicit', 'video', 'storyboard', 'featuredArtist'] as const) if (result[key] == null && match?.[key] != null) Object.assign(result, { [key]: match[key] })
    return result
  }

  private async folder(input = this.queue.state.stableDirectory): Promise<string> {
    if (typeof input !== 'string' || !path.isAbsolute(input) || input.includes('\0')) throw new Error('Choose your osu!stable installation folder first.')
    const directory = await fs.realpath(input)
    const db = await fs.lstat(path.join(directory, 'collection.db'))
    const songs = await fs.lstat(path.join(directory, 'Songs'))
    if (!db.isFile() || !songs.isDirectory()) throw new Error('Choose an osu!stable folder containing collection.db and Songs.')
    return directory
  }

  async connect(input: string) {
    if (this.connecting) throw new Error('A library is already opening. Wait for it to finish.')
    this.connecting = true
    this.progress = { phase: 'counting', processed: 0, total: null, percent: null }
    try {
      await this.writing.catch(() => {})
      if (this.scanning) await this.scanning
      const directory = await this.folder(input)
      await this.readDb(directory)
      this.queue.state.stableDirectory = directory
      await this.queue.persist()
      this.scannedDirectory = null
      this.installed.clear()
      return await this.list()
    } catch (cause) {
      this.progress = { ...this.progress, phase: 'error', percent: null, error: (cause as Error).message }
      throw cause
    } finally { this.connecting = false }
  }

  private async readDb(directory: string) {
    const file = path.join(directory, 'collection.db')
    const stats = await fs.lstat(file)
    if (!stats.isFile() || stats.size > MAX_DB) throw new Error('Unsupported osu!stable collection.db.')
    const bytes = await fs.readFile(file)
    return { db: parseCollectionDb(bytes), bytes, revision: checksum(bytes), file }
  }

  private async scan(directory: string): Promise<void> {
    if (this.scannedDirectory === directory) return
    if (this.scanning) return this.scanning
    this.scanning = (async () => {
      this.progress = { phase: 'counting', processed: 0, total: null, percent: null }
      const found = new Map<string, InstalledMap>()
      const pending = [path.join(directory, 'Songs')]
      const files: string[] = []
      while (pending.length) {
        const folder = pending.pop()!
        for await (const item of await fs.opendir(folder)) {
          const file = path.join(folder, item.name)
          if (item.isDirectory()) pending.push(file)
          else if (item.isFile() && item.name.toLowerCase().endsWith('.osu')) {
            if (files.length >= MAX_MAPS) throw new Error('Too many installed maps to scan safely.')
            files.push(file)
          }
        }
      }
      this.progress = { phase: 'scanning', processed: 0, total: files.length, percent: 0 }
      for (const file of files) {
        const stat = await fs.stat(file)
        if (stat.size >= 16 && stat.size <= 8 * 1024 * 1024) {
          const map = installedMap(await fs.readFile(file))
          found.set(map.checksum, map)
        }
        this.progress.processed++
        this.progress.percent = Math.floor(this.progress.processed / files.length * 100)
      }
      this.installed = found
      this.scannedDirectory = directory
      this.progress = { phase: 'ready', processed: files.length, total: files.length, percent: 100 }
    })()
    try { await this.scanning } catch (cause) {
      this.progress = { ...this.progress, phase: 'error', percent: null, error: (cause as Error).message }
      throw cause
    } finally { this.scanning = null }
  }

  async list(refresh = false) {
    try {
      const directory = await this.folder()
      if (refresh) this.scannedDirectory = null
      await this.scan(directory)
      const { db, revision } = await this.readDb(directory)
      return { directory, revision, installedCount: this.installed.size, collections: db.collections.map(c => ({ name: c.name, count: c.hashes.length })) }
    } catch (cause) {
      if (this.progress.phase !== 'idle') this.progress = { ...this.progress, phase: 'error', percent: null, error: (cause as Error).message }
      throw cause
    }
  }

  async collection(name: string) {
    const directory = await this.folder()
    await this.scan(directory)
    const { db, revision } = await this.readDb(directory)
    const collection = db.collections.find(c => c.name === name)
    if (!collection) throw new Error('Collection no longer exists. Refresh and try again.')
    const metadata = this.metadata()
    return { revision, name, maps: collection.hashes.map(hash => ({ checksum: hash, installed: this.installed.has(hash.toLowerCase()) ? this.withStats(this.installed.get(hash.toLowerCase())!, metadata) : null })) }
  }

  async search(query: string, options: Record<string, unknown> = {}) {
    const directory = await this.folder()
    await this.scan(directory)
    const term = String(query || '').slice(0, 120).toLocaleLowerCase()
    const results: InstalledMap[] = []
    const metadata = this.metadata()
    const filters = parseMapFilters(options)
    for (const map of this.installed.values()) {
      if (`${map.artist} ${map.title} ${map.version} ${map.creator} ${map.beatmapId || ''} ${map.beatmapsetId || ''}`.toLocaleLowerCase().includes(term)) {
        const enriched = this.withStats(map, metadata)
        if (matchesMapFilters(enriched, filters)) results.push(enriched)
      }
      if (results.length >= 80) break
    }
    return results
  }

  async preview(source: 'collector' | 'tournament') {
    if (source !== 'collector' && source !== 'tournament') throw new Error('Choose a supported preview source.')
    const directory = await this.folder()
    await this.scan(directory)
    const byId = new Map<number, InstalledMap[]>()
    const bySet = new Map<number, InstalledMap[]>()
    for (const map of this.installed.values()) {
      if (map.beatmapId) byId.set(map.beatmapId, [...(byId.get(map.beatmapId) || []), map])
      if (map.beatmapsetId) bySet.set(map.beatmapsetId, [...(bySet.get(map.beatmapsetId) || []), map])
    }
    const current = this.queue.state.collections.find(c => c.id === this.queue.state.currentId)
    const metadata = this.metadata()
    const entries = source === 'collector'
      ? (current?.maps || []).map(map => ({ ...map, beatmapId: map.id, setDifficulties: undefined as TournamentEntry['setDifficulties'] }))
      : (this.queue.state.tournament?.entries || []).map(map => ({ ...map, beatmapId: map.difficultyId }))
    const seen = new Set<string>()
    const maps: (MapAttributes & { key: string; artist: string; title: string; version: string | null; beatmapId: number | null; difficultyId: number | null; setDifficulties?: undefined; beatmapsetId: number | null; stars: number | null; bpm: number | null; installed: InstalledMap | null })[] = []
    let total = 0
    const append = (entry: typeof entries[number], installed: InstalledMap | null) => {
      const key = installed ? `hash:${installed.checksum}` : entry.checksum ? `missing:${entry.checksum.toLowerCase()}` : `missing:${entry.beatmapId || 0}:${entry.beatmapsetId || 0}`
      if (seen.has(key)) return
      seen.add(key)
      total++
      if (maps.length < 5000) {
        const resolved = installed ? this.withStats(installed, metadata) : null
        const sibling = entry.setDifficulties?.find(diff => diff.id === resolved?.beatmapId)
        maps.push({ ...entry, ...sibling, ...resolved, difficultyId: resolved?.beatmapId ?? entry.beatmapId, setDifficulties: undefined, key, artist: resolved?.artist || entry.artist, title: resolved?.title || entry.title, version: resolved?.version || entry.version, beatmapId: resolved?.beatmapId || entry.beatmapId, beatmapsetId: resolved?.beatmapsetId || entry.beatmapsetId, stars: resolved?.stars ?? sibling?.stars ?? entry.stars ?? null, bpm: resolved?.bpm ?? sibling?.bpm ?? entry.bpm ?? null, installed: resolved })
      }
    }
    for (const entry of entries) {
      if (entry.checksum) append(entry, HASH.test(entry.checksum) ? this.installed.get(entry.checksum.toLowerCase()) || null : null)
      else if (entry.beatmapId) {
        const matches = byId.get(entry.beatmapId) || []
        append(entry, matches.length === 1 ? matches[0] : null)
      } else {
        const matches = entry.beatmapsetId ? bySet.get(entry.beatmapsetId) || [] : []
        if (matches.length) for (const match of matches) append(entry, match)
        else append(entry, null)
      }
    }
    return { source, name: source === 'collector' ? current?.name || null : null, total, maps }
  }

  async edit(data: { operation: string; name?: string; newName?: string; hashes?: string[]; revision?: string; confirmedClosed?: boolean }) {
    const work = this.writing.catch(() => {}).then(async () => {
      if (data.confirmedClosed !== true) throw new Error('Confirm that osu!stable is closed before editing collections.')
      if (await this.isRunning()) throw new Error('Close osu!stable before editing its collections.')
      const directory = await this.folder()
      await this.scan(directory)
      const { db, bytes, revision, file } = await this.readDb(directory)
      if (data.revision !== revision) throw new Error('collection.db changed on disk; refresh before editing.')
      const name = typeof data.name === 'string' ? data.name : ''
      const nextName = typeof data.newName === 'string' ? data.newName.trim() : ''
      const candidate = db.collections.find(c => c.name === name)
      const duplicate = (value: string) => db.collections.some(c => c.name.toLocaleLowerCase() === value.toLocaleLowerCase())
      if (data.operation === 'create') {
        if (!nextName || nextName.length > 100 || duplicate(nextName)) throw new Error('Choose a unique collection name (up to 100 characters).')
        db.collections.push({ name: nextName, hashes: [] })
      } else {
        if (!candidate) throw new Error('Collection no longer exists. Refresh and try again.')
        if (data.operation === 'rename') {
          if (!nextName || nextName.length > 100 || (nextName.toLocaleLowerCase() !== name.toLocaleLowerCase() && duplicate(nextName))) throw new Error('Choose a unique collection name (up to 100 characters).')
          candidate.name = nextName
        } else if (data.operation === 'delete') db.collections.splice(db.collections.indexOf(candidate), 1)
        else if (data.operation === 'add' || data.operation === 'remove') {
          if (!Array.isArray(data.hashes) || !data.hashes.length || data.hashes.length > 10000 || data.hashes.some(hash => typeof hash !== 'string' || !HASH.test(hash))) throw new Error('Choose valid installed beatmap checksums.')
          const selected = new Set(data.hashes.map(hash => hash.toLowerCase()))
          if (data.operation === 'add') {
            if ([...selected].some(hash => !this.installed.has(hash))) throw new Error('Import these maps into osu!stable and refresh its library before adding them.')
            const existing = new Set(candidate.hashes.map(hash => hash.toLowerCase()))
            for (const hash of selected) if (!existing.has(hash)) candidate.hashes.push(hash)
          } else candidate.hashes = candidate.hashes.filter(hash => !selected.has(hash.toLowerCase()))
        } else throw new Error('Unsupported collection edit.')
      }
      const updated = encodeCollectionDb(db)
      // Keep the old file recoverable even if a write or rename fails.
      const backupDir = path.join(process.env.PACC_BD_DATA_DIR || process.env.PANAMA_MAPS_DATA_DIR || process.env.AIMTHMUS_DATA_DIR || path.join(homedir(), '.pacc-bd'), 'stable-backups')
      await fs.mkdir(backupDir, { recursive: true })
      const backup = path.join(backupDir, `collection-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomBytes(4).toString('hex')}.db`)
      await fs.writeFile(backup, bytes, { flag: 'wx', mode: 0o600 })
      const temp = path.join(directory, `.collection.db.pacc-bd-${randomBytes(8).toString('hex')}.tmp`)
      try {
        const handle = await fs.open(temp, 'wx', 0o600)
        try { await handle.writeFile(updated); await handle.sync() } finally { await handle.close() }
        if (await this.isRunning()) throw new Error('osu!stable started during editing. No changes were saved.')
        if (checksum(await fs.readFile(file)) !== revision) throw new Error('collection.db changed on disk; no changes were saved.')
        await fs.rename(temp, file)
      } finally { await fs.rm(temp, { force: true }).catch(() => {}) }
      return { backup, ...(await this.list()) }
    })
    this.writing = work
    return work
  }
}
