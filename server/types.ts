export type Difficulty = {
  id: number
  beatmapsetId: number | null
  checksum: string | null
  version: string
  mode: string
  stars: number | null
  status: string
  artist: string
  title: string
  creator: string
  cover: string | null
  bpm: number | null
  length: number | null
}
export type Collection = {
  id: number
  name: string
  uploader: string
  reportedCount: number
  maps: Difficulty[]
  fetchedAt: string
}
export type TournamentEntry = {
  source: string
  kind: 'beatmap' | 'beatmapset'
  requestedId: number
  beatmapsetId: number
  difficultyId: number | null
  checksum: string | null
  version: string | null
  stars: number | null
  artist: string
  title: string
  creator: string
  cover: string | null
  status: string
}
export type TournamentManifest = {
  entries: TournamentEntry[]
  failures: { source: string; reason: string }[]
  fetchedAt: string
}
export type Status = 'pending' | 'downloading' | 'done' | 'failed' | 'cancelled'
export type QueueItem = {
  key: string
  collectionId: number
  collectionName: string
  beatmapsetId: number
  artist: string
  title: string
  difficultyIds: number[]
  status: Status
  filename: string
  filePath: string | null
  bytes: number
  total: number | null
  error: string | null
  attempts: number
}
export type Settings = { directory: string; mirror: 'direct' | 'catboy' }
export type Theme = 'team' | 'light' | 'oled'
export type State = { settings: Settings; collections: Collection[]; currentId: number | null; queue: QueueItem[]; paused: boolean; tournament?: TournamentManifest; stableDirectory?: string; theme?: Theme }
