import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { createRoot } from 'react-dom/client'
import { ArrowDownToLine, ArrowRight, Check, ChevronDown, CircleHelp, Clock3, ExternalLink, FolderOpen, Library, LoaderCircle, Pause, Play, RefreshCcw, Search, Settings2, Square, Trash2, X } from 'lucide-react'
import { copy, localizeError, type Language, type TranslationKey } from './i18n'
import { StablePanel } from './StablePanel'
import { UpdateChecker } from './UpdateChecker'
import { MapFiltersPanel } from './MapFiltersPanel'
import { emptyFilters, matchesMapFilters, type MapFilters } from './mapFilters'
import './styles.css'

declare global { interface Window { paccDesktop?: { chooseDirectory(): Promise<string | null> } } }

type Difficulty = { id: number; beatmapsetId: number | null; checksum: string | null; version: string; mode: string; stars: number | null; status: string; artist: string; title: string; creator: string; cover: string | null; bpm: number | null; length: number | null }
type Collection = { id: number; name: string; uploader: string; reportedCount: number; maps: Difficulty[]; fetchedAt: string }
type Item = { key: string; collectionId: number; collectionName: string; beatmapsetId: number; artist: string; title: string; difficultyIds: number[]; status: 'pending' | 'downloading' | 'done' | 'failed' | 'cancelled'; filename: string; filePath: string | null; bytes: number; total: number | null; error: string | null; attempts: number }
type TournamentEntry = { source: string; kind: 'beatmap' | 'beatmapset'; requestedId: number; beatmapsetId: number; difficultyId: number | null; checksum: string | null; version: string | null; stars: number | null; bpm?: number | null; setDifficulties?: { id: number; stars: number | null; bpm: number | null }[]; artist: string; title: string; creator: string; cover: string | null; status: string }
type TournamentManifest = { entries: TournamentEntry[]; failures: { source: string; reason: string }[]; fetchedAt: string }
type Theme = 'team' | 'light' | 'oled'
type State = { settings: { directory: string; mirror: 'direct' | 'catboy' }; collections: Collection[]; currentId: number | null; queue: Item[]; paused: boolean; tournament?: TournamentManifest; theme?: Theme }

async function api<T = unknown>(url: string, body?: object): Promise<T> {
  const response = await fetch(`/api/${url}`, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined)
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`)
  return data as T
}
function formatBytes(n: number) { return n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.round(n / 1024)} KB` }
function group(maps: Difficulty[]) {
  const result = new Map<string, Difficulty[]>()
  for (const map of maps) {
    const key = map.beatmapsetId ? `set-${map.beatmapsetId}` : `missing-${map.id}`
    result.set(key, [...(result.get(key) || []), map])
  }
  return [...result.values()]
}

function MapBackground({ src }: { src: string | null }) {
  const [broken, setBroken] = useState(false)
  useEffect(() => setBroken(false), [src])
  return <><div className="map-background" aria-hidden="true">{src && !broken && <img src={src} alt="" loading="lazy" onError={() => setBroken(true)} />}</div><div className="map-cover" aria-hidden="true">{src && !broken && <img src={src} alt="" loading="lazy" onError={() => setBroken(true)} />}</div></>
}

