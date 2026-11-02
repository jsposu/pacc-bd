import { promises as fs } from 'node:fs'
import path from 'node:path'
import { setTimeout as wait } from 'node:timers/promises'
import { defaultDirectory, ensureDirectory, filename, streamFile, validOsz } from './files.js'
import { DownloadError, requestDownload } from './mirrors.js'
import type { Collection, QueueItem, Settings, State, TournamentManifest } from './types.js'

const MAX_ATTEMPTS = 3
const PACE_MS = 1600
const MAX_WAIT_MS = 24 * 60 * 60 * 1000
const PART_SUFFIX = '.pacc-bd.part'
export function selectedSets(collection: Collection, ids: number[]): Map<number, number[]> {
  const selected = new Set(ids)
  const sets = new Map<number, number[]>()
  for (const map of collection.maps) {
    if (!selected.has(map.id) || !map.beatmapsetId) continue
    sets.set(map.beatmapsetId, [...(sets.get(map.beatmapsetId) || []), map.id])
  }
  return sets
}

export class Queue {
  state: State
  private writing: Promise<void> = Promise.resolve()
  private running = false
  private controller: AbortController | null = null
  private active: QueueItem | null = null

  constructor(private stateFile: string, state?: State, private request: typeof fetch = fetch) {
    this.state = state ?? { settings: { directory: defaultDirectory, mirror: 'direct' }, collections: [], currentId: null, queue: [], paused: false }
  }
  static async open(stateFile: string, request?: typeof fetch): Promise<Queue> {
    let state: State | undefined
    try { state = JSON.parse(await fs.readFile(stateFile, 'utf8')) as State } catch (error: any) { if (error?.code !== 'ENOENT') throw error }
    const queue = new Queue(stateFile, state, request)
    await queue.recover()
    queue.kick()
    return queue
  }
  private save(): Promise<void> {
    // Snapshot now, serialize writes; a crash cannot leave a half-written JSON state.
    const snapshot = JSON.stringify(this.state, null, 2)
    this.writing = this.writing.catch(() => {}).then(async () => {
      await fs.mkdir(path.dirname(this.stateFile), { recursive: true })
      const temp = `${this.stateFile}.${process.pid}.tmp`
      await fs.writeFile(temp, snapshot)
      await fs.rename(temp, this.stateFile)
    })
    return this.writing
  }
  private async recover(): Promise<void> {
    for (const item of this.state.queue) {
      // Only remove temporary files for jobs recorded by this app.
      const directory = item.filePath ? path.dirname(item.filePath) : this.state.settings.directory
      const part = path.join(directory, `${item.filename}${PART_SUFFIX}`)
      const legacyParts = ['.panama-maps.part', '.aimthmus.part'].map(suffix => path.join(directory, `${item.filename}${suffix}`))
      if (item.status === 'downloading') {
        // A crash after the exclusive hard-link but before the state write leaves
        // both names pointing at the same inode. This is our completed file, not
        // an unrelated file with a coincidentally matching name.
        const final = path.join(directory, item.filename)
        const finalStat = await fs.lstat(final).catch(() => null)
        const matchingPart = await Promise.all([part, ...legacyParts].map(file => fs.lstat(file).catch(() => null)))
        if (finalStat?.isFile() && matchingPart.some(tempStat => tempStat?.isFile() && tempStat.ino === finalStat.ino && tempStat.dev === finalStat.dev) && await validOsz(final)) {
          item.status = 'done'; item.filePath = final; item.bytes = finalStat.size; item.total = finalStat.size
        }
      }
      await fs.rm(part, { force: true }).catch(() => {})
      for (const oldPart of legacyParts) await fs.rm(oldPart, { force: true }).catch(() => {})
      if (item.status === 'downloading') item.status = 'pending'
      if (item.status === 'done' && (!item.filePath || !await validOsz(item.filePath))) {
        const exists = item.filePath && await fs.stat(item.filePath).then(() => true, () => false)
        item.status = exists ? 'failed' : 'pending'
        item.error = exists ? 'Saved file is invalid. Move or remove it before retrying; PACC-BD will not overwrite files.' : 'Saved file is missing; queued again.'
        item.filePath = null
      }
      if (item.status !== 'done') { item.bytes = 0; item.total = null }
    }
    await this.save()
  }
  async setCollection(collection: Collection): Promise<void> {
    this.state.collections = [collection, ...this.state.collections.filter(c => c.id !== collection.id)].slice(0, 20)
    this.state.currentId = collection.id
    await this.save()
  }
  async setTournament(manifest: TournamentManifest): Promise<void> {
    this.state.tournament = manifest
    await this.save()
  }
  async showCollection(id: number): Promise<void> {
    if (!this.state.collections.some(c => c.id === id)) throw new Error('Collection is not in saved previews.')
    this.state.currentId = id
    await this.save()
  }
  async settings(settings: Settings): Promise<void> {
    if (!['direct', 'catboy'].includes(settings.mirror)) throw new Error('Choose a supported mirror.')
    if (this.active) throw new Error('Pause and wait for the active file to finish before changing settings.')
    const directory = await ensureDirectory(settings.directory)
    this.state.settings = { directory, mirror: settings.mirror }
    await this.save()
  }
  async enqueue(collectionId: number, ids: number[]): Promise<number> {
    const collection = this.state.collections.find(c => c.id === collectionId)
    if (!collection) throw new Error('Fetch this collection first.')
    if (!Array.isArray(ids) || ids.length > 10000 || ids.some(id => !Number.isSafeInteger(id))) throw new Error('Invalid difficulty selection.')
    const known = new Set(collection.maps.map(map => map.id))
    if (ids.some(id => !known.has(id))) throw new Error('Selection contains maps outside this collection.')
    const sets = selectedSets(collection, ids)
    if (sets.size === 0) throw new Error('No downloadable beatmapsets selected. Some maps may lack a beatmapset ID.')
    return this.enqueueSets(sets, setId => {
      const map = collection.maps.find(m => m.beatmapsetId === setId)!
      return { collectionId, collectionName: collection.name, artist: map.artist, title: map.title }
    })
  }
  async enqueueTournament(ids: number[]): Promise<number> {
    const manifest = this.state.tournament
    if (!manifest) throw new Error('Preview tournament IDs first.')
    if (!Array.isArray(ids) || ids.length > 200 || ids.some(id => !Number.isSafeInteger(id))) throw new Error('Invalid tournament selection.')
    const known = new Set(manifest.entries.map(entry => entry.beatmapsetId))
    if (ids.some(id => !known.has(id))) throw new Error('Selection contains sets outside this tournament preview.')
    const sets = new Map<number, number[]>()
    for (const id of ids) sets.set(id, [...new Set(manifest.entries.filter(entry => entry.beatmapsetId === id && entry.difficultyId).map(entry => entry.difficultyId!))])
    if (!sets.size) throw new Error('Select at least one beatmapset.')
    return this.enqueueSets(sets, setId => {
      const entry = manifest.entries.find(item => item.beatmapsetId === setId)!
      return { collectionId: 0, collectionName: 'Tournament IDs', artist: entry.artist, title: entry.title }
    })
  }
  private async enqueueSets(sets: Map<number, number[]>, details: (setId: number) => Pick<QueueItem, 'collectionId' | 'collectionName' | 'artist' | 'title'>): Promise<number> {
    await ensureDirectory(this.state.settings.directory)
    let added = 0
    for (const [setId, difficultyIds] of sets) {
      const existing = this.state.queue.find(q => q.beatmapsetId === setId)
      if (existing) {
        existing.difficultyIds = [...new Set([...existing.difficultyIds, ...difficultyIds])]
        if (existing.status === 'cancelled') { existing.status = 'pending'; existing.error = null; added++ }
        continue
      }
      const info = details(setId)
      this.state.queue.push({ key: String(setId), ...info, beatmapsetId: setId,
        difficultyIds, status: 'pending', filename: filename(setId, info.artist, info.title),
        filePath: null, bytes: 0, total: null, error: null, attempts: 0 })
      added++
    }
    this.state.paused = false
    await this.save()
    this.kick()
    return added
  }
  async pause(): Promise<void> { this.state.paused = true; await this.save() }
  async resume(): Promise<void> { this.state.paused = false; await this.save(); this.kick() }
  async cancel(): Promise<void> {
    this.state.paused = true
    for (const item of this.state.queue) if (item.status === 'pending' || item.status === 'downloading') {
      item.status = 'cancelled'; item.bytes = 0; item.total = null; item.error = null
    }
    this.controller?.abort()
    await this.save()
  }
  async retry(): Promise<void> {
    for (const item of this.state.queue) if (item.status === 'failed') { item.status = 'pending'; item.error = null; item.attempts = 0 }
    this.state.paused = false
    await this.save()
    this.kick()
  }
  private kick(): void {
    if (this.running || this.state.paused || !this.state.queue.some(q => q.status === 'pending')) return
    this.running = true
    void this.run().finally(() => { this.running = false; if (!this.state.paused && this.state.queue.some(q => q.status === 'pending')) this.kick() })
  }
  private async run(): Promise<void> {
    while (!this.state.paused) {
      const item = this.state.queue.find(q => q.status === 'pending')
      if (!item) return
      this.active = item
      this.controller = new AbortController()
      item.status = 'downloading'; item.error = null; item.attempts = 0
      await this.save()
      try { await this.download(item, this.controller.signal) }
      catch (error) {
        if (!this.controller.signal.aborted) {
          item.status = 'failed'
          item.error = error instanceof Error ? error.message : 'Download failed.'
        }
      }
      this.active = null; this.controller = null
      await this.save()
      if (!this.state.paused && this.state.queue.some(q => q.status === 'pending')) await wait(PACE_MS)
    }
  }
  private async download(item: QueueItem, signal: AbortSignal): Promise<void> {
    const dir = await ensureDirectory(this.state.settings.directory)
    const final = path.join(dir, item.filename)
    const temp = `${final}${PART_SUFFIX}`
    if (await fs.stat(final).then(() => true, () => false)) throw new Error('A file with this name already exists. PACC-BD will not overwrite it.')
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      if (signal.aborted) throw new Error('Cancelled.')
      item.attempts = attempt; item.bytes = 0; item.total = null
      await fs.rm(temp, { force: true })
      try {
        const response = await requestDownload(this.state.settings.mirror, item.beatmapsetId, signal, this.request)
        const length = Number(response.headers.get('content-length'))
        item.total = Number.isSafeInteger(length) && length > 0 ? length : null
        const bytes = await streamFile(response.body!, temp, signal, count => { item.bytes = count })
        if (item.total !== null && bytes !== item.total) throw new DownloadError('Incomplete download (size mismatch).', true)
        if (!await validOsz(temp)) throw new DownloadError('Mirror response was not a valid .osz archive containing an .osu file.')
        if (signal.aborted) throw new Error('Cancelled.')
        // link is exclusive: never overwrite a file created in the meantime.
        await fs.link(temp, final)
        await fs.rm(temp, { force: true })
        item.filePath = final; item.status = 'done'; item.error = null; item.bytes = bytes; item.total = bytes
        return
      } catch (error) {
        await fs.rm(temp, { force: true }).catch(() => {})
        if (signal.aborted) throw new Error('Cancelled.')
        const problem = error instanceof DownloadError ? error : new DownloadError(error instanceof Error ? error.message : 'Network error.', true)
        if (!problem.temporary || attempt === MAX_ATTEMPTS) throw problem
        const delay = problem.delay ?? 2000 * attempt
        if (delay > MAX_WAIT_MS) throw new Error('Mirror requested a wait longer than 24 hours. Retry later.')
        item.error = `${problem.message} Waiting ${Math.ceil(delay / 1000)}s before retry ${attempt + 1}/${MAX_ATTEMPTS}.`
        await this.save()
        await wait(delay, undefined, { signal })
        item.error = null
      }
    }
  }
}
