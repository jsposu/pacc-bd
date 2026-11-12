import { useState, type CSSProperties } from 'react'
import { ArrowDownToLine, Check, ChevronDown, LoaderCircle } from 'lucide-react'
import { copy, type Language } from './i18n'
import { difficultyColour } from './difficultyColours'
import type { QueueItem } from '../server/types'

export type CardDifficulty = { key: string; version: string | null; stars: number | null; mode?: string | null; selected?: boolean; onSelect?: () => void }
type Props = {
  setId: number | null; title: string; artist: string; creator: string; cover: string | null
  status: string; featuredArtist?: boolean | null; difficulties: CardDifficulty[]
  selected: boolean; onSelect(): void; onDownload(): Promise<void>; queued?: QueueItem; language: Language
}
export function BeatmapCard({ setId, title, artist, creator, cover, status, featuredArtist, difficulties, selected, onSelect, onDownload, queued, language }: Props) {
  const t = copy[language], es = language === 'es'
  const [brokenCover, setBrokenCover] = useState<string | null>(null), [busy, setBusy] = useState(false), [expanded, setExpanded] = useState(false)
  const href = setId ? `https://osu.ppy.sh/beatmapsets/${setId}` : undefined
  const locked = !setId || busy || !!queued && ['pending', 'downloading', 'done', 'failed'].includes(queued.status)
  const downloadLabel = queued?.status === 'done' ? t.downloadedHere : queued?.status === 'failed' ? t.retry : queued?.status === 'pending' || queued?.status === 'downloading' ? t[queued.status] : es ? 'Descargar beatmapset' : 'Download beatmapset'
  const statusLabel = es ? ({ ranked: 'CLASIFICADO', approved: 'APROBADO', loved: 'POPULAR', qualified: 'CALIFICADO', pending: 'PENDIENTE', wip: 'EN PROGRESO', graveyard: 'ARCHIVADO' } as Record<string, string>)[status] || status.toUpperCase() : status.toUpperCase()
  async function download() { setBusy(true); try { await onDownload() } finally { setBusy(false) } }
  return <article className={`beatmap-card ${selected ? 'is-selected' : ''}`} data-set-id={setId ?? undefined}>
    <div className="beatmap-card-art" aria-hidden="true">{cover && cover !== brokenCover && <img src={cover} alt="" loading="lazy" onError={() => setBrokenCover(cover)} />}</div>
    <div className="beatmap-card-cover">
      <label className="beatmap-card-select"><input type="checkbox" checked={selected} disabled={!setId} onChange={onSelect} aria-label={`${t.selectMap} ${artist} - ${title}`} /><span><Check size={14} /></span></label>
      {href && <a className="beatmap-card-open" href={href} target="_blank" rel="noopener noreferrer" aria-label={`${es ? 'Ver en osu!' : 'View on osu!'}: ${title}`} />}
    </div>
    <div className="beatmap-card-info">
      {featuredArtist && <span className="beatmap-card-featured">FEATURED ARTIST</span>}
      <a className="beatmap-card-title" href={href} target="_blank" rel="noopener noreferrer" title={title}>{title}</a>
      <div className="beatmap-card-artist" title={artist}>{t.by} {artist}</div>
      <div className="beatmap-card-mapper">{t.mappedBy} <strong>{creator}</strong></div>
      <div className="beatmap-card-bottom"><span className={`beatmap-card-status status-${status}`}>{statusLabel}</span><div className="difficulty-strip" role="group" aria-label={t.diffLabel}>
        {[...new Set(difficulties.map(diff => diff.mode).filter(Boolean))].map(mode => <span className="card-mode" key={mode} title={mode!} aria-label={mode!}>{({ osu: '◉', taiko: '◎', fruits: '◒', mania: '▥' } as Record<string, string>)[mode!] || '◉'}</span>)}
        {(expanded ? difficulties : difficulties.slice(0, 14)).map(diff => <button type="button" key={diff.key} className={`difficulty-dot ${diff.selected ? 'selected' : ''}`} style={{ '--difficulty-colour': diff.stars === null ? '#a7adb7' : difficultyColour(diff.stars) } as CSSProperties} disabled={!diff.onSelect} onClick={diff.onSelect} aria-pressed={diff.onSelect ? !!diff.selected : undefined} aria-label={`${diff.mode || 'osu!'} · ${diff.version || (es ? 'Conjunto completo' : 'Full set')} · ${diff.stars === null ? t.stableUnknownStat : `${diff.stars.toFixed(2)}★`}`} title={`${diff.mode || 'osu!'} · ${diff.version || (es ? 'Conjunto completo' : 'Full set')} · ${diff.stars === null ? t.stableUnknownStat : `${diff.stars.toFixed(2)}★`}`}><i /></button>)}
        {difficulties.length > 14 && <button className="difficulty-more" type="button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? '−' : `+${difficulties.length - 14}`}</button>}
      </div></div>
      <details className="beatmap-card-difficulties"><summary>{t.difficulties} <span>{difficulties.length}</span><ChevronDown size={12} /></summary><div>{difficulties.map(diff => <button type="button" key={diff.key} disabled={!diff.onSelect} aria-pressed={diff.onSelect ? !!diff.selected : undefined} onClick={diff.onSelect}><span>{diff.version || (es ? 'Conjunto completo' : 'Full set')}</span><b style={{ '--difficulty-colour': diff.stars === null ? '#a7adb7' : difficultyColour(diff.stars) } as CSSProperties}>{diff.stars === null ? '—' : `${diff.stars.toFixed(2)}★`}</b></button>)}</div></details>
    </div>
    <div className="beatmap-card-actions"><button type="button" className="card-download" aria-label={`${downloadLabel}: ${title}`} title={queued?.status === 'failed' ? es ? 'Reintenta desde la cola de descargas' : 'Retry from the download queue' : `${downloadLabel} · .osz`} disabled={locked} onClick={() => void download()}>{busy || queued?.status === 'downloading' ? <LoaderCircle size={20} className="spin" /> : queued?.status === 'done' ? <Check size={20} /> : <ArrowDownToLine size={20} />}</button></div>
  </article>
}
