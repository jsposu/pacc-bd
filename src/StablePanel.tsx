import { useEffect, useState, type FormEvent } from 'react'
import { Check, FolderOpen, LoaderCircle, Plus, RefreshCcw, Search, Trash2 } from 'lucide-react'
import { copy, localizeError, type Language, type TranslationKey } from './i18n'

type MapInfo = { checksum: string; artist: string; title: string; creator: string; version: string; beatmapId: number | null; beatmapsetId: number | null }
type View = { directory: string; revision: string; installedCount: number; collections: { name: string; count: number }[] }
type Detail = { name: string; revision: string; maps: { checksum: string; installed: MapInfo | null }[] }
async function api<T>(url: string, body?: object): Promise<T> {
  const response = await fetch(`/api/stable${url}`, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined)
  const result = await response.json()
  if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`)
  return result as T
}

export function StablePanel({ language, sourceChecksums }: { language: Language; sourceChecksums: string[] }) {
  const t = (key: TranslationKey): string => copy[language][key]
  const [directory, setDirectory] = useState('')
  const [view, setView] = useState<View | null>(null)
  const [detail, setDetail] = useState<Detail | null>(null)
  const [library, setLibrary] = useState<MapInfo[]>([])
  const [query, setQuery] = useState('')
  const [name, setName] = useState('')
  const [rename, setRename] = useState('')
  const [chosen, setChosen] = useState<Set<string>>(new Set())
  const [remove, setRemove] = useState<Set<string>>(new Set())
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    void api<View>('').then(result => { setView(result); setDirectory(result.directory) }).catch(() => {})
  }, [])

  async function loadCollection(collection: string) {
    const result = await api<Detail>(`/collection?name=${encodeURIComponent(collection)}`)
    setDetail(result); setRename(result.name); setRemove(new Set())
    setLibrary(await api<MapInfo[]>(`/search?q=${encodeURIComponent(query)}`))
  }
  async function task(work: () => Promise<void>) {
    setBusy(true); setError(''); setNotice('')
    try { await work() } catch (cause) { setError(localizeError((cause as Error).message, language)) }
    finally { setBusy(false) }
  }
  function connect(event: FormEvent) {
    event.preventDefault()
    void task(async () => {
      const next = await api<View>('/connect', { directory })
      setView(next); setDirectory(next.directory); setDetail(null); setChosen(new Set())
    })
  }
  function edit(operation: string, hashes?: string[], newName?: string) {
    if (!view) return
    void task(async () => {
      const result = await api<View & { backup: string }>('/edit', { operation, name: detail?.name, newName, hashes, revision: view.revision, confirmedClosed: confirmed })
      setView(result)
      const target = operation === 'delete' ? null : operation === 'create' || operation === 'rename' ? newName! : detail?.name || null
      if (target) await loadCollection(target)
      else setDetail(null)
      setChosen(new Set()); setRemove(new Set()); setName('')
      setNotice(`${t('backupSaved')}: ${result.backup}`)
    })
  }
  function refresh() {
    void task(async () => {
      const result = await api<View>('/refresh', {})
      setView(result)
      if (detail) await loadCollection(detail.name)
    })
  }
  function toggle(value: string, setter: (update: (previous: Set<string>) => Set<string>) => void) {
    setter(previous => { const next = new Set(previous); if (next.has(value)) next.delete(value); else next.add(value); return next })
  }

  return <section className="stable-panel" aria-label={t('stableTitle')}>
    <div className="stable-heading"><div><span className="section-label">osu!stable</span><h2>{t('stableTitle')}</h2></div>{view && <button type="button" className="secondary-button" disabled={busy} onClick={refresh}><RefreshCcw size={15} />{t('stableRefresh')}</button>}</div>
    <p className="stable-hint">{t('stableIntro')}</p>
    <form className="stable-path" onSubmit={connect}><label htmlFor="stable-directory">{t('stableFolder')}</label><div><input id="stable-directory" required value={directory} onChange={event => setDirectory(event.target.value)} placeholder={t('stablePathPlaceholder')} />{window.paccDesktop && <button type="button" className="secondary-button" onClick={() => { void window.paccDesktop?.chooseDirectory().then(value => { if (value) setDirectory(value) }).catch(e => setError((e as Error).message)) }}><FolderOpen size={15} />{t('browse')}</button>}<button type="submit" className="primary-button" disabled={busy}>{view ? t('stableChange') : t('stableConnect')}</button></div></form>
    {busy && <div className="stable-message" role="status"><LoaderCircle size={16} className="spin" />{t('stableWorking')}</div>}
    {error && <div className="stable-message error" role="alert">{error}</div>}
    {notice && <div className="stable-message success" role="status"><Check size={15} />{notice}</div>}
    {view && <>
      <p className="stable-count">{view.collections.length} {t('stableCollections')} · {view.installedCount} {t('stableInstalled')}</p>
      <label className="stable-confirm"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />{t('stableClosed')}</label>
      <form className="stable-create" onSubmit={event => { event.preventDefault(); edit('create', undefined, name.trim()) }}><input aria-label={t('stableNewName')} required maxLength={100} placeholder={t('stableNewName')} value={name} onChange={event => setName(event.target.value)} /><button className="primary-button" disabled={!confirmed || busy} type="submit"><Plus size={15} />{t('stableCreate')}</button></form>
      <div className="stable-layout"><div className="stable-collection-list">{view.collections.length ? view.collections.map(collection => <button type="button" key={collection.name} className={detail?.name === collection.name ? 'active' : ''} onClick={() => void task(() => loadCollection(collection.name))}>{collection.name}<small>{collection.count}</small></button>) : <p>{t('stableNoCollections')}</p>}</div>
        {detail && <div className="stable-detail"><div className="stable-rename"><input aria-label={t('stableRename')} maxLength={100} value={rename} onChange={event => setRename(event.target.value)} /><button type="button" className="secondary-button" disabled={!confirmed || busy || !rename.trim() || rename === detail.name} onClick={() => edit('rename', undefined, rename.trim())}>{t('stableRename')}</button><button type="button" className="icon-button" title={t('stableDelete')} aria-label={t('stableDelete')} disabled={!confirmed || busy} onClick={() => { if (window.confirm(t('stableDeleteConfirm'))) edit('delete') }}><Trash2 size={15} /></button></div>
          <div className="stable-subheading"><strong>{t('stableMembers')} ({detail.maps.length})</strong><button type="button" disabled={!confirmed || busy || !remove.size} onClick={() => edit('remove', [...remove])}>{t('stableRemove')} ({remove.size})</button></div>
          <div className="stable-map-list">{detail.maps.length ? detail.maps.map(item => <label key={item.checksum} className="stable-map"><input type="checkbox" checked={remove.has(item.checksum)} onChange={() => toggle(item.checksum, setRemove)} /><span><strong>{item.installed ? `${item.installed.artist} – ${item.installed.title}` : t('stableMissing')}</strong><small>{item.installed?.version || item.checksum}</small></span></label>) : <p>{t('stableEmpty')}</p>}</div>
          <div className="stable-subheading"><strong>{t('stableAddMaps')}</strong></div>
          <form className="stable-search" onSubmit={event => { event.preventDefault(); void task(async () => { setLibrary(await api<MapInfo[]>(`/search?q=${encodeURIComponent(query)}`)) }) }}><input aria-label={t('stableSearch')} value={query} onChange={event => setQuery(event.target.value)} placeholder={t('stableSearch')} /><button type="submit" className="secondary-button" disabled={busy}><Search size={15} />{t('stableFind')}</button></form>
          <div className="stable-map-list">{library.map(map => <label className="stable-map" key={map.checksum}><input type="checkbox" checked={chosen.has(map.checksum)} onChange={() => toggle(map.checksum, setChosen)} /><span><strong>{map.artist} – {map.title}</strong><small>{map.version}{map.beatmapId ? ` · #${map.beatmapId}` : ''}</small></span></label>)}</div>
          <div className="stable-actions"><button className="primary-button" type="button" disabled={!confirmed || busy || !chosen.size} onClick={() => edit('add', [...chosen])}>{t('stableAddSelected')} ({chosen.size})</button><button className="secondary-button" type="button" disabled={!confirmed || busy || !sourceChecksums.length} onClick={() => edit('add', sourceChecksums)}>{t('stableAddPreview')} ({sourceChecksums.length})</button></div>
        </div>}
      </div>
      <p className="stable-warning">{t('stableWarning')}</p>
    </>}
  </section>
}
