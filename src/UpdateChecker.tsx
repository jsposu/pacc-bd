import { useState } from 'react'
import { ExternalLink, LoaderCircle, RefreshCcw, X } from 'lucide-react'
import { copy, type Language, type TranslationKey } from './i18n'

type Result = { current: string; latest: string; available: boolean; notes: string; url: string }

export function UpdateChecker({ language }: { language: Language }) {
  const t = (key: TranslationKey) => copy[language][key]
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<Result | null>(null)

  async function check() {
    setOpen(true); setBusy(true); setError(''); setResult(null)
    try {
      const response = await fetch('/api/update')
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`)
      setResult(data as Result)
    } catch (cause) { setError((cause as Error).message) }
    finally { setBusy(false) }
  }

  return <div className="update-checker">
    <button type="button" className="update-trigger" aria-expanded={open} title={t('checkUpdates')} onClick={() => void check()}><RefreshCcw size={14} />{t('checkUpdates')}</button>
    {open && <div className="update-popover" role="status"><button type="button" className="update-dismiss" aria-label={t('dismissNotice')} onClick={() => setOpen(false)}><X size={15} /></button>
      <strong>{t('updatesTitle')}</strong>
      {busy && <p><LoaderCircle size={14} className="spin" /> {t('updateChecking')}</p>}
      {error && <p className="update-error">{error}</p>}
      {result && <><p>{result.available ? t('updateAvailable') : t('upToDate')}</p><small>{t('installedVersion')} {result.current} · {t('latestVersion')} {result.latest}</small>
        {result.available && <><a className="primary-button" href={result.url} target="_blank" rel="noopener noreferrer"><ExternalLink size={14} />{t('viewRelease')}</a>{result.notes && <details><summary>{t('releaseNotes')}</summary><pre>{result.notes}</pre></details>}<small>{t('updateManual')}</small></>}
      </>}
    </div>}
  </div>
}
