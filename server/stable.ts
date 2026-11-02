import { createHash, randomBytes } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { execFile } from 'node:child_process'
import type { Queue } from './queue.js'

const run = promisify(execFile)
const HASH = /^[a-f0-9]{32}$/i
const MAX_DB = 64 * 1024 * 1024
const MAX_MAPS = 100000
type StableCollection = { name: string; hashes: string[] }
export type InstalledMap = { checksum: string; artist: string; title: string; creator: string; version: string; beatmapId: number | null; beatmapsetId: number | null }
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
  let inMetadata = false
  for (const line of content.split(/\r?\n/)) {
    if (line.trim() === '[Metadata]') { inMetadata = true; continue }
    if (inMetadata && /^\[.*\]/.test(line.trim())) break
    if (!inMetadata) continue
    const at = line.indexOf(':')
    if (at > 0) fields[line.slice(0, at).trim()] = line.slice(at + 1).trim()
  }
  return { checksum: md5(buffer), artist: fields.Artist || 'Unknown artist', title: fields.Title || 'Unknown title', creator: fields.Creator || 'Unknown mapper', version: fields.Version || 'Unknown difficulty', beatmapId: positive(fields.BeatmapID), beatmapsetId: positive(fields.BeatmapSetID) }
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
  constructor(private queue: Queue, private isRunning: () => Promise<boolean> = osuRunning) {}

  private async folder(input = this.queue.state.stableDirectory): Promise<string> {
    if (typeof input !== 'string' || !path.isAbsolute(input) || input.includes('\0')) throw new Error('Choose your osu!stable installation folder first.')
    const directory = await fs.realpath(input)
    const db = await fs.lstat(path.join(directory, 'collection.db'))
    const songs = await fs.lstat(path.join(directory, 'Songs'))
    if (!db.isFile() || !songs.isDirectory()) throw new Error('Choose an osu!stable folder containing collection.db and Songs.')
    return directory
  }

  async connect(input: string) {
    await this.writing.catch(() => {})
    if (this.scanning) await this.scanning
    const directory = await this.folder(input)
    await this.readDb(directory)
    this.queue.state.stableDirectory = directory
    await this.queue.persist()
    this.scannedDirectory = null
    this.installed.clear()
    return this.list()
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
      const found = new Map<string, InstalledMap>()
      const pending = [path.join(directory, 'Songs')]
      let count = 0
      while (pending.length) {
        const folder = pending.pop()!
        for await (const item of await fs.opendir(folder)) {
          const file = path.join(folder, item.name)
          if (item.isDirectory()) pending.push(file)
          else if (item.isFile() && item.name.toLowerCase().endsWith('.osu')) {
            if (++count > MAX_MAPS) throw new Error('Too many installed maps to scan safely.')
            const stat = await fs.stat(file)
            if (stat.size < 16 || stat.size > 8 * 1024 * 1024) continue
            const data = await fs.readFile(file)
            const map = installedMap(data)
            found.set(map.checksum, map)
          }
        }
      }
      this.installed = found
      this.scannedDirectory = directory
    })()
    try { await this.scanning } finally { this.scanning = null }
  }

  async list(refresh = false) {
    const directory = await this.folder()
    if (refresh) this.scannedDirectory = null
    await this.scan(directory)
    const { db, revision } = await this.readDb(directory)
    return { directory, revision, installedCount: this.installed.size, collections: db.collections.map(c => ({ name: c.name, count: c.hashes.length })) }
  }

  async collection(name: string) {
    const directory = await this.folder()
    await this.scan(directory)
    const { db, revision } = await this.readDb(directory)
    const collection = db.collections.find(c => c.name === name)
    if (!collection) throw new Error('Collection no longer exists. Refresh and try again.')
    return { revision, name, maps: collection.hashes.map(hash => ({ checksum: hash, installed: this.installed.get(hash.toLowerCase()) || null })) }
  }

  async search(query: string) {
    const directory = await this.folder()
    await this.scan(directory)
    const term = String(query || '').slice(0, 120).toLocaleLowerCase()
    const results: InstalledMap[] = []
    for (const map of this.installed.values()) {
      if (`${map.artist} ${map.title} ${map.version} ${map.creator} ${map.beatmapId || ''} ${map.beatmapsetId || ''}`.toLocaleLowerCase().includes(term)) results.push(map)
      if (results.length >= 80) break
    }
    return results
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
