import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { SelfieCapture } from '../components/SelfieCapture'
import { QRScanner, type AccessQrPayload } from '../components/QRScanner'
import { verifyWorker } from '../services/api'
import { addAccessLogEntry } from '../services/accessLog'
import { useAccessGuardStore } from '../store/accessguardStore'

type Step = 'method' | 'qr' | 'manual' | 'selfie' | 'verifying' | 'result'

type AccessForm = {
  firstName: string
  lastName: string
  site: string
  zone: string
  access_point: string
}

export function AccessRequest() {
  const nav = useNavigate()
  const { worker } = useAccessGuardStore()

  const [step, setStep] = useState<Step>('method')
  const [err, setErr] = useState('')
  const [selfieB64, setSelfieB64] = useState('')

  const [form, setForm] = useState<AccessForm>({
    firstName: worker?.firstName ?? '',
    lastName: worker?.lastName ?? '',
    site: '',
    zone: worker?.employerSite?.split(' — ')[1] ?? '',
    access_point: '',
  })

  const accessLevel = worker?.jobRole || '—'

  function setField(key: keyof AccessForm) {
    return (e: React.ChangeEvent<HTMLInputElement>) => setForm(v => ({ ...v, [key]: e.target.value }))
  }

  const zoneLabel = useMemo(() => {
    if (!form.site && !form.zone) return '—'
    if (form.site && form.zone) return `${form.site} / ${form.zone}`
    return form.site || form.zone
  }, [form.site, form.zone])

  function onQrDetected(payload: AccessQrPayload) {
    setForm(v => ({
      ...v,
      site: payload.site,
      zone: payload.zone,
      access_point: payload.access_point,
    }))
    setStep('selfie')
  }

  function beginManual(e: React.FormEvent) {
    e.preventDefault()
    setErr('')
    if (!form.firstName || !form.lastName) {
      setErr('Please enter First Name and Last Name.')
      return
    }
    if (!form.zone) {
      setErr('Please enter Site / Zone.')
      return
    }
    setStep('selfie')
  }

  async function onSelfie(b64: string) {
    setSelfieB64(b64)
    setStep('verifying')
    setErr('')

    try {
      const res = await verifyWorker({ selfie_b64: b64, first_name: form.firstName, last_name: form.lastName })
      const similarity = Math.round(res.similarity)
      const granted = Boolean(res.verified)

      addAccessLogEntry({
        at: Date.now(),
        first_name: form.firstName,
        last_name: form.lastName,
        site: form.site || 'Unknown site',
        zone: form.zone || 'Unknown zone',
        access_point: form.access_point || '—',
        granted,
        similarity,
      })

      setResult({ granted, similarity })
      setStep('result')
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Verification failed')
      setResult({ granted: false, similarity: 0 })
      setStep('result')
    }
  }

  const [result, setResult] = useState<{ granted: boolean; similarity: number } | null>(null)

  const nowLabel = useMemo(() => new Date().toLocaleString('en-ZA', { hour: '2-digit', minute: '2-digit', year: 'numeric', month: '2-digit', day: '2-digit' }), [step])

  return (
    <div className="page">
      <div className="logo" style={{ cursor: 'pointer' }} onClick={() => nav('/')}>← ACCESSGUARD</div>

      {step === 'method' && (
        <>
          <div className="badge badge-cyan">Request Access</div>
          <h1 className="step-title">Access Request</h1>
          <p className="step-sub">Scan the site's QR code, or enter details manually.</p>

          <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <button className="btn btn-primary" onClick={() => setStep('qr')}>Scan QR Code</button>
            <button className="btn btn-outline" onClick={() => setStep('manual')}>Manual entry</button>
          </div>
        </>
      )}

      {step === 'qr' && (
        <>
          <div className="badge badge-cyan">Step 1 — Scan QR</div>
          <h1 className="step-title">Scan Site QR</h1>
          <p className="step-sub">The QR contains site/zone/access point and will auto-fill.</p>
          <QRScanner onDetected={onQrDetected} onError={(m) => setErr(m)} />
          {err && <p className="step-sub" style={{ color: 'var(--red)', marginBottom: 0 }}>{err}</p>}
          <button className="btn btn-outline" style={{ marginTop: 12 }} onClick={() => setStep('method')}>Back</button>
        </>
      )}

      {step === 'manual' && (
        <>
          <div className="badge badge-cyan">Step 1 — Manual</div>
          <h1 className="step-title">Manual Entry</h1>
          <p className="step-sub">Enter name and site/zone.</p>
          <form onSubmit={beginManual} style={{ width: '100%' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div className="field">
                <label>First Name</label>
                <input value={form.firstName} onChange={setField('firstName')} required placeholder="John" />
              </div>
              <div className="field">
                <label>Last Name</label>
                <input value={form.lastName} onChange={setField('lastName')} required placeholder="Smith" />
              </div>
            </div>
            <div className="field">
              <label>Site / Zone</label>
              <input value={form.zone} onChange={setField('zone')} required placeholder="Zone B — Restricted" />
            </div>
            <div className="field">
              <label>Access point (optional)</label>
              <input value={form.access_point} onChange={setField('access_point')} placeholder="Gate 3" />
            </div>
            {err && <div style={{ color: 'var(--red)', fontSize: 13, marginBottom: 10 }}>{err}</div>}
            <button className="btn btn-primary" type="submit">Continue →</button>
          </form>
          <button className="btn btn-outline" style={{ marginTop: 12 }} onClick={() => setStep('method')}>Back</button>
        </>
      )}

      {step === 'selfie' && (
        <>
          <div className="badge badge-cyan">Step 2 — Selfie</div>
          <h1 className="step-title">Identity Verification</h1>
          <p className="step-sub">Look at the camera. This takes 2 seconds.</p>
          <div className="card" style={{ width: '100%', padding: 14, marginTop: 0 }}>
            <div className="metric-row">
              <span className="metric-label">Worker</span>
              <span className="metric-value">{form.firstName} {form.lastName}</span>
            </div>
            <div className="metric-row">
              <span className="metric-label">Zone</span>
              <span className="metric-value">{zoneLabel}</span>
            </div>
            <div className="metric-row">
              <span className="metric-label">Access Level</span>
              <span className="metric-value">{accessLevel}</span>
            </div>
          </div>
          <SelfieCapture onCapture={onSelfie} />
          <button className="btn btn-outline" style={{ marginTop: 12 }} onClick={() => setStep('method')}>Cancel</button>
        </>
      )}

      {step === 'verifying' && (
        <>
          <h1 className="step-title">Verifying…</h1>
          <p className="step-sub">Matching your face against registered profile</p>
          <div style={{ marginTop: 40, color: 'var(--accent)', fontSize: 48 }}>⬡</div>
        </>
      )}

      {step === 'result' && result && (
        <>
          {result.granted ? (
            <>
              <div style={{ fontSize: 64, marginBottom: 12 }}>✅</div>
              <div className="badge badge-green" style={{ margin: '0 auto 16px' }}>ACCESS GRANTED</div>
              <h1 className="step-title">Welcome</h1>
              <p className="step-sub">Valid for: 8 hours</p>
            </>
          ) : (
            <>
              <div style={{ fontSize: 64, marginBottom: 12 }}>❌</div>
              <div className="badge" style={{ background:'rgba(239,68,68,0.12)', color:'var(--red)', border:'1px solid rgba(239,68,68,0.25)', margin:'0 auto 16px' }}>
                ACCESS DENIED
              </div>
              <h1 className="step-title">Denied</h1>
              <p className="step-sub">Face match failed — similarity: {result.similarity}%</p>
            </>
          )}

          {err && <p className="step-sub" style={{ color: 'var(--red)' }}>{err}</p>}

          <div className="card" style={{ width: '100%', marginTop: 10 }}>
            <div className="metric-row">
              <span className="metric-label">Worker</span>
              <span className="metric-value">{form.firstName} {form.lastName}</span>
            </div>
            <div className="metric-row">
              <span className="metric-label">Access Level</span>
              <span className="metric-value">{accessLevel}</span>
            </div>
            <div className="metric-row">
              <span className="metric-label">Site</span>
              <span className="metric-value">{form.site || '—'}</span>
            </div>
            <div className="metric-row">
              <span className="metric-label">Zone</span>
              <span className="metric-value">{form.zone || '—'}</span>
            </div>
            <div className="metric-row">
              <span className="metric-label">Access point</span>
              <span className="metric-value">{form.access_point || '—'}</span>
            </div>
            <div className="metric-row">
              <span className="metric-label">Time</span>
              <span className="metric-value">{nowLabel}</span>
            </div>
            <div className="metric-row">
              <span className="metric-label">Match</span>
              <span className="metric-value" style={{ color: result.granted ? 'var(--green)' : 'var(--red)' }}>{result.similarity}%</span>
            </div>
            <div className="metric-row">
              <span className="metric-label">Post-quantum</span>
              <span className="metric-value">ML-KEM-768 ✓</span>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 12, width: '100%', marginTop: 16 }}>
            <button className="btn btn-outline" onClick={() => { setStep('method'); setErr(''); setSelfieB64('') }}>New Request</button>
            <button className="btn btn-outline" onClick={() => nav('/log')}>View Log →</button>
          </div>

          {result.granted ? (
            <button className="btn btn-outline" style={{ marginTop: 12 }} onClick={() => nav('/')}>Done</button>
          ) : (
            <button className="btn btn-outline" style={{ marginTop: 12 }} onClick={() => setStep('selfie')}>Try Again</button>
          )}

          {/* keep selfie in memory for potential future audit (not stored) */}
          <div style={{ display: 'none' }}>{selfieB64.length}</div>
        </>
      )}
    </div>
  )
}
