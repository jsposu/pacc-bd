import { useEffect, useState } from 'react'
import type { Language } from './i18n'

export function ZoomSettings({ language }: { language: Language }) {
  const [zoom, setZoom] = useState(1)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')
  const desktop = window.paccDesktop
  const es = language === 'es'
  useEffect(() => {
    if (!desktop) return
    void desktop.getZoom().then(setZoom).catch(() => setError(es ? 'No se pudo leer el zoom.' : 'Could not read zoom.')).finally(() => setBusy(false))
  }, [])
  if (!desktop) return null
  async function change(value: number) {
    setBusy(true); setError('')
    try { setZoom(await desktop!.setZoom(Math.max(.75, Math.min(1.5, value)))) }
    catch { setError(es ? 'No se pudo guardar el zoom.' : 'Could not save zoom.') }
    finally { setBusy(false) }
  }
  return <div className="settings-card"><h2>{es ? 'Zoom de la interfaz' : 'Interface zoom'}</h2><p>{es ? 'Ajusta el tamaño del contenido. Se guarda para el próximo inicio.' : 'Adjust the content size. Saved for the next launch.'}</p><div className="zoom-controls"><button type="button" className="secondary-button" aria-label={es ? 'Alejar' : 'Zoom out'} disabled={busy || zoom <= .75} onClick={() => void change(Math.round((zoom - .1) * 100) / 100)}>−</button><output aria-live="polite">{Math.round(zoom * 100)}%</output><button type="button" className="secondary-button" aria-label={es ? 'Acercar' : 'Zoom in'} disabled={busy || zoom >= 1.5} onClick={() => void change(Math.round((zoom + .1) * 100) / 100)}>+</button><button type="button" className="secondary-button" disabled={busy || zoom === 1} onClick={() => void change(1)}>{es ? 'Restablecer al 100%' : 'Reset to 100%'}</button></div>{error && <p role="alert">{error}</p>}</div>
}
