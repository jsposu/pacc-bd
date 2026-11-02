import { createWriteStream, promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import yauzl from 'yauzl'

export const defaultDirectory = path.join(homedir(), 'Downloads', 'PACC-BD')
export function cleanName(value: string): string {
  return value.normalize('NFKC').replace(/[<>:"/\\|?*\x00-\x1f\x7f]/g, '').replace(/\s+/g, ' ').replace(/[. ]+$/g, '').trim().slice(0, 65) || 'Untitled'
}
export function filename(id: number, artist: string, title: string): string {
  return `${id} ${cleanName(artist)} - ${cleanName(title)}.osz`
}
export async function ensureDirectory(dir: string): Promise<string> {
  if (!path.isAbsolute(dir) || path.parse(dir).root === path.resolve(dir) || dir.includes('\0')) throw new Error('Choose an absolute folder path, not a filesystem root.')
  const resolved = path.resolve(dir)
  await fs.mkdir(resolved, { recursive: true })
  const stats = await fs.stat(resolved)
  if (!stats.isDirectory()) throw new Error('Download path is not a folder.')
  await fs.access(resolved, fs.constants.W_OK)
  return resolved
}

export async function validOsz(file: string): Promise<boolean> {
  let stats
  try { stats = await fs.stat(file); if (!stats.isFile() || stats.size < 1024) return false } catch { return false }
  return new Promise(resolve => {
    yauzl.open(file, { lazyEntries: true, validateEntrySizes: true }, (err, zip) => {
      if (err || !zip) return resolve(false)
      let osu = false
      let finished = false
      const done = (result: boolean) => { if (finished) return; finished = true; zip.close(); resolve(result) }
      zip.on('error', () => done(false))
      zip.on('end', () => done(osu))
      zip.on('entry', entry => { if (/\.osu$/i.test(entry.fileName)) osu = true; zip.readEntry() })
      zip.readEntry()
    })
  })
}

export async function streamFile(body: ReadableStream<Uint8Array>, file: string, signal: AbortSignal, progress: (bytes: number) => void): Promise<number> {
  let bytes = 0
  const input = Readable.fromWeb(body as import('node:stream/web').ReadableStream<Uint8Array>)
  input.on('data', (chunk: Buffer) => { bytes += chunk.length; progress(bytes) })
  await pipeline(input, createWriteStream(file, { flags: 'wx' }), { signal })
  return bytes
}
