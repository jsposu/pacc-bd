import type { MapAttributes } from './types.js'

export function finiteStat(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

// Preserve absent metadata as unknown, not false or zero. API OD is named accuracy.
export function mapAttributes(raw: Record<string, any> = {}, set: Record<string, any> = {}): MapAttributes {
  const bool = (value: unknown) => typeof value === 'boolean' ? value : null
  const id = (value: unknown) => typeof value === 'object' && value !== null && 'id' in value && typeof value.id === 'number' ? String(value.id) : typeof value === 'number' ? String(value) : null
  return {
    ar: finiteStat(raw.ar), od: finiteStat(raw.accuracy), cs: finiteStat(raw.cs), hp: finiteStat(raw.drain),
    length: finiteStat(raw.hit_length), mode: typeof raw.mode === 'string' ? raw.mode : ['osu', 'taiko', 'fruits', 'mania'][raw.mode_int] ?? null,
    status: typeof raw.status === 'string' ? raw.status : typeof set.status === 'string' ? set.status : null,
    genre: id(set.genre ?? set.genre_id), language: id(set.language ?? set.language_id),
    explicit: bool(set.nsfw), video: bool(set.video), storyboard: bool(set.storyboard),
    featuredArtist: set.track_id === undefined ? null : set.track_id !== null && Number(set.track_id) > 0,
    convert: bool(raw.convert),
  }
}
