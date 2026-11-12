import { useRef, useState, type CSSProperties } from 'react'
import { ChevronDown, RotateCcw } from 'lucide-react'
import { copy, type Language } from './i18n'
import { filterCopy } from './filterCopy'
import { emptyFilters, filterActive, type MapFilters, type MapStats, type RangeKey, type RangeBound } from './mapFilters'
import { difficultyGradient, difficultyHandleColour, difficultyTextColour } from './difficultyColours'
import { bpmColour, bpmGradient } from './bpmColours'

export function MapFiltersPanel({ language, maps, filters, onChange, id, listing = false }: { language: Language; maps: MapStats[]; filters: MapFilters; onChange: (filters: MapFilters) => void; id: string; listing?: boolean }) {
  const t = copy[language], text = filterCopy[language]
  const [expanded, setExpanded] = useState(false)
  const high = useRef({ stars: 10, bpm: 400, ar: 10, od: 10, cs: 10, hp: 10, length: 600 })
  const candidates = maps.flatMap<MapStats>(map => map.difficultyId === null && map.setDifficulties?.length ? map.setDifficulties : [map])
  for (const map of candidates) for (const key of Object.keys(high.current) as RangeKey[]) high.current[key] = Math.max(high.current[key], Math.ceil(map[key] || 0))
  function slider(label: string, key: RangeKey, step: number) {
    const lower: RangeBound = `${key}Min`, upper: RangeBound = `${key}Max`
    const maximum = Math.max(high.current[key], filters[lower] || 0, filters[upper] || 0)
    const min = filters[lower] ?? 0, max = filters[upper] ?? maximum
    const colour = ({ ar: '#ef6575', od: '#f5a45d', cs: '#58a6ff', hp: '#65cd98', length: '#b68aee' } as Partial<Record<RangeKey, string>>)[key]
    const unavailable = !!colour && !candidates.some(map => typeof map[key] === 'number' && Number.isFinite(map[key]))
    const display = (n: number) => key === 'length' ? `${Math.floor(n / 60)}:${String(Math.round(n % 60)).padStart(2, '0')}` : n.toFixed(step < 1 ? 1 : 0)
    const change = (bound: RangeBound, value: number) => onChange({ ...filters, [bound]: value === (bound === lower ? 0 : maximum) ? null : value })
    const colourValue = (value: number) => key === 'stars' ? value : value / maximum * 10
    return <div className={`lazer-range ${unavailable ? 'range-unavailable' : ''}`} key={key} title={unavailable ? text.unavailable : key === 'bpm' ? text.bpmHint : undefined}>
      <span className="lazer-range-label">{label}</span>
      <div className="lazer-range-slider" style={{ '--spectrum': key === 'bpm' ? bpmGradient(maximum) : colour ?? difficultyGradient(key === 'stars' ? maximum : 10), '--range-accent': key === 'bpm' ? bpmColour(max) : colour ?? '#66ccff', '--range-start': `${min / maximum * 100}%`, '--range-end': `${max / maximum * 100}%` } as CSSProperties}>
        <div className="lazer-spectrum" aria-hidden="true" /><div className="lazer-range-selection" aria-hidden="true" />
        {([false, true] as const).map(isUpper => {
          const value = isUpper ? max : min, scaled = colourValue(value)
          return <span className="lazer-bound" key={String(isUpper)} style={{ zIndex: !isUpper && min === max && min === maximum ? 1 : undefined }}>
            <input type="range" disabled={unavailable && filters[lower] === null && filters[upper] === null} min={0} max={maximum} step={step} value={value} aria-label={`${key === 'stars' ? t.filterStars : label} ${isUpper ? t.filterMaximum : t.filterMinimum}`} aria-valuetext={unavailable ? text.unavailable : isUpper && filters[upper] === null ? '∞' : display(value)} onChange={event => change(isUpper ? upper : lower, isUpper ? Math.max(Number(event.target.value), min) : Math.min(Number(event.target.value), max))} />
            <span className="lazer-nub" aria-hidden="true" style={{ left: `calc(${value / maximum * 100}% + ${22 - value / maximum * 44}px)`, background: key === 'bpm' ? bpmColour(value) : colour ?? difficultyHandleColour(scaled), color: key === 'bpm' || colour ? '#15151b' : isUpper && filters[upper] === null ? '#eeeeee' : difficultyTextColour(scaled) }}><span>{unavailable ? '—' : isUpper && filters[upper] === null ? '∞' : display(value)}</span></span>
          </span>
        })}
      </div>
    </div>
  }
  function choices(key: 'mode' | 'status', label: string, options: readonly (readonly string[])[]) {
    const available = filters[key] !== 'any' || key === 'mode' || key === 'status' || candidates.some(map => map[key] != null)
    return <div className="filter-choice-row" key={key}><span>{label}</span><div role="group" aria-label={label}>{available ? options.map(([value, name]) => <button type="button" key={value} aria-pressed={filters[key] === value} className={filters[key] === value ? 'active' : ''} onClick={() => onChange({ ...filters, [key]: value })}>{value === 'any' ? text.any : name}</button>) : <small>{text.unavailable}</small>}</div></div>
  }
  function toggles(label: string, keys: ('video' | 'storyboard' | 'featuredArtist' | 'excludeConverted')[]) {
    return <div className="filter-choice-row"><span>{label}</span><div>{keys.map(key => <button type="button" key={key} title={!candidates.some(map => map[key === 'excludeConverted' ? 'convert' : key] != null) ? text.unavailable : undefined} disabled={!filters[key] && !candidates.some(map => map[key === 'excludeConverted' ? 'convert' : key] != null)} aria-pressed={filters[key]} className={`${filters[key] ? 'active' : ''} ${key === 'featuredArtist' ? 'featured-artist-choice' : ''}`} onClick={() => onChange({ ...filters, [key]: !filters[key] })}>{text[key === 'excludeConverted' ? 'converted' : key]}</button>)}</div></div>
  }
  function categories() { return <div className="filter-choice-rows">
    {toggles(text.general, ['excludeConverted', 'featuredArtist'])}
    {choices('mode', text.mode, [['any', 'Any'], ['osu', 'osu!'], ['taiko', 'osu!taiko'], ['fruits', 'osu!catch'], ['mania', 'osu!mania']])}
    {choices('status', text.status, ['any', 'leaderboard', 'ranked', 'approved', 'qualified', 'loved', 'pending', 'wip', 'graveyard'].map(value => [value, text[value as keyof typeof text]]))}
  </div> }
  return <section className={`map-filters lazer-filters ${listing ? 'listing-filters' : ''}`} aria-label={t.filtersTitle} id={id}>
    {listing && categories()}
    <div className="lazer-primary-ranges">{slider('★', 'stars', .1)}</div>
    <div className="filter-toolbar"><button type="button" aria-expanded={expanded} aria-controls={`${id}-advanced`} onClick={() => setExpanded(!expanded)}><ChevronDown size={14} className={expanded ? 'rotate' : ''} />{expanded ? text.less : text.more}</button><button type="button" disabled={!filterActive(filters) && !filters.includeUnknown} onClick={() => onChange({ ...emptyFilters })}><RotateCcw size={12} />{t.filterReset}</button></div>
    <div id={`${id}-advanced`} hidden={!expanded}>
      {!listing && categories()}
      <div className="lazer-extra-ranges">{slider('BPM', 'bpm', 1)}{slider('AR', 'ar', .1)}{slider('OD', 'od', .1)}{slider(text.cs, 'cs', .1)}{slider(text.hp, 'hp', .1)}{slider(text.length, 'length', 1)}</div>
      {(['ar', 'od', 'cs', 'hp', 'length'] as const).some(key => !candidates.some(map => typeof map[key] === 'number')) && <p className="filter-data-note">{language === 'es' ? '— = dato no disponible. Vuelve a cargar la vista del descargador para actualizar metadatos antiguos.' : '— = data unavailable. Reload the downloader preview to update older saved metadata.'}</p>}
      <label className="filter-unknown"><input type="checkbox" checked={filters.includeUnknown} onChange={event => onChange({ ...filters, includeUnknown: event.target.checked })} />{text.unknown}</label><p className="filter-data-note">{text.note}</p>
    </div>
  </section>
}
