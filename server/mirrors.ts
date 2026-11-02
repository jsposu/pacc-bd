export type Mirror = 'direct' | 'catboy'
const routes: Record<Mirror, (id: number) => string> = {
  direct: id => `https://osu.direct/api/d/${id}`,
  catboy: id => `https://catboy.best/d/${id}`,
}
const hosts: Record<Mirror, string[]> = { direct: ['osu.direct', 'storage.osu.direct'], catboy: ['catboy.best'] }
export function downloadURL(mirror: Mirror, id: number): string {
  if (!Number.isSafeInteger(id) || id < 1) throw new Error('Invalid beatmapset ID.')
  return routes[mirror](id)
}
export function retryAfter(value: string | null, now = Date.now()): number | null {
  if (!value) return null
  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000
  const date = Date.parse(value)
  return Number.isFinite(date) ? Math.max(0, date - now) : null
}
export class DownloadError extends Error {
  constructor(message: string, public temporary = false, public delay: number | null = null) { super(message) }
}
export async function requestDownload(mirror: Mirror, id: number, signal: AbortSignal, request: typeof fetch = fetch): Promise<Response> {
  let url = downloadURL(mirror, id)
  for (let redirects = 0; redirects < 4; redirects++) {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' || !hosts[mirror].includes(parsed.hostname) || parsed.port || parsed.username || parsed.password) throw new DownloadError('Mirror redirected to an unapproved download host.')
    const response = await request(url, { redirect: 'manual', signal, headers: { 'User-Agent': 'PACC-BD/1.0 (local public beatmap downloader)', Accept: 'application/octet-stream,application/zip,*/*' } })
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location')
      await response.body?.cancel()
      if (!location) throw new DownloadError('Mirror redirect has no destination.')
      url = new URL(location, url).toString()
      continue
    }
    if (response.status === 429) {
      const delay = retryAfter(response.headers.get('retry-after'))
      await response.body?.cancel()
      throw new DownloadError('Mirror rate limited (HTTP 429).', true, delay ?? 60000)
    }
    if (!response.ok) {
      const status = response.status
      await response.body?.cancel()
      throw new DownloadError(`Mirror returned HTTP ${status}${status === 403 ? ' (access denied)' : status === 404 ? ' (map unavailable)' : ''}.`, status >= 500 || status === 408)
    }
    if (!response.body) throw new DownloadError('Mirror returned an empty response.')
    return response
  }
  throw new DownloadError('Mirror redirected too many times.')
}
