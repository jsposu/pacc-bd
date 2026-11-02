import { useEffect, useState } from 'react'
import { ArrowDownToLine } from 'lucide-react'
import type { Language } from './i18n'
import type { ExportMap } from '../server/lazerExport'
import { MapFiltersPanel } from './MapFiltersPanel'
import { emptyFilters, matchesMapFilters } from './mapFilters'

export function LazerPanel({ language, initialSource }: { language: Language; initialSource: 'collector' | 'tournament' }) {
  const es = language === 'es'
  const [source, setSource] = useState(initialSource)
  const [preview, setPreview] = useState<{ name: string; maps: ExportMap[] } | null>(null)
  const [name, setName] = useState('')
  const [filters, setFilters] = useState({ ...emptyFilters })
  const [error, setError] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    setPreview(null); setError(''); setFilters({ ...emptyFilters })
    void fetch(`/api/lazer/preview?source=${source}`, { signal: controller.signal }).then(async response => {
      const result = await response.json()
      if (!response.ok) throw new Error(result.error)
      if (!controller.signal.aborted) { setPreview(result); setName(result.name) }
    }).catch(cause => { if (!controller.signal.aborted) setError((cause as Error).message) })
    return () => controller.abort()
  }, [source])
  const visible = (preview?.maps || []).filter(map => matchesMapFilters(map, filters))
  const eligible = visible.filter(map => map.checksum && /^[a-f\d]{32}$/i.test(map.checksum))
  const count = new Set(eligible.map(map => map.checksum!.toLowerCase())).size
  const query = new URLSearchParams({ source, name })
  for (const [key, value] of Object.entries(filters)) if (value !== null) query.set(key, String(value))
  return <div className="lazer-handoff"><h2>osu!lazer</h2><p>{es ? 'Exportar una colección para importarla manualmente en lazer. No es un editor de tu biblioteca lazer existente.' : 'Export a collection for manual import into lazer. This is not an editor for your existing lazer library.'}</p>
    <div className="stable-source-tabs" role="group" aria-label={es ? 'Fuente' : 'Source'}>{(['collector', 'tournament'] as const).map(value => <button type="button" key={value} aria-pressed={value === source} className={value === source ? 'active' : ''} onClick={() => setSource(value)}>{value === 'collector' ? 'osu! Collector' : es ? 'IDs de mapas' : 'Beatmap IDs'}</button>)}</div>
    {error && <p role="alert">{error}</p>}
    {!preview && !error && <p role="status">{es ? 'Cargando vista guardada…' : 'Loading saved preview…'}</p>}
    {preview && <><label className="lazer-export-name">{es ? 'Nombre de colección' : 'Collection name'}<input value={name} maxLength={100} onChange={event => setName(event.target.value)} /></label><MapFiltersPanel language={language} maps={preview.maps} filters={filters} onChange={setFilters} id="lazer-export-filters" />
      <p>{count} {es ? 'mapas con checksum disponible' : 'maps with known checksums'} · {visible.length - eligible.length} {es ? 'sin checksum (se omitirán)' : 'without checksums (will be skipped)'}</p>
      <a className={`primary-button ${!count || !name.trim() ? 'is-disabled' : ''}`} aria-disabled={!count || !name.trim()} href={count && name.trim() ? `/api/lazer/export?${query}` : undefined} download="collection.db"><ArrowDownToLine size={16} />{es ? 'Exportar collection.db' : 'Export collection.db'}</a></>}
    <ol><li>{es ? 'Guarda collection.db en una carpeta nueva y separada. Crea dentro una carpeta vacía llamada Songs para que lazer la reconozca como origen de importación.' : 'Save collection.db in a new, separate folder. Create an empty Songs folder inside it so lazer recognises it as an import source.'}</li><li>{es ? 'En el asistente de importación desde stable de lazer, selecciona esa carpeta e importa solo Colecciones. No reemplaces archivos de una instalación real.' : 'In lazer’s Import from stable setup, choose that folder and import Collections only. Do not replace files in a real installation.'}</li><li>{es ? 'Importa los mapas .osz manualmente si faltan. La colección guarda referencias por checksum, no los mapas.' : 'Manually import the .osz beatmaps if missing. The collection contains checksum references, not the maps themselves.'}</li></ol>
    <p className="stable-warning">{es ? 'Lazer combina las colecciones con el mismo nombre. Esta exportación no puede renombrar, eliminar ni quitar mapas de una colección lazer existente. PACC-BD no modifica client.realm ni importa mapas automáticamente.' : 'Lazer merges collections with the same name. This export cannot rename, delete, or remove maps from an existing lazer collection. PACC-BD never modifies client.realm or imports beatmaps automatically.'}</p>
  </div>
}