function App() {
  const [language, setLanguage] = useState<Language>(() => {
    const requested = new URLSearchParams(window.location.search).get('lang')
    if (requested === 'en' || requested === 'es') return requested
    try { const saved = localStorage.getItem('pacc-bd-language') || localStorage.getItem('panama-maps-language'); if (saved === 'en' || saved === 'es') return saved } catch { /* storage may be unavailable */ }
    return navigator.language.toLowerCase().startsWith('es') ? 'es' : 'en'
  })
  const t = (key: TranslationKey): string => copy[language][key]
  function changeLanguage(next: Language) {
    setLanguage(next)
    const url = new URL(window.location.href)
    if (url.searchParams.has('lang')) { url.searchParams.set('lang', next); window.history.replaceState(null, '', url) }
  }
  useEffect(() => {
    document.documentElement.lang = language
    try { localStorage.setItem('pacc-bd-language', language) } catch { /* optional preference */ }
  }, [language])

  const [state, setState] = useState<State | null>(null)
  const [input, setInput] = useState('')
  const [tournamentInput, setTournamentInput] = useState('')
  const [numberKind, setNumberKind] = useState<'beatmap' | 'beatmapset'>('beatmap')
  const [tournamentBusy, setTournamentBusy] = useState(false)
  const [selectedTournament, setSelectedTournament] = useState<Set<number>>(new Set())
  const [activeSection, setActiveSection] = useState<'collector' | 'tournament' | 'stable' | 'settings'>(() => { try { return localStorage.getItem('pacc-bd-section') === 'tournament' ? 'tournament' : 'collector' } catch { return 'collector' } })
  const [returnSection, setReturnSection] = useState<'collector' | 'tournament'>('collector')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [query, setQuery] = useState('')
  const [collectorFilters, setCollectorFilters] = useState<MapFilters>({ ...emptyFilters })
  const [tournamentFilters, setTournamentFilters] = useState<MapFilters>({ ...emptyFilters })
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [directory, setDirectory] = useState('')
  const [mirror, setMirror] = useState<'direct' | 'catboy'>('direct')
  const [theme, setTheme] = useState<Theme>(() => { try { const saved = localStorage.getItem('pacc-bd-theme'); return saved === 'light' || saved === 'oled' ? saved : 'team' } catch { return 'team' } })
  const [themeBusy, setThemeBusy] = useState(false)
  const [queueOpen, setQueueOpen] = useState(true)

  const refresh = async () => { const next = await api<State>('state'); setState(next); return next }
  useEffect(() => {
    void refresh().then(s => { setDirectory(s.settings.directory); setMirror(s.settings.mirror); if (s.theme === 'team' || s.theme === 'light' || s.theme === 'oled') setTheme(s.theme) }).catch(e => setError(e.message))
    const timer = window.setInterval(() => { void refresh().catch(() => {}) }, 1100)
    return () => window.clearInterval(timer)
  }, [])
  useEffect(() => { if (activeSection === 'collector' || activeSection === 'tournament') try { localStorage.setItem('pacc-bd-section', activeSection) } catch { /* optional preference */ } }, [activeSection])
  useEffect(() => { document.documentElement.dataset.theme = theme; try { localStorage.setItem('pacc-bd-theme', theme) } catch { /* optional preference */ } }, [theme])

  const live = state?.collections.find(c => c.id === state.currentId)
  const collection: Collection = live || { id: 0, name: t('collectorReady'), uploader: '', reportedCount: 0, maps: [], fetchedAt: '' }
  const isDemo = !live
  const groups = useMemo(() => group(collection.maps), [collection.maps])
  const visible = useMemo(() => groups.filter(maps => `${maps[0].artist} ${maps[0].title} ${maps[0].creator} ${maps.map(m => m.version).join(' ')}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())).map(maps => maps.filter(map => matchesMapFilters(map, collectorFilters))).filter(maps => maps.length), [groups, query, collectorFilters])
  const available = collection.maps.filter(m => m.beatmapsetId)
  const selectedSets = new Set(collection.maps.filter(m => selected.has(m.id) && m.beatmapsetId).map(m => m.beatmapsetId)).size
  const done = state?.queue.filter(i => i.status === 'done').length || 0
  const failed = state?.queue.filter(i => i.status === 'failed').length || 0
  const outstanding = state?.queue.filter(i => i.status === 'pending' || i.status === 'downloading').length || 0
  const already = (setId: number | null) => state?.queue.find(i => i.beatmapsetId === setId)
  const tournamentSets = useMemo(() => {
    const sets = new Map<number, TournamentEntry[]>()
    for (const entry of state?.tournament?.entries || []) sets.set(entry.beatmapsetId, [...(sets.get(entry.beatmapsetId) || []), entry])
    return [...sets]
  }, [state?.tournament])
  const visibleTournamentSets = useMemo(() => tournamentSets.map(([id, entries]) => [id, entries.filter(entry => matchesMapFilters(entry, tournamentFilters))] as const).filter(([, entries]) => entries.length), [tournamentSets, tournamentFilters])
  function openCollections(source: 'collector' | 'tournament') { setReturnSection(source); setActiveSection('stable') }
  function openSettings() { if (activeSection === 'collector' || activeSection === 'tournament') setReturnSection(activeSection); setActiveSection('settings') }
  async function changeTheme(next: Theme) {
    if (themeBusy) return
    const previous = theme
    setThemeBusy(true)
    setTheme(next); setError(''); setNotice('')
    try { await api('theme', { theme: next }) } catch (cause) { setTheme(previous); setError((cause as Error).message) }
    finally { setThemeBusy(false) }
  }

  async function action(route: string, body: object = {}) {
    setError(''); setNotice('')
    try {
      const result = await api<{ added?: number }>(route, body)
      await refresh()
      if (route === 'enqueue' || route === 'tournament/enqueue') setNotice(result.added ? `${t('added')} ${result.added} ${t('toQueue')}` : t('alreadyQueued'))
      if (route === 'queue/clear') setNotice(t('queueCleared'))
      if (route === 'settings') setNotice(t('settingsSaved'))
    } catch (e) { setError((e as Error).message) }
  }
  async function loadCollection(value: string) {
    setBusy(true); setError(''); setNotice('')
    try {
      const c = await api<Collection>('collection', { input: value })
      await refresh(); setSelected(new Set()); setQuery(''); setInput(''); setActiveSection('collector')
      setNotice(`${t('loaded')} ${c.maps.length} ${t('difficulties')} ${t('across')} ${group(c.maps).length} ${t('beatmapsets')}.`)
    } catch (e) { setError((e as Error).message) }
    finally { setBusy(false) }
  }
  async function loadTournament() {
    setTournamentBusy(true); setError(''); setNotice('')
    try {
      const result = await api<TournamentManifest>('tournament', { input: tournamentInput, numberKind })
      await refresh(); setSelectedTournament(new Set()); setTournamentInput(''); setActiveSection('tournament')
      setNotice(`${t('loaded')} ${result.entries.length} ${t('tournamentIds')}. ${result.failures.length} ${t('unresolved')}.`)
    } catch (e) { setError((e as Error).message) }
    finally { setTournamentBusy(false) }
  }
  function toggle(ids: number[]) {
    if (isDemo) return
    setSelected(previous => {
      const next = new Set(previous)
      const all = ids.every(id => next.has(id))
      for (const id of ids) all ? next.delete(id) : next.add(id)
      return next
    })
  }
  function mapStatus(item: Item | undefined, map: Difficulty) {
    if (item) return item.status === 'done' ? t('downloadedHere') : t(item.status)
    if (!map.beatmapsetId) return t('noSetId')
    if (language === 'es') return ({ ranked: 'CLASIFICADO', loved: 'POPULAR', pending: 'PENDIENTE', qualified: 'CALIFICADO', approved: 'APROBADO', graveyard: 'ARCHIVADO', sample: 'EJEMPLO' } as Record<string, string>)[map.status] || map.status.toUpperCase()
    return map.status.toUpperCase()
  }

  return <div className="app-shell">
    <header className="site-header"><div className="header-inner">
      <div className="brand"><div className="app-name">PACC<span>-BD</span><small>{t('tagline')}</small></div><nav className="section-switch" aria-label={t('mode')}><button type="button" className={activeSection === 'collector' ? 'current' : ''} aria-current={activeSection === 'collector' ? 'page' : undefined} onClick={() => { setActiveSection('collector'); setError(''); setNotice('') }}><span className="tab-full">{t('collectorTab')}</span><span className="tab-short">{t('collectorTabShort')}</span></button><button type="button" className={activeSection === 'tournament' ? 'current' : ''} aria-current={activeSection === 'tournament' ? 'page' : undefined} onClick={() => { setActiveSection('tournament'); setError(''); setNotice('') }}><span className="tab-full">{t('beatmapTab')}</span><span className="tab-short">{t('beatmapTabShort')}</span></button></nav></div>
      <div className="header-actions"><span className="local-indicator"><i />{t('local')}</span><UpdateChecker language={language} /><button type="button" className={`collections-nav ${activeSection === 'stable' ? 'current' : ''}`} aria-current={activeSection === 'stable' ? 'page' : undefined} onClick={() => activeSection === 'stable' ? setActiveSection(returnSection) : openCollections(activeSection === 'settings' ? returnSection : activeSection)}><Library size={15} />{t('collectionsNav')}</button><button type="button" className={`collections-nav settings-nav ${activeSection === 'settings' ? 'current' : ''}`} aria-current={activeSection === 'settings' ? 'page' : undefined} onClick={() => activeSection === 'settings' ? setActiveSection(returnSection) : openSettings()}><Settings2 size={15} />{t('settings')}</button><div className="language-switch" role="group" aria-label={t('language')}><button type="button" aria-pressed={language === 'en'} className={language === 'en' ? 'current' : ''} onClick={() => changeLanguage('en')}>EN</button><button type="button" aria-pressed={language === 'es'} className={language === 'es' ? 'current' : ''} onClick={() => changeLanguage('es')}>ES</button></div></div>
    </div></header>

    <main className="page">
      {activeSection === 'settings' ? <section className="settings-page" aria-label={t('settings')}><span className="section-label">PACC-BD</span><h1>{t('settings')}</h1>
        {error && <div className="alert error" role="alert">{localizeError(error, language)}</div>}
        {notice && <div className="alert success" role="status">{notice}</div>}
        <div className="settings-card"><h2>{t('themeTitle')}</h2><p>{t('themeHelp')}</p><div className="theme-options" role="group" aria-label={t('themeTitle')}>{(['team', 'light', 'oled'] as const).map(value => <button type="button" key={value} disabled={themeBusy} className={`theme-option ${value} ${theme === value ? 'selected' : ''}`} aria-pressed={theme === value} onClick={() => void changeTheme(value)}><span className="theme-swatch" aria-hidden="true"><i /><i /><i /></span><strong>{t(value === 'team' ? 'themeTeam' : value === 'light' ? 'themeLight' : 'themeOled')}</strong><small>{t(value === 'team' ? 'themeTeamHint' : value === 'light' ? 'themeLightHint' : 'themeOledHint')}</small></button>)}</div></div>
        <div className="settings-card"><h2>{t('directory')}</h2><p>{t('settingsDescription')}</p><form className="settings-form" onSubmit={(event: FormEvent) => { event.preventDefault(); void action('settings', { directory, mirror }) }}><label htmlFor="directory">{t('directoryAbsolute')}</label><input id="directory" required value={directory} onChange={e => setDirectory(e.target.value)} />{window.paccDesktop && <button className="secondary-button" type="button" onClick={() => { void window.paccDesktop?.chooseDirectory().then(value => { if (value) setDirectory(value) }).catch(e => setError((e as Error).message)) }}>{t('browse')}</button>}<label htmlFor="mirror">{t('mirror')}</label><select id="mirror" value={mirror} onChange={e => setMirror(e.target.value as 'direct' | 'catboy')}><option value="direct">{t('direct')}</option><option value="catboy">{t('catboy')}</option></select><button className="primary-button" type="submit">{t('saveSettings')}</button></form></div>
        <p className="installed-note">{t('installedNote')}</p>
      </section> : activeSection === 'stable' ? <StablePanel language={language} initialSource={returnSection} goToSource={setActiveSection} /> : <><section className="intro">
        <div className="page-heading"><img className="page-mark" src="/osu-logo.png" alt="" /><div><span className="eyebrow">{t('eyebrow')}</span><h1>PACC-BD</h1></div></div>
        <a className="team-cover" href="https://osu.ppy.sh/teams/15959" target="_blank" rel="noopener noreferrer" title={t('source')} aria-label={t('source')}><img src="/panama-accuracy-wordmark.png" alt="Panama Accuracy" /></a>
        <div className="intro-profile"><a className="team-avatar" href="https://osu.ppy.sh/teams/15959" target="_blank" rel="noopener noreferrer" title={t('source')} aria-label={t('source')}><img src="/panama-accuracy-flag.png" alt="" /></a><div className="intro-copy"><span className="eyebrow">{t('forTeam')}</span><h2>{t('heroOne')} {t('heroTwo')}</h2></div></div>
      </section>

      {activeSection === 'collector' ? <section className="import-section" aria-label={t('collectorSection')}>
        <h2 className="import-heading">{t('collectorSection')}</h2>
        <form className="import-form" onSubmit={(event: FormEvent) => { event.preventDefault(); void loadCollection(input) }}><label htmlFor="collection-input">{t('collectionInput')}</label><div className="input-line"><input id="collection-input" type="text" required autoComplete="off" placeholder={t('inputPlaceholder')} value={input} onChange={e => setInput(e.target.value)} /><button className="primary-button" type="submit" disabled={busy}>{busy ? <><LoaderCircle size={16} className="spin" />{t('fetching')}</> : <>{t('fetch')} <ArrowRight size={16} /></>}</button></div></form>
      </section> :

      <section className="tournament-input-panel" aria-label={t('tournamentSection')}>
        <h2 className="import-heading">{t('tournamentSection')}</h2><p>{t('tournamentHint')}</p>
        <form onSubmit={(event: FormEvent) => { event.preventDefault(); void loadTournament() }}>
          <label htmlFor="tournament-input">{t('tournamentInput')}</label>
          <textarea id="tournament-input" required maxLength={30000} value={tournamentInput} onChange={e => setTournamentInput(e.target.value)} placeholder={t('tournamentPlaceholder')} rows={4} />
          <div className="tournament-input-actions"><label htmlFor="number-kind">{t('numericIds')}</label><select id="number-kind" value={numberKind} onChange={e => setNumberKind(e.target.value as 'beatmap' | 'beatmapset')}><option value="beatmap">{t('beatmapId')}</option><option value="beatmapset">{t('beatmapsetId')}</option></select><button type="submit" className="primary-button" disabled={tournamentBusy}>{tournamentBusy ? <><LoaderCircle size={16} className="spin" />{t('resolving')}</> : <>{t('previewIds')} <ArrowRight size={16} /></>}</button></div>
        </form>
      </section>}

      {error && <div className="alert error" role="alert"><CircleHelp size={16} />{localizeError(error, language)}<button type="button" aria-label={t('dismissError')} onClick={() => setError('')}><X size={16} /></button></div>}
      {notice && <div className="alert success" role="status"><Check size={16} />{notice}<button type="button" aria-label={t('dismissNotice')} onClick={() => setNotice('')}><X size={16} /></button></div>}

      <div className="workspace">
        <div className="preview-panels">{activeSection === 'collector' ? <><section className="collection-panel" aria-label={t('collection')}>
           <div className="panel-head"><div><span className="section-label">{t('collection')}</span><h2>{collection.name}</h2>{!isDemo && <p>{t('by')} <strong>{collection.uploader}</strong> <span className="subtle-separator">·</span> Collector #{collection.id}</p>}</div>{!isDemo && <a className="collector-link" href={`https://osucollector.com/collections/${collection.id}`} target="_blank" rel="noopener noreferrer"><ExternalLink size={14} />{t('openCollector')}</a>}</div>
           {isDemo ? <div className="collector-empty">{t('collectorEmpty')}</div> : <>
           <div className="stats"><span><b>{collection.maps.length}</b>{t('difficulties')}</span><span><b>{groups.filter(g => g[0].beatmapsetId).length}</b>{t('beatmapsets')}</span><span><b>{isDemo ? '—' : selected.size}</b>{t('selected')}</span></div>
           <MapFiltersPanel language={language} maps={collection.maps} filters={collectorFilters} onChange={setCollectorFilters} id="collector-filters" />
           <div className="map-tools"><div className="search-box"><Search size={17} /><input aria-label={t('searchLabel')} value={query} onChange={e => setQuery(e.target.value)} placeholder={t('search')} /></div><span className="map-count">{visible.length} {t('results')}</span></div>
          <div className="selection-tools"><span>{selected.size} / {available.length} {t('selected')}</span><div><button type="button" disabled={isDemo} onClick={() => setSelected(previous => new Set([...previous, ...visible.flat().filter(m => m.beatmapsetId).map(m => m.id)]))}>{t('selectVisible')}</button><button type="button" disabled={isDemo || !selected.size} onClick={() => setSelected(new Set())}>{t('clear')}</button></div></div>

           <div className="map-list">{visible.length === 0 ? <div className="empty-list">{t('emptySearch')}</div> : visible.map(maps => { const map = maps[0]; const ids = maps.filter(m => m.beatmapsetId).map(m => m.id); const checked = ids.length > 0 && ids.every(id => selected.has(id)); const queued = already(map.beatmapsetId); return <article className={`map-row ${checked ? 'is-selected' : ''}`} key={map.beatmapsetId || `missing-${map.id}`}><MapBackground src={map.cover} /><label className="map-checkbox"><input type="checkbox" disabled={isDemo || !ids.length} checked={checked} onChange={() => toggle(ids)} aria-label={`${t('selectMap')} ${map.artist} - ${map.title}`} /><span /></label><div className="map-details"><div className="map-title-line"><div className="map-title"><strong>{map.title}</strong><small>{map.artist} <span>·</span> {t('mappedBy')} {map.creator}{map.bpm ? ` · ${Math.round(map.bpm)} BPM` : ''}</small></div><span className={`map-status ${queued?.status || ''}`}>{mapStatus(queued, map)}</span></div><div className="diff-list"><span className="diff-label">{t('diffLabel')}</span>{maps.map(diff => <button type="button" key={diff.id} title={`ID ${diff.id}${diff.checksum ? ` · MD5 ${diff.checksum}` : ''}`} disabled={isDemo || !diff.beatmapsetId} className={`diff-chip ${selected.has(diff.id) ? 'chosen' : ''}`} onClick={() => toggle([diff.id])}>{diff.version}{diff.stars !== null && <b>{diff.stars.toFixed(1)}★</b>}</button>)}</div></div></article> })}</div>
          <div className="osz-note"><CircleHelp size={16} />{t('oszNote')}</div>
           <div className="collection-actions"><span>{selectedSets} {t('chosenSets')} · {t('filterAllNote')}</span><div><button type="button" className="secondary-button" onClick={() => openCollections('collector')}><Library size={15} />{t('addToStable')}</button><button type="button" className="secondary-button" disabled={!available.length} onClick={() => void action('enqueue', { collectionId: collection.id, ids: available.map(m => m.id) })}>{t('downloadAll')}</button><button type="button" className="primary-button" disabled={!selected.size} onClick={() => void action('enqueue', { collectionId: collection.id, ids: [...selected] })}><ArrowDownToLine size={16} />{t('downloadSelected')}</button></div></div></>}
        </section>

        </> : <section className="tournament-panel" aria-label={t('tournamentSection')}><div className="panel-head"><div><span className="section-label">{t('tournamentSection')}</span><h2>{t('tournamentPreview')}</h2><p>{state?.tournament ? `${state.tournament.entries.length} ${t('tournamentIds')} · ${tournamentSets.length} ${t('beatmapsets')}` : t('tournamentEmpty')}</p></div></div>
           {tournamentSets.length > 0 && <><MapFiltersPanel language={language} maps={state?.tournament?.entries || []} filters={tournamentFilters} onChange={setTournamentFilters} id="tournament-filters" /><div className="selection-tools"><span>{selectedTournament.size} / {tournamentSets.length} {t('selected')} · {visibleTournamentSets.length} {t('results')}</span><div><button type="button" disabled={!visibleTournamentSets.length} onClick={() => setSelectedTournament(previous => new Set([...previous, ...visibleTournamentSets.map(([id]) => id)]))}>{t('selectVisible')}</button><button type="button" disabled={!selectedTournament.size} onClick={() => setSelectedTournament(new Set())}>{t('clear')}</button></div></div>
             <div className="map-list">{visibleTournamentSets.length ? visibleTournamentSets.map(([id, entries]) => { const entry = entries[0]; const checked = selectedTournament.has(id); const queued = already(id); return <article className={`map-row ${checked ? 'is-selected' : ''}`} key={id}><MapBackground src={entry.cover} /><label className="map-checkbox"><input type="checkbox" checked={checked} onChange={() => setSelectedTournament(previous => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next })} aria-label={`${t('selectMap')} ${entry.artist} - ${entry.title}`} /><span /></label><div className="map-details"><div className="map-title-line"><div className="map-title"><strong>{entry.title}</strong><small>{entry.artist} <span>·</span> {t('mappedBy')} {entry.creator}{entry.bpm ? ` · ${Math.round(entry.bpm)} BPM` : ''}</small></div><span className={`map-status ${queued?.status || ''}`}>{queued ? queued.status === 'done' ? t('downloadedHere') : t(queued.status) : entry.status.toUpperCase()}</span></div><div className="diff-list"><span className="diff-label">{t('beatmapsetId')} #{id}</span>{entries.map(e => <span className="diff-chip" key={`${e.kind}-${e.requestedId}`} title={e.checksum ? `MD5 ${e.checksum}` : undefined}>{e.difficultyId ? `${e.version || t('beatmapId')} #${e.difficultyId}` : `${t('beatmapsetId')} #${id}`}{e.stars !== null && <b>{e.stars.toFixed(1)}★</b>}</span>)}</div></div></article> }) : <div className="empty-list">{t('emptySearch')}</div>}</div>
             <div className="osz-note"><CircleHelp size={16} />{t('oszNote')}</div><div className="collection-actions"><span>{selectedTournament.size} {t('chosenSets')} · {t('filterAllNote')}</span><div><button type="button" className="secondary-button" onClick={() => openCollections('tournament')}><Library size={15} />{t('addToStable')}</button><button type="button" className="secondary-button" onClick={() => void action('tournament/enqueue', { ids: tournamentSets.map(([id]) => id) })}>{t('downloadAll')}</button><button type="button" className="primary-button" disabled={!selectedTournament.size} onClick={() => void action('tournament/enqueue', { ids: [...selectedTournament] })}><ArrowDownToLine size={16} />{t('downloadSelected')}</button></div></div></>}
          {!!state?.tournament?.failures.length && <div className="tournament-failures"><strong>{t('unresolved')} ({state.tournament.failures.length})</strong><ul>{state.tournament.failures.map((failure, i) => <li key={i}><code>{failure.source}</code> — {localizeError(failure.reason, language)}</li>)}</ul></div>}
        </section>}
        </div>

        <div className="side-panels"><section className="queue-panel" id="queue"><div className="side-heading"><div><span className="section-label">{t('queue')}</span><h2>{t('queue')} <small>{state?.queue.length || 0}</small></h2></div><button type="button" className="icon-button" aria-label={queueOpen ? t('collapse') : t('expand')} onClick={() => setQueueOpen(!queueOpen)}><ChevronDown size={17} className={queueOpen ? '' : 'rotate'} /></button></div>
          {queueOpen && <><div className="queue-progress"><div><span>{outstanding ? state?.paused ? t('paused') : t('inProgress') : failed ? t('attention') : state?.queue.length ? t('allDone') : t('ready')}</span><strong>{done} / {state?.queue.length || 0}</strong></div><div className="progress-track"><div style={{ width: `${state?.queue.length ? done / state.queue.length * 100 : 0}%` }} /></div><small>{done} {t('completed')} · {outstanding} {t('remaining')}</small></div>
          {state?.queue.length ? <div className="queue-list">{[...state.queue].reverse().map(item => <div className="queue-item" key={item.key}><span className={`queue-icon ${item.status}`}>{item.status === 'done' ? <Check size={15} /> : item.status === 'downloading' ? <ArrowDownToLine size={15} /> : item.status === 'failed' ? <X size={15} /> : item.status === 'cancelled' ? <Square size={12} /> : <Clock3 size={15} />}</span><div><strong>{item.title}</strong><small>{item.artist} · #{item.beatmapsetId}</small><span className={`queue-state ${item.status}`}>{item.status === 'downloading' ? item.error ? localizeError(item.error, language) : `${t('downloading')}${item.total ? ` · ${Math.min(100, Math.floor(item.bytes / item.total * 100))}%` : item.bytes ? ` · ${formatBytes(item.bytes)} (${t('sizeUnknown')})` : ` · ${t('preparing')}`}` : item.status === 'failed' ? `${t('failed')} · ${localizeError(item.error || '', language)}` : item.status === 'pending' ? item.error ? localizeError(item.error, language) : t('pending') : t(item.status)}</span>{item.status === 'downloading' && <div className={`item-progress ${item.total ? '' : 'indeterminate'}`}><div style={item.total ? { width: `${Math.min(100, item.bytes / item.total * 100)}%` } : undefined} /></div>}</div></div>)}</div> : <div className="empty-queue"><ArrowDownToLine size={22} /><strong>{t('queueEmpty')}</strong><p>{t('queueEmptyHelp')}</p></div>}
          <div className="queue-controls"><button type="button" disabled={!outstanding || !!state?.paused} onClick={() => void action('pause')}><Pause size={14} />{t('pause')}</button><button type="button" disabled={!state?.paused || !outstanding} onClick={() => void action('resume')}><Play size={14} />{t('resume')}</button><button type="button" disabled={!outstanding} onClick={() => void action('cancel')}><Square size={13} />{t('cancel')}</button></div>{failed > 0 && <button type="button" className="retry-button" onClick={() => void action('retry')}><RefreshCcw size={14} />{t('retry')} ({failed})</button>}{!!state?.queue.length && <button type="button" className="queue-clear" disabled={!!outstanding} title={outstanding ? t('queueClearBlocked') : undefined} onClick={() => { if (window.confirm(t('queueClearConfirm'))) void action('queue/clear') }}><Trash2 size={14} />{t('queueClear')}</button>}<p className="panel-hint">{t('pauseHint')}</p></>}
        </section>

        <section className="settings-panel" id="settings"><div className="side-heading"><div><span className="section-label">{t('settings')}</span><h2>{t('directory')}</h2></div><button type="button" className="icon-button" onClick={openSettings} aria-label={t('settings')}><Settings2 size={17} /></button></div><p className="settings-description">{t('settingsDescription')}</p><div className="folder-path"><FolderOpen size={17} /><span title={state?.settings.directory}>{state?.settings.directory || '...'}</span></div><button type="button" className="secondary-button settings-link" onClick={openSettings}>{t('openSettings')}</button>
        </section><p className="installed-note">{t('installedNote')}</p></div>
      </div>

      {activeSection === 'collector' && !!state?.collections.length && <section className="recent"><div className="recent-heading"><span className="section-label">{t('recent')}</span><button type="button" onClick={() => { if (window.confirm(t('clearRecentConfirm'))) { void action('collections/clear'); setSelected(new Set()); setQuery('') } }}>{t('clearRecent')}</button></div><div>{state.collections.map(c => <button type="button" key={c.id} className={c.id === collection.id ? 'current' : ''} onClick={() => { void action('show', { id: c.id }); setSelected(new Set()); setQuery(''); setActiveSection('collector') }}>{c.name} <small>#{c.id}</small></button>)}</div></section>}</>}
      <footer><span>PACC-BD</span><span>{t('independent')}</span></footer>
    </main>
  </div>
}

createRoot(document.getElementById('root')!).render(<App />)
