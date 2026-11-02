import { useEffect, useState, type FormEvent } from 'react'
import { Check, FolderOpen, Library, LoaderCircle, Plus, RefreshCcw, Search, Trash2 } from 'lucide-react'
import { copy, localizeError, type Language, type TranslationKey } from './i18n'

type Source = 'collector' | 'tournament'
type MapInfo = { checksum: string; artist: string; title: string; creator: string; version: string; beatmapId: number | null; beatmapsetId: number | null }
type View = { directory: string; revision: string; installedCount: number; collections: { name: string; count: number }[] }
type Detail = { name: string; revision: string; maps: { checksum: string; installed: MapInfo | null }[] }
type Preview = { source: Source; name: string | null; total: number; maps: { key: string; artist: string; title: string; version: string | null; beatmapId: number | null; beatmapsetId: number | null; installed: MapInfo | null }[] }
async function api<T>(url: string, body?: object): Promise<T> {
  const response = await fetch(`/api/stable${url}`, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined)
  const result = await response.json()
  if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`)
  return result as T
}

export function StablePanel({ language, initialSource, goToSource }: { language: Language; initialSource: Source; goToSource: (source: Source) => void }) {
  const t = (key: TranslationKey): string => copy[language][key]
  const [directory, setDirectory] = useState('')
  const [view, setView] = useState<View | null>(null)
  const [detail, setDetail] = useState<Detail | null>(null)
  const [source, setSource] = useState<Source>(initialSource)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [previewQuery, setPreviewQuery] = useState('')
  const [selectedPreview, setSelectedPreview] = useState<Set<string>>(new Set())
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
    let active = true
    void api<View>('').then(async result => {
      if (!active) return
      setView(result); setDirectory(result.directory)
      if (result.collections.length) await openCollection(result.collections[0].name)
    }).catch(() => { /* No library connected yet: show the folder setup step. */ })
    return () => { active = false }
  }, [])
  useEffect(() => {
    if (!view) return
    let active = true
    setSelectedPreview(new Set()); setPreview(null)
    void api<Preview>(`/preview?source=${source}`).then(result => { if (active) setPreview(result) }).catch(cause => { if (active) setError(localizeError((cause as Error).message, language)) })
    return () => { active = false }
  }, [view?.directory, source])

  async function openCollection(collection: string) {
    const result = await api<Detail>(`/collection?name=${encodeURIComponent(collection)}`)
    setDetail(result); setRename(result.name); setRemove(new Set())
  }
  async function task(work: () => Promise<void>) {
    setBusy(true); setError(''); setNotice('')
    try { await work() } catch (cause) { setError(localizeError((cause as Error).message, language)) }
    finally { setBusy(false) }
  }
  async function openLibrary(selected: string) {
    const next = await api<View>('/connect', { directory: selected })
    setView(next); setDirectory(next.directory); setDetail(null); setChosen(new Set()); setLibrary([]); setConfirmed(false)
    if (next.collections.length) await openCollection(next.collections[0].name)
  }
  function connect(event: FormEvent) { event.preventDefault(); void task(() => openLibrary(directory)) }
  function browse() {
    void window.paccDesktop?.chooseDirectory().then(value => { if (value) void task(() => openLibrary(value)) }).catch(cause => setError((cause as Error).message))
  }
  function edit(operation: string, hashes?: string[], newName?: string) {
    if (!view) return
    void task(async () => {
      const result = await api<View & { backup: string }>('/edit', { operation, name: detail?.name, newName, hashes, revision: view.revision, confirmedClosed: confirmed })
      setView(result)
      const target = operation === 'delete' ? null : operation === 'create' || operation === 'rename' ? newName! : detail?.name || null
      if (target) await openCollection(target)
      else setDetail(null)
      setChosen(new Set()); setSelectedPreview(new Set()); setRemove(new Set()); setName('')
      setNotice(`${t('backupSaved')}: ${result.backup}`)
    })
  }
  function refresh() {
    void task(async () => {
      const result = await api<View>('/refresh', {})
      setView(result)
      if (detail) await openCollection(detail.name)
      setPreview(await api<Preview>(`/preview?source=${source}`))
      setSelectedPreview(new Set()); setChosen(new Set())
    })
  }
  function toggle(value: string, setter: (update: (previous: Set<string>) => Set<string>) => void) {
    setter(previous => { const next = new Set(previous); if (next.has(value)) next.delete(value); else next.add(value); return next })
  }

  const visible = (preview?.maps || []).filter(map => `${map.artist} ${map.title} ${map.version || ''} ${map.beatmapId || ''} ${map.beatmapsetId || ''}`.toLocaleLowerCase().includes(previewQuery.toLocaleLowerCase()))
  const display = visible.slice(0, 120)
  const hashes = (preview?.maps || []).filter(map => selectedPreview.has(map.key) && map.installed).map(map => map.installed!.checksum)

  return <section className="stable-panel stable-page" aria-label={t('stableTitle')}>
    <div className="stable-heading"><div><span className="section-label">osu!stable</span><h2>{t('stableTitle')}</h2><p className="stable-hint">{t('stableIntro')}</p></div>{view && <button type="button" className="secondary-button" disabled={busy} onClick={refresh}><RefreshCcw size={15} />{t('stableRefresh')}</button>}</div>
    <div className={`stable-setup ${view ? 'connected' : ''}`}><div className="stable-step"><span>1</span><div><strong>{t('stableStepFolder')}</strong><p>{t('stableFolderHelp')}</p></div></div>
      <form className="stable-path" onSubmit={connect}><label htmlFor="stable-directory">{t('stableFolder')}</label><div><input id="stable-directory" required value={directory} onChange={event => setDirectory(event.target.value)} placeholder={t('stablePathPlaceholder')} />{window.paccDesktop && <button type="button" className="secondary-button" onClick={browse}><FolderOpen size={15} />{t('browse')}</button>}<button type="submit" className="primary-button" disabled={busy}>{view ? t('stableChange') : t('stableConnect')}</button></div></form>
      {view && <p className="stable-connected"><Check size={15} />{t('stableConnected')} · {view.installedCount} {t('stableInstalled')}</p>}
    </div>
    {busy && <div className="stable-message" role="status"><LoaderCircle size={16} className="spin" />{t('stableWorking')}</div>}
    {error && <div className="stable-message error" role="alert">{error}</div>}
    {notice && <div className="stable-message success" role="status"><Check size={15} />{notice}</div>}
    {view && <>
      <div className="stable-step stable-step-two"><span>2</span><div><strong>{t('stableStepCollection')}</strong><p>{t('stableChooseHelp')}</p></div></div>
      <label className="stable-confirm"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />{t('stableClosed')}</label>
      <form className="stable-create" onSubmit={event => { event.preventDefault(); edit('create', undefined, name.trim()) }}><input aria-label={t('stableNewName')} required maxLength={100} placeholder={t('stableNewName')} value={name} onChange={event => setName(event.target.value)} /><button className="primary-button" disabled={!confirmed || busy} type="submit"><Plus size={15} />{t('stableCreate')}</button></form>
      <div className="stable-layout"><div className="stable-collection-list">{view.collections.length ? view.collections.map(collection => <button type="button" key={collection.name} className={detail?.name === collection.name ? 'active' : ''} onClick={() => void task(() => openCollection(collection.name))}>{collection.name}<small>{collection.count}</small></button>) : <p>{t('stableNoCollections')}</p>}</div>
        <div className="stable-detail">{detail ? <><div className="stable-rename"><input aria-label={t('stableRename')} maxLength={100} value={rename} onChange={event => setRename(event.target.value)} /><button type="button" className="secondary-button" disabled={!confirmed || busy || !rename.trim() || rename === detail.name} onClick={() => edit('rename', undefined, rename.trim())}>{t('stableRename')}</button><button type="button" className="icon-button" title={t('stableDelete')} aria-label={t('stableDelete')} disabled={!confirmed || busy} onClick={() => { if (window.confirm(t('stableDeleteConfirm'))) edit('delete') }}><Trash2 size={15} /></button></div>
          <div className="stable-subheading"><strong>{t('stableMembers')} ({detail.maps.length})</strong><button type="button" disabled={!confirmed || busy || !remove.size} onClick={() => edit('remove', [...remove])}>{t('stableRemove')} ({remove.size})</button></div>
          <div className="stable-map-list">{detail.maps.length ? detail.maps.map(item => <label key={item.checksum} className="stable-map"><input type="checkbox" checked={remove.has(item.checksum)} onChange={() => toggle(item.checksum, setRemove)} /><span><strong>{item.installed ? `${item.installed.artist} – ${item.installed.title}` : t('stableMissing')}</strong><small>{item.installed?.version || item.checksum}</small></span></label>) : <p>{t('stableEmpty')}</p>}</div>
        </> : <p className="stable-hint">{t('stableSelectCollection')}</p>}</div>
      </div>
      <div className="stable-add-card"><div className="stable-step"><span>3</span><div><strong>{t('stableStepMaps')}</strong><p>{t('stableImportHelp')}</p></div></div>
        <div className="stable-source-tabs" role="group" aria-label={t('stableSource')}><button type="button" className={source === 'collector' ? 'active' : ''} aria-pressed={source === 'collector'} onClick={() => { setSource('collector'); setPreviewQuery('') }}>{t('collectorTabShort')}</button><button type="button" className={source === 'tournament' ? 'active' : ''} aria-pressed={source === 'tournament'} onClick={() => { setSource('tournament'); setPreviewQuery('') }}>{t('beatmapTabShort')}</button></div>
        <div className="stable-preview-heading"><strong>{source === 'collector' ? preview?.name || t('collectorTabShort') : t('beatmapTabShort')}</strong><span>{preview?.total || 0} {t('difficulties')}</span></div>
        {preview?.total ? <><div className="stable-search"><input aria-label={t('stablePreviewSearch')} value={previewQuery} onChange={event => setPreviewQuery(event.target.value)} placeholder={t('stablePreviewSearch')} /><button type="button" className="secondary-button" onClick={refresh} disabled={busy}><RefreshCcw size={15} />{t('stableRefresh')}</button></div>
          <div className="stable-map-list stable-preview-list">{display.map(map => <label key={map.key} className={`stable-map stable-preview-map ${map.installed ? '' : 'unavailable'}`}><input type="checkbox" disabled={!map.installed} checked={selectedPreview.has(map.key)} onChange={() => toggle(map.key, setSelectedPreview)} /><span><strong>{map.artist} – {map.title}</strong><small>{map.version || (map.beatmapsetId ? `${t('beatmapsetId')} #${map.beatmapsetId}` : '')}{map.beatmapId ? ` · #${map.beatmapId}` : ''}</small></span><em className={map.installed ? 'installed' : 'missing'}>{map.installed ? t('stableReadyToAdd') : t('stableImportFirst')}</em></label>)}</div>
          {visible.length > display.length && <p className="stable-hint">{t('stableLimitList')} ({display.length}/{visible.length})</p>}
          {preview.total > preview.maps.length && <p className="stable-hint">{t('stablePreviewLimit')} ({preview.maps.length}/{preview.total})</p>}
          <div className="stable-actions"><button type="button" className="secondary-button" onClick={() => setSelectedPreview(previous => new Set([...previous, ...display.filter(map => map.installed).map(map => map.key)]))}>{t('selectVisible')}</button><button type="button" className="primary-button" disabled={!detail || !confirmed || busy || !hashes.length} onClick={() => edit('add', hashes)}><Library size={15} />{t('stableAddPreview')} ({hashes.length})</button></div>
        </> : <div className="stable-preview-empty"><p>{t('stableNoPreview')}</p><button type="button" className="secondary-button" onClick={() => goToSource(source)}>{t('stableOpenDownloader')}</button></div>}
        <div className="stable-subheading"><strong>{t('stableAddMaps')}</strong></div>
        <p className="stable-hint">{t('stableLibraryHelp')}</p>
        <form className="stable-search" onSubmit={event => { event.preventDefault(); void task(async () => { setLibrary(await api<MapInfo[]>(`/search?q=${encodeURIComponent(query)}`)) }) }}><input aria-label={t('stableSearch')} value={query} onChange={event => setQuery(event.target.value)} placeholder={t('stableSearch')} /><button type="submit" className="secondary-button" disabled={busy}><Search size={15} />{t('stableFind')}</button></form>
        {!!library.length && <><div className="stable-map-list">{library.map(map => <label className="stable-map" key={map.checksum}><input type="checkbox" checked={chosen.has(map.checksum)} onChange={() => toggle(map.checksum, setChosen)} /><span><strong>{map.artist} – {map.title}</strong><small>{map.version}{map.beatmapId ? ` · #${map.beatmapId}` : ''}</small></span></label>)}</div><div className="stable-actions"><button className="primary-button" type="button" disabled={!detail || !confirmed || busy || !chosen.size} onClick={() => edit('add', [...chosen])}>{t('stableAddSelected')} ({chosen.size})</button></div></>}
      </div>
      <p className="stable-warning">{t('stableWarning')}</p>
    </>}
  </section>
}
