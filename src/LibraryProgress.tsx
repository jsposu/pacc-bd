import { useEffect, useRef, useState } from 'react'
import type { Language } from './i18n'
import type { ScanProgress } from '../server/stable'

export function LibraryProgress({ active, language }: { active: boolean; language: Language }) {
  const [progress, setProgress] = useState<ScanProgress | null>(null)
  const [unavailable, setUnavailable] = useState(false)
  const wasActive = useRef(false)
  useEffect(() => {
    if (!active && !wasActive.current) return
    wasActive.current = active
    let disposed = false, timer: number | undefined
    const controller = new AbortController()
    if (active) { setProgress(null); setUnavailable(false) }
    const update = async () => {
      try {
        const response = await fetch('/api/stable/progress', { signal: controller.signal, cache: 'no-store' })
        if (!response.ok) throw new Error('Progress unavailable')
        const value = await response.json() as ScanProgress
        if (!disposed) { setProgress(value); setUnavailable(false) }
      } catch { if (!disposed) setUnavailable(true) }
      if (!disposed && active) timer = window.setTimeout(() => void update(), 100)
    }
    void update()
    return () => { disposed = true; controller.abort(); window.clearTimeout(timer) }
  }, [active])
  if (!active && (progress?.phase !== 'ready' || unavailable)) return null
  const es = language === 'es'
  const phase = progress?.phase
  const label = phase === 'counting' ? es ? 'Contando mapas…' : 'Counting maps…' : phase === 'scanning' ? es ? 'Leyendo mapas…' : 'Reading maps…' : phase === 'ready' ? es ? 'Biblioteca lista' : 'Library ready' : phase === 'error' ? es ? 'No se pudo leer la biblioteca' : 'Library scan failed' : es ? 'Abriendo biblioteca…' : 'Opening library…'
  const percent = !unavailable && progress?.percent != null ? progress.percent : null
  return <div className="library-progress" role="status"><div><strong>{label}</strong><span>{percent !== null ? `${percent}%` : '…'}</span></div><progress aria-label={label} max={100} value={percent ?? undefined} /><small>{unavailable ? es ? 'No se pudo consultar el progreso; esperando la operación.' : 'Progress unavailable; waiting for the operation.' : progress?.total != null ? `${progress.processed.toLocaleString()} / ${progress.total.toLocaleString()}` : es ? 'Buscando archivos .osu; el porcentaje aparecerá al conocer el total.' : 'Finding .osu files; percentage appears once the total is known.'}</small></div>
}
