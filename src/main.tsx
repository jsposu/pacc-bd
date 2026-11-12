import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { createRoot } from 'react-dom/client'
import { ArrowDownToLine, ArrowRight, Check, ChevronDown, CircleHelp, ExternalLink, FolderOpen, Grid2X2, List, LoaderCircle, Search, Settings2, X } from 'lucide-react'
import { copy, localizeError, type Language, type TranslationKey } from './i18n'
import { StablePanel } from './StablePanel'
import { UpdateChecker } from './UpdateChecker'
import { MapFiltersPanel } from './MapFiltersPanel'
import { BeatmapCard } from './BeatmapCard'
import { DownloadQueue } from './DownloadQueue'
import { HeaderBackdrop } from './HeaderBackdrop'
import { sortMapGroups, type SortOrder } from './listing'
import { ZoomSettings } from './ZoomSettings'
import { emptyFilters, matchesMapFilters, type MapFilters } from './mapFilters'
import type { Collection, Difficulty, TournamentEntry, TournamentManifest } from '../server/types'
import './styles.css'
import './listing.css'

declare global { interface Window { paccDesktop?: { chooseDirectory(): Promise<string | null>; getZoom(): Promise<number>; setZoom(value: number): Promise<number> } } }

type Item = { key: string; collectionId: number; collectionName: string; beatmapsetId: number; artist: string; title: string; difficultyIds: number[]; status: 'pending' | 'downloading' | 'done' | 'failed' | 'cancelled'; filename: string; filePath: string | null; bytes: number; total: number | null; error: string | null; attempts: number }
type Theme = 'team' | 'light' | 'oled'
type State = { settings: { directory: string; mirror: 'direct' | 'catboy' }; collections: Collection[]; currentId: number | null; queue: Item[]; paused: boolean; tournament?: TournamentManifest; theme?: Theme }

