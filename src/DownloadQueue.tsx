import { useState } from 'react'
import { ArrowDownToLine, Check, ChevronDown, Clock3, Pause, Play, RefreshCcw, Square, Trash2, X } from 'lucide-react'
import { copy, localizeError, type Language } from './i18n'
import { queueSummary } from './listing'
import type { QueueItem } from '../server/types'

export function DownloadQueue({ queue, paused, language, onAction }: { queue: QueueItem[]; paused: boolean; language: Language; onAction: (route: string) => Promise<void> }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const t = copy[language], es = language === 'es', summary = queueSummary(queue, paused)
  const outstanding = summary.waiting + (summary.active ? 1 : 0)
  const bytes = (n: number) => n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`
  const label = summary.active ? `${t.downloading}: ${summary.active.artist} — ${summary.active.title}` : summary.status === 'paused' ? `${t.paused} · ${queue.find(item => item.status === 'pending')?.title}` : t[summary.status]
  async function action(route: string) { setBusy(true); try { await onAction(route) } finally { setBusy(false) } }
  return <section className="download-queue" aria-label={t.queue} id="queue">
    <div className="queue-now">
      <ArrowDownToLine size={17} className="queue-now-icon" aria-hidden="true" />
      <div className="queue-now-main"><strong title={label} role="status" aria-live="polite" aria-atomic="true">{label}</strong><span className="queue-current-transfer">{summary.active ? summary.percent === null ? `${bytes(summary.active.bytes)} · ${t.sizeUnknown}` : `${summary.percent}%` : t.queue}</span></div>
      <span className="queue-now-count" aria-label={es ? `${summary.done} de ${summary.total} completados` : `${summary.done} of ${summary.total} completed`}>{summary.done} / {summary.total} <small>{t.completed}</small></span>
      {outstanding > 0 && <button type="button" className="queue-now-control" disabled={busy} aria-label={paused ? t.resume : t.pause} title={paused ? t.resume : t.pause} onClick={() => void action(paused ? 'resume' : 'pause')}>{paused ? <Play size={16} /> : <Pause size={16} />}</button>}
      <button type="button" className="queue-toggle" aria-expanded={open} aria-controls="download-queue-detail" aria-label={open ? t.collapse : t.expand} title={t.queue} onClick={() => setOpen(!open)}><ChevronDown size={17} className={open ? 'rotate' : ''} /></button>
      <progress className="queue-now-progress" aria-label={summary.active ? `${summary.active.title} · ${t.downloading}` : t.queue} max={100} value={summary.active ? summary.percent ?? undefined : summary.total ? summary.done / summary.total * 100 : 0} />
    </div>
    <div id="download-queue-detail" className="queue-detail" hidden={!open}>
      <div className="queue-detail-toolbar"><strong>{t.queue}</strong><span>{outstanding} {t.remaining}{summary.failed ? ` · ${summary.failed} ${t.failed}` : ''}{summary.cancelled ? ` · ${summary.cancelled} ${t.cancelled}` : ''}</span><div>
        <button type="button" disabled={busy || !outstanding} onClick={() => void action('cancel')} title={t.pauseHint}><Square size={13} />{t.cancel}</button>
        {summary.failed > 0 && <button type="button" disabled={busy} onClick={() => void action('retry')}><RefreshCcw size={13} />{t.retry}</button>}
        <button type="button" disabled={busy || !!outstanding || !queue.length} onClick={() => { if (window.confirm(t.queueClearConfirm)) void action('queue/clear') }} title={outstanding ? t.queueClearBlocked : t.queueClearConfirm}><Trash2 size={13} />{t.clear}</button>
      </div></div>
      <ol className="queue-download-list">{queue.map((item, index) => <li className={`queue-download-item ${item.status}`} key={item.key} data-queue-key={item.key} aria-current={item.status === 'downloading' ? 'step' : undefined}><span className="queue-position">{index + 1}</span><span className="queue-state-icon">{item.status === 'done' ? <Check size={15} /> : item.status === 'downloading' ? <ArrowDownToLine size={15} /> : item.status === 'failed' ? <X size={15} /> : <Clock3 size={15} />}</span><div><a href={`https://osu.ppy.sh/beatmapsets/${item.beatmapsetId}`} target="_blank" rel="noopener noreferrer">{item.title}</a><small>{item.artist}</small></div><span className="queue-download-status" title={item.error ? localizeError(item.error, language) : undefined}>{item.error ? localizeError(item.error, language) : item.status === 'downloading' ? summary.percent === null ? t.preparing : `${summary.percent}%` : t[item.status]}</span></li>)}</ol>
      {!queue.length && <p className="queue-empty-note">{t.queueEmpty}</p>}
    </div>
  </section>
}
