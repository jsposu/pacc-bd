import { RotateCcw, SlidersHorizontal } from 'lucide-react'
import type { CSSProperties } from 'react'
import { copy, type Language } from './i18n'
import { emptyFilters, filterActive, type MapFilters, type MapStats } from './mapFilters'

type Bound = 'starsMin' | 'starsMax' | 'bpmMin' | 'bpmMax'

export function MapFiltersPanel({ language, maps, filters, onChange, id }: { language: Language; maps: MapStats[]; filters: MapFilters; onChange: (filters: MapFilters) => void; id: string }) {
  const t = copy[language]
  let highStars = 12, highBpm = 400
  for (const map of maps) for (const item of map.difficultyId === null && map.setDifficulties?.length ? map.setDifficulties : [map]) {
    highStars = Math.max(highStars, item.stars || 0)
    highBpm = Math.max(highBpm, item.bpm || 0)
  }
  const limits = { stars: Math.ceil(highStars / 2) * 2, bpm: Math.ceil(highBpm / 50) * 50 }
  function slider(label: string, key: 'stars' | 'bpm', maximum: number, step: number, unit: string) {
    const lower = `${key}Min` as Bound, upper = `${key}Max` as Bound
    const min = filters[lower] ?? 0, max = filters[upper] ?? maximum
    const change = (bound: Bound, value: number) => onChange({ ...filters, [bound]: value === (bound.endsWith('Min') ? 0 : maximum) ? null : value })
    return <div className="filter-range" key={key}>
      <div className="filter-range-heading"><strong>{label}</strong><output>{min.toFixed(key === 'stars' ? 1 : 0)}{unit} – {max === maximum ? `${maximum}+` : max.toFixed(key === 'stars' ? 1 : 0)}{unit}</output></div>
      <div className="filter-sliders" style={{ '--range-start': `${min / maximum * 100}%`, '--range-end': `${max / maximum * 100}%` } as CSSProperties}>
        <div className="filter-track" aria-hidden="true" />
        <input type="range" aria-label={`${label} ${t.filterMinimum}`} min={0} max={maximum} step={step} value={min} onChange={event => change(lower, Math.min(Number(event.target.value), max))} />
        <input type="range" aria-label={`${label} ${t.filterMaximum}`} min={0} max={maximum} step={step} value={max} onChange={event => change(upper, Math.max(Number(event.target.value), min))} />
      </div>
      <div className="filter-endpoints"><span>0{unit}</span><span>{maximum}+{unit}</span></div>
    </div>
  }
  return <section className="map-filters" aria-label={t.filtersTitle} id={id}>
    <div className="filter-header"><span><SlidersHorizontal size={16} />{t.filtersTitle}</span><button type="button" disabled={!filterActive(filters) && !filters.includeUnknown} onClick={() => onChange({ ...emptyFilters })}><RotateCcw size={13} />{t.filterReset}</button></div>
    <div className="filter-grid">{slider(t.filterStars, 'stars', limits.stars, .1, '★')}{slider(t.filterBpm, 'bpm', limits.bpm, 1, ' BPM')}</div>
    <label className="filter-unknown"><input type="checkbox" checked={filters.includeUnknown} onChange={event => onChange({ ...filters, includeUnknown: event.target.checked })} />{t.filterUnknown}</label>
  </section>
}
