import type { QueueItem } from '../server/types'

export type SortOrder = 'original' | 'title' | 'artist' | 'difficulty'
type Sortable = { title: string; artist: string; stars: number | null }
export function sortMapGroups<T extends Sortable>(groups: T[][], order: SortOrder): T[][] {
  if (order === 'original') return groups
  return [...groups].sort((a, b) => {
    if (order !== 'difficulty') return a[0][order].localeCompare(b[0][order], undefined, { sensitivity: 'base', numeric: true })
    const highest = (maps: T[]) => Math.max(-1, ...maps.flatMap(map => map.stars === null ? [] : [map.stars]))
    return highest(b) - highest(a)
  })
}
export function queueSummary(queue: QueueItem[], paused: boolean) {
  const active = queue.find(item => item.status === 'downloading')
  const waiting = queue.filter(item => item.status === 'pending').length
  const done = queue.filter(item => item.status === 'done').length
  const failed = queue.filter(item => item.status === 'failed').length
  const cancelled = queue.filter(item => item.status === 'cancelled').length
  const percent = active && active.total && active.total > 0 ? Math.min(100, Math.max(0, Math.floor(active.bytes / active.total * 100))) : null
  return { active, waiting, done, failed, cancelled, total: queue.length, percent,
    status: active ? 'downloading' : waiting ? paused ? 'paused' : 'pending' : failed ? 'attention' : cancelled ? 'cancelled' : queue.length ? 'allDone' : 'ready' } as const
}
