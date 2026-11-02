const RELEASES = 'https://api.github.com/repos/jsposu/pacc-bd/releases/latest'
const VERSION = /^v?(\d+)\.(\d+)\.(\d+)$/

function parts(value: string): number[] {
  const match = VERSION.exec(value)
  if (!match) throw new Error('Unrecognised release version. No update link was opened.')
  return match.slice(1).map(Number)
}

export async function checkForUpdate(current: string, request: typeof fetch = fetch) {
  const installed = parts(current)
  const response = await request(RELEASES, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'PACC-BD' },
    signal: AbortSignal.timeout(10000),
  })
  if (!response.ok) throw new Error(`Could not check GitHub Releases (HTTP ${response.status}). Try again later.`)
  if (Number(response.headers.get('content-length')) > 1024 * 1024) throw new Error('GitHub returned an oversized release response.')
  const text = await response.text()
  if (text.length > 1024 * 1024) throw new Error('GitHub returned an oversized release response.')
  const release = JSON.parse(text) as { tag_name?: unknown; body?: unknown }
  if (typeof release.tag_name !== 'string' || !/^v\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(release.tag_name)) throw new Error('GitHub returned an invalid release version.')
  const latest = parts(release.tag_name)
  const firstDifference = latest.findIndex((number, index) => number !== installed[index])
  const available = firstDifference !== -1 && latest[firstDifference] > installed[firstDifference]
  return { current, latest: release.tag_name, available, notes: typeof release.body === 'string' ? release.body.slice(0, 4000) : '', url: `https://github.com/jsposu/pacc-bd/releases/tag/${release.tag_name}` }
}