async function api<T = unknown>(url: string, body?: object): Promise<T> {
  const response = await fetch(`/api/${url}`, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined)
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`)
  return data as T
}
function group(maps: Difficulty[]) {
  const result = new Map<string, Difficulty[]>()
  for (const map of maps) {
    const key = map.beatmapsetId ? `set-${map.beatmapsetId}` : `missing-${map.id}`
    result.set(key, [...(result.get(key) || []), map])
  }
  return [...result.values()]
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
  const [theme, setTheme] = useState<Theme>(() => { try { return localStorage.getItem('pacc-bd-theme') === 'light' ? 'light' : 'oled' } catch { return 'oled' } })
  const [themeBusy, setThemeBusy] = useState(false)
  const [sort, setSort] = useState<SortOrder>('original')
  const [view, setView] = useState<'grid' | 'list'>('grid')

  const refresh = async () => { const next = await api<State>('state'); setState(next); return next }
  useEffect(() => {
    void refresh().then(s => { setDirectory(s.settings.directory); setMirror(s.settings.mirror); setTheme(s.theme === 'light' ? 'light' : 'oled') }).catch(e => setError(e.message))
    const timer = window.setInterval(() => { void refresh().catch(() => {}) }, 1100)
    return () => window.clearInterval(timer)
  }, [])
  useEffect(() => { if (activeSection === 'collector' || activeSection === 'tournament') try { localStorage.setItem('pacc-bd-section', activeSection) } catch { /* optional preference */ } }, [activeSection])
  useEffect(() => { document.documentElement.dataset.theme = theme; try { localStorage.setItem('pacc-bd-theme', theme) } catch { /* optional preference */ } }, [theme])

  const live = state?.collections.find(c => c.id === state.currentId)
  const collection: Collection = live || { id: 0, name: t('collectorReady'), uploader: '', reportedCount: 0, maps: [], fetchedAt: '' }
  const isDemo = !live
  const groups = useMemo(() => group(collection.maps), [collection.maps])
  const visible = useMemo(() => sortMapGroups(groups.filter(maps => `${maps[0].artist} ${maps[0].title} ${maps[0].creator} ${maps.map(m => m.version).join(' ')}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())).map(maps => maps.filter(map => matchesMapFilters(map, collectorFilters))).filter(maps => maps.length), sort), [groups, query, collectorFilters, sort])
  const available = collection.maps.filter(m => m.beatmapsetId)
  const selectedSets = new Set(collection.maps.filter(m => selected.has(m.id) && m.beatmapsetId).map(m => m.beatmapsetId)).size
  const already = (setId: number | null) => state?.queue.find(i => i.beatmapsetId === setId)
  const tournamentSets = useMemo(() => {
    const sets = new Map<number, TournamentEntry[]>()
    for (const entry of state?.tournament?.entries || []) sets.set(entry.beatmapsetId, [...(sets.get(entry.beatmapsetId) || []), entry])
    return [...sets]
  }, [state?.tournament])
  const visibleTournamentSets = useMemo(() => sortMapGroups(tournamentSets.map(([, entries]) => entries.filter(entry => matchesMapFilters(entry, tournamentFilters) && `${entry.artist} ${entry.title} ${entry.creator} ${entry.version || ''} ${entry.beatmapsetId}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()))).filter(entries => entries.length), sort).map(entries => [entries[0].beatmapsetId, entries] as const), [tournamentSets, tournamentFilters, query, sort])
  const coverSource = activeSection === 'collector' || activeSection === 'tournament' ? activeSection : returnSection
  const headerCover = coverSource === 'collector' ? visible[0]?.[0]?.cover ?? null : visibleTournamentSets[0]?.[1][0]?.cover ?? null
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
  function downloadActions(source: 'collector' | 'tournament') {
    const isCollector = source === 'collector'
    const count = isCollector ? selectedSets : selectedTournament.size
    const ids = isCollector ? [...selected] : [...selectedTournament]
    const all = isCollector ? available.map(map => map.id) : tournamentSets.map(([id]) => id)
    const enqueue = (values: number[]) => void action(isCollector ? 'enqueue' : 'tournament/enqueue', isCollector ? { collectionId: collection.id, ids: values } : { ids: values })
    return <div className="listing-download-actions"><span>{count} {t('selected')}</span><button type="button" className="listing-download-all" title={t('filterAllNote')} disabled={!all.length} onClick={() => enqueue(all)}>{t('downloadAll')}</button><button type="button" className="primary-button" disabled={!ids.length} onClick={() => enqueue(ids)}><ArrowDownToLine size={15} />{t('downloadSelected')}</button></div>
  }
  function searchBox() {
    return <div className="listing-search"><Search size={25} /><input aria-label={t('searchLabel')} value={query} onChange={event => setQuery(event.target.value)} placeholder={t('search')} /><details className="listing-help"><summary aria-label={language === 'es' ? 'Ayuda' : 'Help'}><CircleHelp size={21} /></summary><div>{t('oszNote')}<br />{t('filterAllNote')}. {t('installedNote')}</div></details></div>
  }
  function sortToolbar(results: string) {
    return <div className="listing-toolbar"><label>{language === 'es' ? 'Ordenar por' : 'Sort by'}<select aria-label={language === 'es' ? 'Ordenar mapas' : 'Sort maps'} value={sort} onChange={event => setSort(event.target.value as SortOrder)}><option value="original">{language === 'es' ? 'Vista previa' : 'Preview order'}</option><option value="title">{language === 'es' ? 'Título' : 'Title'}</option><option value="artist">{language === 'es' ? 'Artista' : 'Artist'}</option><option value="difficulty">{language === 'es' ? 'Dificultad' : 'Difficulty'}</option></select></label><span className="listing-results">{results}</span><div className="listing-view" role="group" aria-label={language === 'es' ? 'Vista' : 'View'}><button type="button" aria-label={language === 'es' ? 'Cuadrícula' : 'Grid'} aria-pressed={view === 'grid'} onClick={() => setView('grid')}><Grid2X2 size={17} /></button><button type="button" aria-label={language === 'es' ? 'Lista' : 'List'} aria-pressed={view === 'list'} onClick={() => setView('list')}><List size={18} /></button></div></div>
  }

  return <div className="app-shell">
    <HeaderBackdrop cover={headerCover} />
    <header className="site-header"><div className="header-inner">
      <div className="brand"><div className="app-name">PACC<span>-BD</span><small>{t('tagline')}</small></div><nav className="section-switch" aria-label={t('mode')}><button type="button" className={activeSection === 'collector' ? 'current' : ''} aria-current={activeSection === 'collector' ? 'page' : undefined} onClick={() => { setActiveSection('collector'); setError(''); setNotice('') }}><span className="tab-full">{t('collectorTab')}</span><span className="tab-short">{t('collectorTabShort')}</span></button><button type="button" className={activeSection === 'tournament' ? 'current' : ''} aria-current={activeSection === 'tournament' ? 'page' : undefined} onClick={() => { setActiveSection('tournament'); setError(''); setNotice('') }}><span className="tab-full">{t('beatmapTab')}</span><span className="tab-short">{t('beatmapTabShort')}</span></button><button type="button" className={activeSection === 'stable' ? 'current' : ''} aria-current={activeSection === 'stable' ? 'page' : undefined} onClick={() => { if (activeSection !== 'stable') openCollections(activeSection === 'collector' || activeSection === 'tournament' ? activeSection : returnSection); setError(''); setNotice('') }}>{t('collectionsNav')}</button></nav></div>
      <div className="header-actions"><UpdateChecker language={language} /><button type="button" className={`collections-nav settings-nav ${activeSection === 'settings' ? 'current' : ''}`} aria-current={activeSection === 'settings' ? 'page' : undefined} title={t('settings')} onClick={() => activeSection === 'settings' ? setActiveSection(returnSection) : openSettings()}><Settings2 size={15} />{t('settings')}</button><div className="language-switch" role="group" aria-label={t('language')}><button type="button" aria-pressed={language === 'en'} className={language === 'en' ? 'current' : ''} onClick={() => changeLanguage('en')}>EN</button><button type="button" aria-pressed={language === 'es'} className={language === 'es' ? 'current' : ''} onClick={() => changeLanguage('es')}>ES</button></div></div>
    </div></header>

    <main className="page">
      {activeSection === 'settings' ? <section className="settings-page" aria-label={t('settings')}><span className="section-label">PACC-BD</span><h1>{t('settings')}</h1>
        {error && <div className="alert error" role="alert">{localizeError(error, language)}</div>}
        {notice && <div className="alert success" role="status">{notice}</div>}
        <div className="settings-card"><h2>{t('themeTitle')}</h2><p>{t('themeHelp')}</p><div className="theme-options" role="group" aria-label={t('themeTitle')}>{(['oled', 'light'] as const).map(value => <button type="button" key={value} disabled={themeBusy} className={`theme-option ${value} ${theme === value ? 'selected' : ''}`} aria-pressed={theme === value} onClick={() => void changeTheme(value)}><span className="theme-swatch" aria-hidden="true"><i /><i /><i /></span><strong>{t(value === 'light' ? 'themeLight' : 'themeTeam')}</strong><small>{t(value === 'light' ? 'themeLightHint' : 'themeOledHint')}</small></button>)}</div></div>
        <ZoomSettings language={language} />
        <div className="settings-card"><h2>{t('directory')}</h2><p>{t('settingsDescription')}</p><form className="settings-form" onSubmit={(event: FormEvent) => { event.preventDefault(); void action('settings', { directory, mirror }) }}><label htmlFor="directory">{t('directoryAbsolute')}</label><input id="directory" required value={directory} onChange={e => setDirectory(e.target.value)} />{window.paccDesktop && <button className="secondary-button" type="button" onClick={() => { void window.paccDesktop?.chooseDirectory().then(value => { if (value) setDirectory(value) }).catch(e => setError((e as Error).message)) }}>{t('browse')}</button>}<label htmlFor="mirror">{t('mirror')}</label><select id="mirror" value={mirror} onChange={e => setMirror(e.target.value as 'direct' | 'catboy')}><option value="direct">{t('direct')}</option><option value="catboy">{t('catboy')}</option></select><button className="primary-button" type="submit">{t('saveSettings')}</button></form></div>
        <p className="installed-note">{t('installedNote')}</p>
      </section> : activeSection === 'stable' ? <StablePanel language={language} initialSource={returnSection} goToSource={setActiveSection} /> : <>
      <DownloadQueue queue={state?.queue || []} paused={!!state?.paused} language={language} onAction={action} />
      <div className="listing-heading"><h1><img src="/panama-accuracy-flag.png" alt="" />{language === 'es' ? 'listado de mapas' : 'beatmap listing'}</h1></div>

      {activeSection === 'collector' ? <details className="import-section listing-source" key={`collector-${collection.fetchedAt}`} open={isDemo}>
        <summary>{t('collectionInput')}<ChevronDown size={14} /></summary>
        <form className="import-form" onSubmit={(event: FormEvent) => { event.preventDefault(); void loadCollection(input) }}><label htmlFor="collection-input">{t('collectionInput')}</label><div className="input-line"><input id="collection-input" type="text" required autoComplete="off" placeholder={t('inputPlaceholder')} value={input} onChange={e => setInput(e.target.value)} /><button className="primary-button" type="submit" disabled={busy}>{busy ? <><LoaderCircle size={16} className="spin" />{t('fetching')}</> : <>{t('fetch')} <ArrowRight size={16} /></>}</button></div></form>
      </details> :

      <details className="tournament-input-panel listing-source" key={`tournament-${state?.tournament?.fetchedAt}`} open={!tournamentSets.length}>
        <summary>{t('tournamentInput')}<ChevronDown size={14} /></summary><p>{t('tournamentHint')}</p>
        <form onSubmit={(event: FormEvent) => { event.preventDefault(); void loadTournament() }}>
          <label htmlFor="tournament-input">{t('tournamentInput')}</label>
          <textarea id="tournament-input" required maxLength={30000} value={tournamentInput} onChange={e => setTournamentInput(e.target.value)} placeholder={t('tournamentPlaceholder')} rows={4} />
          <div className="tournament-input-actions"><label htmlFor="number-kind">{t('numericIds')}</label><select id="number-kind" value={numberKind} onChange={e => setNumberKind(e.target.value as 'beatmap' | 'beatmapset')}><option value="beatmap">{t('beatmapId')}</option><option value="beatmapset">{t('beatmapsetId')}</option></select><button type="submit" className="primary-button" disabled={tournamentBusy}>{tournamentBusy ? <><LoaderCircle size={16} className="spin" />{t('resolving')}</> : <>{t('previewIds')} <ArrowRight size={16} /></>}</button></div>
        </form>
      </details>}

      {error && <div className="alert error" role="alert"><CircleHelp size={16} />{localizeError(error, language)}<button type="button" aria-label={t('dismissError')} onClick={() => setError('')}><X size={16} /></button></div>}
      {notice && <div className="alert success" role="status"><Check size={16} />{notice}<button type="button" aria-label={t('dismissNotice')} onClick={() => setNotice('')}><X size={16} /></button></div>}

      <div className="workspace listing-workspace">
        <div className="preview-panels">{activeSection === 'collector' ? <><section className="collection-panel" aria-label={t('collection')}>
           <div className="listing-collection-meta"><span>{collection.name}</span>{!isDemo && <a className="listing-collector-link" href={`https://osucollector.com/collections/${collection.id}`} target="_blank" rel="noopener noreferrer" title={t('openCollector')}>Collector <ExternalLink size={12} /></a>}</div>
           {isDemo ? <div className="collector-empty">{t('collectorEmpty')}</div> : <>
           <div className="listing-filter-area"><div className="listing-backdrop" aria-hidden="true">{collection.maps[0]?.cover && <img src={collection.maps[0].cover} alt="" />}</div>{searchBox()}<MapFiltersPanel listing language={language} maps={collection.maps} filters={collectorFilters} onChange={setCollectorFilters} id="collector-filters" /></div>
           {sortToolbar(`${visible.length} ${t('results')} · ${visible.flat().length} ${t('difficulties')}`)}
          <div className="listing-selection-bar"><div className="listing-select-tools"><button type="button" disabled={!visible.length} onClick={() => setSelected(previous => new Set([...previous, ...visible.flat().filter(m => m.beatmapsetId).map(m => m.id)]))}>{t('selectVisible')}</button><button type="button" disabled={!selected.size} onClick={() => setSelected(new Set())}>{t('clear')}</button></div>{downloadActions('collector')}</div>

           <div className={`listing-map-grid ${view === 'list' ? 'is-list' : ''}`}>{visible.length === 0 ? <div className="empty-list">{t('emptySearch')}</div> : visible.map(maps => { const map = maps[0], ids = maps.filter(diff => diff.beatmapsetId).map(diff => diff.id); return <BeatmapCard key={map.beatmapsetId || `missing-${map.id}`} setId={map.beatmapsetId} title={map.title} artist={map.artist} creator={map.creator} cover={map.cover} status={map.status} featuredArtist={map.featuredArtist} language={language} queued={already(map.beatmapsetId)} selected={!!ids.length && ids.every(id => selected.has(id))} onSelect={() => toggle(ids)} onDownload={() => action('enqueue', { collectionId: collection.id, ids })} difficulties={maps.map(diff => ({ key: String(diff.id), version: diff.version, stars: diff.stars, mode: diff.mode, selected: selected.has(diff.id), onSelect: diff.beatmapsetId ? () => toggle([diff.id]) : undefined }))} /> })}</div>
            </>}
        </section>

        </> : <section className="tournament-panel" aria-label={t('tournamentSection')}><div className="listing-collection-meta"><span>{t('tournamentPreview')}</span><span>{state?.tournament?.entries.length || 0} {t('tournamentIds')}</span></div>
           {tournamentSets.length > 0 && <><div className="listing-filter-area"><div className="listing-backdrop" aria-hidden="true">{state?.tournament?.entries[0]?.cover && <img src={state.tournament.entries[0].cover} alt="" />}</div>{searchBox()}<MapFiltersPanel listing language={language} maps={state?.tournament?.entries || []} filters={tournamentFilters} onChange={setTournamentFilters} id="tournament-filters" /></div>{sortToolbar(`${visibleTournamentSets.length} ${t('results')}`)}<div className="listing-selection-bar"><div className="listing-select-tools"><button type="button" disabled={!visibleTournamentSets.length} onClick={() => setSelectedTournament(previous => new Set([...previous, ...visibleTournamentSets.map(([id]) => id)]))}>{t('selectVisible')}</button><button type="button" disabled={!selectedTournament.size} onClick={() => setSelectedTournament(new Set())}>{t('clear')}</button></div>{downloadActions('tournament')}</div>
             <div className={`listing-map-grid ${view === 'list' ? 'is-list' : ''}`}>{visibleTournamentSets.length ? visibleTournamentSets.map(([id, entries]) => { const entry = entries[0]; const toggleSet = () => setSelectedTournament(previous => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next }); const diffs = entries.flatMap(e => e.difficultyId === null && e.setDifficulties?.length ? e.setDifficulties.filter(diff => matchesMapFilters({ ...diff, difficultyId: diff.id }, tournamentFilters)).map(diff => ({ key: String(diff.id), version: `#${diff.id}`, stars: diff.stars, mode: diff.mode })) : [{ key: e.difficultyId ? String(e.difficultyId) : `set-${id}`, version: e.version, stars: e.stars, mode: e.mode }]); return <BeatmapCard key={id} setId={id} title={entry.title} artist={entry.artist} creator={entry.creator} cover={entry.cover} status={entry.status} featuredArtist={entry.featuredArtist} language={language} queued={already(id)} selected={selectedTournament.has(id)} onSelect={toggleSet} onDownload={() => action('tournament/enqueue', { ids: [id] })} difficulties={[...new Map(diffs.map(diff => [diff.key, diff])).values()].map(diff => ({ ...diff, selected: selectedTournament.has(id), onSelect: toggleSet }))} /> }) : <div className="empty-list">{t('emptySearch')}</div>}</div></>}
          {!!state?.tournament?.failures.length && <div className="tournament-failures"><strong>{t('unresolved')} ({state.tournament.failures.length})</strong><ul>{state.tournament.failures.map((failure, i) => <li key={i}><code>{failure.source}</code> — {localizeError(failure.reason, language)}</li>)}</ul></div>}
        </section>}
        </div>

      </div>

      {activeSection === 'collector' && !!state?.collections.length && <details className="recent listing-recent"><summary>{t('recent')}<ChevronDown size={13} /></summary><div>{state.collections.map(c => <button type="button" key={c.id} className={c.id === collection.id ? 'current' : ''} onClick={() => { void action('show', { id: c.id }); setSelected(new Set()); setQuery('') }}>{c.name}</button>)}<button type="button" onClick={() => { if (window.confirm(t('clearRecentConfirm'))) { void action('collections/clear'); setSelected(new Set()); setQuery('') } }}>{t('clearRecent')}</button></div></details>}</>}
      <footer><span>PACC-BD</span><span>{t('independent')}</span></footer>
    </main>
  </div>
}

createRoot(document.getElementById('root')!).render(<App />)
