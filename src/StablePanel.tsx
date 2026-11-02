import { useEffect, useRef, useState, type DragEvent, type FormEvent } from 'react'
import { Check, FolderOpen, GripVertical, Library, LoaderCircle, Plus, RefreshCcw, Search, Trash2 } from 'lucide-react'
import { copy, localizeError, type Language, type TranslationKey } from './i18n'
import { MapFiltersPanel } from './MapFiltersPanel'
import { emptyFilters, matchesMapFilters, type MapFilters } from './mapFilters'

type Source = 'collector' | 'tournament'
type MapInfo = { checksum: string; artist: string; title: string; creator: string; version: string; beatmapId: number | null; beatmapsetId: number | null; stars: number | null; bpm: number | null }
type View = { directory: string; revision: string; installedCount: number; collections: { name: string; count: number }[] }
type Detail = { name: string; revision: string; maps: { checksum: string; installed: MapInfo | null }[] }
type PreviewMap = { key: string; artist: string; title: string; version: string | null; beatmapId: number | null; beatmapsetId: number | null; stars: number | null; bpm: number | null; installed: MapInfo | null }
type Preview = { source: Source; name: string | null; total: number; maps: PreviewMap[] }
function Artwork({ setId }: { setId: number | null }) {
  return <span className="stable-artwork" aria-hidden="true">{setId && Number.isSafeInteger(setId) && setId > 0 && <img src={`https://assets.ppy.sh/beatmaps/${setId}/covers/card.jpg`} alt="" loading="lazy" onError={event => { event.currentTarget.style.display = 'none' }} />}</span>
}
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
  const [previewFilters, setPreviewFilters] = useState<MapFilters>({ ...emptyFilters })
  const [libraryFilters, setLibraryFilters] = useState<MapFilters>({ ...emptyFilters })
  const [memberFilters, setMemberFilters] = useState<MapFilters>({ ...emptyFilters })
  const [library, setLibrary] = useState<MapInfo[]>([])
  const [query, setQuery] = useState('')
  const [searched, setSearched] = useState(false)
  const [name, setName] = useState('')
  const [rename, setRename] = useState('')
  const [remove, setRemove] = useState<Set<string>>(new Set())
  const dragged = useRef<string | null>(null)
  const searchSeq = useRef(0)
  const [dragActive, setDragActive] = useState(false)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
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
    setPreview(null)
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
    searchSeq.current++
    const next = await api<View>('/connect', { directory: selected })
    setView(next); setDirectory(next.directory); setDetail(null); setLibrary([]); setSearched(false); setConfirmed(false)
    if (next.collections.length) await openCollection(next.collections[0].name)
  }
  function connect(event: FormEvent) { event.preventDefault(); void task(() => openLibrary(directory)) }
  function browse() {
    void window.paccDesktop?.chooseDirectory().then(value => { if (value) void task(() => openLibrary(value)) }).catch(cause => setError((cause as Error).message))
  }
  function edit(operation: string, hashes?: string[], newName?: string, targetName?: string) {
    if (!view) return
    void task(async () => {
      const result = await api<View & { backup: string }>('/edit', { operation, name: targetName || detail?.name, newName, hashes, revision: view.revision, confirmedClosed: confirmed })
      setView(result)
      const target = operation === 'delete' ? null : operation === 'create' || operation === 'rename' ? newName! : targetName || detail?.name || null
      if (target) await openCollection(target)
      else setDetail(null)
      setRemove(new Set()); setName('')
      setNotice(`${t('backupSaved')}: ${result.backup}`)
    })
  }
  function refresh() {
    searchSeq.current++
    void task(async () => {
      const result = await api<View>('/refresh', {})
      setView(result)
      if (detail) await openCollection(detail.name)
      setPreview(await api<Preview>(`/preview?source=${source}`))
      setSearched(false); setLibrary([])
    })
  }
  function toggleRemove(value: string) {
    setRemove(previous => { const next = new Set(previous); if (next.has(value)) next.delete(value); else next.add(value); return next })
  }
  function startDrag(event: DragEvent<HTMLElement>, hash: string) {
    if (!confirmed || busy || !view?.collections.length) { event.preventDefault(); return }
    dragged.current = hash
    event.dataTransfer.effectAllowed = 'copy'
    event.dataTransfer.setData('text/plain', 'PACC-BD map')
    setDragActive(true)
  }
  function endDrag() { dragged.current = null; setDragActive(false); setDropTarget(null) }
  function drop(event: DragEvent<HTMLElement>, target: string) {
    if (!dragged.current || !confirmed || busy || !view?.collections.some(collection => collection.name === target)) return
    event.preventDefault()
    const hash = dragged.current
    endDrag()
    edit('add', [hash], undefined, target)
  }
  function searchMaps(filters = libraryFilters) {
    const params = new URLSearchParams({ q: query, includeUnknown: String(filters.includeUnknown) })
    for (const key of ['starsMin', 'starsMax', 'bpmMin', 'bpmMax'] as const) if (filters[key] !== null) params.set(key, String(filters[key]))
    return api<MapInfo[]>(`/search?${params.toString()}`)
  }
  async function updateSearch(filters = libraryFilters) {
    const request = ++searchSeq.current
    const result = await searchMaps(filters)
    if (request === searchSeq.current) setLibrary(result)
  }
  useEffect(() => {
    if (!searched || !view) return
    searchSeq.current++
    const timer = window.setTimeout(() => { void updateSearch(libraryFilters).catch(cause => setError(localizeError((cause as Error).message, language))) }, 220)
    return () => window.clearTimeout(timer)
  }, [libraryFilters])

  const visible = (preview?.maps || []).filter(map => `${map.artist} ${map.title} ${map.version || ''} ${map.beatmapId || ''} ${map.beatmapsetId || ''}`.toLocaleLowerCase().includes(previewQuery.toLocaleLowerCase()) && matchesMapFilters(map, previewFilters))
  const display = visible.slice(0, 120)
  const libraryVisible = library.filter(map => matchesMapFilters(map, libraryFilters))
  const membersVisible = (detail?.maps || []).filter(item => matchesMapFilters(item.installed || { stars: null, bpm: null }, memberFilters))
  const addButton = (hash: string) => <button type="button" className="stable-card-add" disabled={!detail || !confirmed || busy} onClick={() => edit('add', [hash])}><Plus size={13} />{t('stableAddOne')}</button>
  const stats = (stars: number | null, bpm: number | null) => <span className="stable-card-stats">{stars !== null ? `${stars.toFixed(1)}★` : `★ ${t('stableUnknownStat')}`} · {bpm !== null ? `${Math.round(bpm)} BPM` : `BPM ${t('stableUnknownStat')}`}</span>

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
      <div className={`stable-layout ${dragActive ? 'drag-active' : ''}`}><div className="stable-collection-list" aria-label={t('stableStepCollection')}>{view.collections.length ? view.collections.map(collection => <button type="button" key={collection.name} className={`${detail?.name === collection.name ? 'active' : ''} ${dropTarget === collection.name ? 'drop-target' : ''}`} onClick={() => void task(() => openCollection(collection.name))} onDragOver={event => { if (dragged.current && confirmed && !busy) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; setDropTarget(collection.name) } }} onDrop={event => drop(event, collection.name)} title={dragActive ? t('stableDropHint') : undefined}>{collection.name}<small>{collection.count}</small></button>) : <p>{t('stableNoCollections')}</p>}</div>
        <div className="stable-detail">{detail ? <><div className="stable-rename"><input aria-label={t('stableRename')} maxLength={100} value={rename} onChange={event => setRename(event.target.value)} /><button type="button" className="secondary-button" disabled={!confirmed || busy || !rename.trim() || rename === detail.name} onClick={() => edit('rename', undefined, rename.trim())}>{t('stableRename')}</button><button type="button" className="icon-button" title={t('stableDelete')} aria-label={t('stableDelete')} disabled={!confirmed || busy} onClick={() => { if (window.confirm(t('stableDeleteConfirm'))) edit('delete') }}><Trash2 size={15} /></button></div>
           <div className="stable-subheading"><strong>{t('stableMembers')} ({detail.maps.length})</strong><button type="button" disabled={!confirmed || busy || !remove.size} onClick={() => edit('remove', [...remove])}>{t('stableRemove')} ({remove.size})</button></div>
           {!!detail.maps.length && <MapFiltersPanel language={language} maps={detail.maps.map(item => item.installed || { stars: null, bpm: null })} filters={memberFilters} onChange={setMemberFilters} id="member-filters" />}
           <div className="stable-map-list stable-art-list">{detail.maps.length ? membersVisible.length ? membersVisible.map(item => <label key={item.checksum} className="stable-map stable-art-card"><Artwork setId={item.installed?.beatmapsetId || null} /><input type="checkbox" checked={remove.has(item.checksum)} onChange={() => toggleRemove(item.checksum)} aria-label={`${t('stableRemove')} ${item.installed?.title || item.checksum}`} /><span><strong>{item.installed ? `${item.installed.artist} – ${item.installed.title}` : t('stableMissing')}</strong><small>{item.installed?.version || item.checksum}</small>{item.installed && stats(item.installed.stars, item.installed.bpm)}</span></label>) : <p>{t('stableNoMatches')}</p> : <p>{t('stableEmpty')}</p>}</div>
        </> : <p className="stable-hint">{t('stableSelectCollection')}</p>}</div>
      </div>
      <div className="stable-add-card"><div className="stable-step"><span>3</span><div><strong>{t('stableStepMaps')}</strong><p>{t('stableImportHelp')}</p></div></div><p className="stable-drag-help"><GripVertical size={16} />{t('stableDragHelp')}</p>
        {detail && <div className={`stable-drop-zone ${dragActive ? 'ready' : ''} ${dropTarget === detail.name ? 'drop-target' : ''}`} onDragOver={event => { if (dragged.current && confirmed && !busy) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; setDropTarget(detail.name) } }} onDrop={event => drop(event, detail.name)}><Library size={17} /><span>{t('stableDropHint')} <strong>{detail.name}</strong></span></div>}
        {view.collections.length > 1 && <div className="stable-drop-targets" aria-label={t('stableStepCollection')}>{view.collections.filter(collection => collection.name !== detail?.name).map(collection => <button type="button" key={collection.name} className={dropTarget === collection.name ? 'drop-target' : ''} onClick={() => void task(() => openCollection(collection.name))} onDragOver={event => { if (dragged.current && confirmed && !busy) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; setDropTarget(collection.name) } }} onDrop={event => drop(event, collection.name)}>{collection.name}</button>)}</div>}
        <div className="stable-source-tabs" role="group" aria-label={t('stableSource')}><button type="button" className={source === 'collector' ? 'active' : ''} aria-pressed={source === 'collector'} onClick={() => { setSource('collector'); setPreviewQuery('') }}>{t('collectorTabShort')}</button><button type="button" className={source === 'tournament' ? 'active' : ''} aria-pressed={source === 'tournament'} onClick={() => { setSource('tournament'); setPreviewQuery('') }}>{t('beatmapTabShort')}</button></div>
        <div className="stable-preview-heading"><strong>{source === 'collector' ? preview?.name || t('collectorTabShort') : t('beatmapTabShort')}</strong><span>{preview?.total || 0} {t('difficulties')}</span></div>
         {preview?.total ? <><div className="stable-search"><input aria-label={t('stablePreviewSearch')} value={previewQuery} onChange={event => setPreviewQuery(event.target.value)} placeholder={t('stablePreviewSearch')} /><button type="button" className="secondary-button" onClick={refresh} disabled={busy}><RefreshCcw size={15} />{t('stableRefresh')}</button></div>
           <MapFiltersPanel language={language} maps={preview.maps} filters={previewFilters} onChange={setPreviewFilters} id="preview-filters" />
           <div className="stable-map-list stable-preview-list stable-art-list">{display.length ? display.map(map => <div key={map.key} className={`stable-map stable-art-card stable-preview-map ${map.installed ? 'can-drag' : 'unavailable'} ${dragActive && dragged.current === map.installed?.checksum ? 'is-dragging' : ''}`} draggable={!!map.installed && !!confirmed && !busy && !!view.collections.length} onDragStart={event => map.installed && startDrag(event, map.installed.checksum)} onDragEnd={endDrag}><Artwork setId={map.beatmapsetId} /><span><strong>{map.artist} – {map.title}</strong><small>{map.version || (map.beatmapsetId ? `${t('beatmapsetId')} #${map.beatmapsetId}` : '')}{map.beatmapId ? ` · #${map.beatmapId}` : ''}</small>{stats(map.stars, map.bpm)}</span><em className={map.installed ? 'installed' : 'missing'}>{map.installed ? t('stableReadyToAdd') : t('stableImportFirst')}</em>{map.installed && <>{addButton(map.installed.checksum)}<GripVertical className="stable-grip" size={17} aria-hidden="true" /></>}</div>) : <p>{t('stableNoMatches')}</p>}</div>
          {visible.length > display.length && <p className="stable-hint">{t('stableLimitList')} ({display.length}/{visible.length})</p>}
          {preview.total > preview.maps.length && <p className="stable-hint">{t('stablePreviewLimit')} ({preview.maps.length}/{preview.total})</p>}
           <div className="stable-actions"><button type="button" className="primary-button" disabled={!detail || !confirmed || busy || !display.some(map => map.installed)} onClick={() => edit('add', [...new Set(display.flatMap(map => map.installed ? [map.installed.checksum] : []))])}><Library size={15} />{t('stableAddVisible')} ({display.filter(map => map.installed).length})</button></div>
        </> : <div className="stable-preview-empty"><p>{t('stableNoPreview')}</p><button type="button" className="secondary-button" onClick={() => goToSource(source)}>{t('stableOpenDownloader')}</button></div>}
        <div className="stable-subheading"><strong>{t('stableAddMaps')}</strong></div>
        <p className="stable-hint">{t('stableLibraryHelp')}</p>
         <form className="stable-search" onSubmit={event => { event.preventDefault(); setSearched(true); void task(() => updateSearch()) }}><input aria-label={t('stableSearch')} value={query} onChange={event => setQuery(event.target.value)} placeholder={t('stableSearch')} /><button type="submit" className="secondary-button" disabled={busy}><Search size={15} />{t('stableFind')}</button></form>
         <MapFiltersPanel language={language} maps={library} filters={libraryFilters} onChange={setLibraryFilters} id="library-filters" />
         {searched && <><div className="stable-map-list stable-art-list">{libraryVisible.length ? libraryVisible.map(map => <div className={`stable-map stable-art-card can-drag ${dragActive && dragged.current === map.checksum ? 'is-dragging' : ''}`} key={map.checksum} draggable={!!confirmed && !busy && !!view.collections.length} onDragStart={event => startDrag(event, map.checksum)} onDragEnd={endDrag}><Artwork setId={map.beatmapsetId} /><span><strong>{map.artist} – {map.title}</strong><small>{map.version}{map.beatmapId ? ` · #${map.beatmapId}` : ''}</small>{stats(map.stars, map.bpm)}</span>{addButton(map.checksum)}<GripVertical className="stable-grip" size={17} aria-hidden="true" /></div>) : <p>{t('stableNoMatches')}</p>}</div><div className="stable-actions"><button className="primary-button" type="button" disabled={!detail || !confirmed || busy || !libraryVisible.length} onClick={() => edit('add', libraryVisible.map(map => map.checksum))}>{t('stableAddVisible')} ({libraryVisible.length})</button></div></>}
      </div>
      <p className="stable-warning">{t('stableWarning')}</p>
    </>}
  </section>
}
