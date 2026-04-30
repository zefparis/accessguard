import { memo, useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { SelfieCapture } from '../components/SelfieCapture'
import { QRScanner, type AccessQrPayload } from '../components/QRScanner'
import {
  lookupEnrollment,
  sendAuthAccessSignals,
  verifyWorker,
  vocalVerify,
} from '../services/api'
import { addAccessLogEntry } from '../services/accessLog'
import { useAccessGuardStore } from '../store/accessguardStore'
import { useVoiceBiometrics } from '../hooks/useVoiceBiometrics'
import {
  useBehavioral,
  requestMotionPermission,
  type BehavioralProfile,
} from '../hooks/useBehavioral'

const MAX_ATTEMPTS = 3
const VOCAL_RECORD_MS = 3000
const VOCAL_COUNTDOWN_SEC = 3

type Step =
  | 'method'
  | 'qr'
  | 'manual'
  | 'not-enrolled'
  | 'selfie'
  | 'vocal'
  | 'computing'
  | 'decision'

type VocalPhase = 'idle' | 'countdown' | 'recording' | 'processing' | 'done'

type Decision = 'APPROVED' | 'REVIEW' | 'REJECTED' | 'MANUAL_REVIEW'

type AccessForm = {
  firstName: string
  lastName: string
  site: string
  zone: string
  access_point: string
}

const sigmoid = (v: number, mid: number) =>
  1 / (1 + Math.exp(-3 * (v - mid) / mid))

function behavioralScoreFromProfile(p: BehavioralProfile): number {
  const scores: number[] = []

  const gyroStd = p.motion.rotation_rate?.mag_std
  if (gyroStd !== undefined && gyroStd > 0) {
    scores.push(sigmoid(gyroStd, 1.0))
  }

  const accelStd = p.motion.accel_gravity?.mag_std
  if (accelStd !== undefined && accelStd > 0) {
    scores.push(sigmoid(accelStd, 10.0))
  }

  const tapInterMean = p.touch.inter_tap_ms_mean
  const tapDurMean = p.touch.tap_duration_ms_mean
  if (tapInterMean > 0 && tapDurMean > 0) {
    const tapCV = tapInterMean / Math.max(1, tapDurMean)
    scores.push(sigmoid(tapCV, 2.0))
  }

  if (scores.length === 0) {
    return p.device.touch_capable ? 0.4 : 0.2
  }

  return scores.reduce((a, b) => a + b, 0) / scores.length
}

const COPY: Record<Decision, { title: string; sub: string }> = {
  APPROVED: {
    title: 'Access Granted',
    sub: 'You may proceed. Valid for 8 hours.',
  },
  REVIEW: {
    title: 'Pending Verification',
    sub: 'A security agent will validate this request shortly.',
  },
  REJECTED: {
    title: 'Access Denied',
    sub: 'Verification failed — please try again or contact security.',
  },
  MANUAL_REVIEW: {
    title: 'Sent for Manual Review',
    sub: 'A security agent will contact you to complete authentication.',
  },
}

const TONE: Record<Decision, { color: string; bg: string; border: string; glyph: string }> = {
  APPROVED:      { color: '#16a34a', bg: 'rgba(34,197,94,0.10)',  border: 'rgba(34,197,94,0.45)',  glyph: '✔' },
  REVIEW:        { color: '#f59e0b', bg: 'rgba(245,158,11,0.10)', border: 'rgba(245,158,11,0.45)', glyph: '!' },
  REJECTED:      { color: '#ef4444', bg: 'rgba(239,68,68,0.10)',  border: 'rgba(239,68,68,0.45)',  glyph: '×' },
  MANUAL_REVIEW: { color: '#f59e0b', bg: 'rgba(245,158,11,0.10)', border: 'rgba(245,158,11,0.45)', glyph: '⏳' },
}

type ManualEntryFormProps = {
  err: string
  form: AccessForm
  lookupBusy: boolean
  onSubmit: (e: FormEvent) => void
  onFirstNameChange: (e: ChangeEvent<HTMLInputElement>) => void
  onLastNameChange: (e: ChangeEvent<HTMLInputElement>) => void
  onZoneChange: (e: ChangeEvent<HTMLInputElement>) => void
  onAccessPointChange: (e: ChangeEvent<HTMLInputElement>) => void
  onBack: () => void
}

const ManualEntryForm = memo(function ManualEntryForm({
  err,
  form,
  lookupBusy,
  onSubmit,
  onFirstNameChange,
  onLastNameChange,
  onZoneChange,
  onAccessPointChange,
  onBack,
}: ManualEntryFormProps) {
  return (
    <>
      <div className="badge badge-cyan">Step 1 — Identity</div>
      <h1 className="step-title">Manual Entry</h1>
      <p className="step-sub">Enter name and site/zone.</p>
      <form onSubmit={onSubmit} style={{ width: '100%' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div className="field">
            <label>First Name</label>
            <input value={form.firstName} onChange={onFirstNameChange} required placeholder="John" />
          </div>
          <div className="field">
            <label>Last Name</label>
            <input value={form.lastName} onChange={onLastNameChange} required placeholder="Smith" />
          </div>
        </div>
        <div className="field">
          <label>Site / Zone</label>
          <input value={form.zone} onChange={onZoneChange} required placeholder="Zone B — Restricted" />
        </div>
        <div className="field">
          <label>Access point (optional)</label>
          <input value={form.access_point} onChange={onAccessPointChange} placeholder="Gate 3" />
        </div>
        {err && <div style={{ color: 'var(--red)', fontSize: 13, marginBottom: 10 }}>{err}</div>}
        <button className="btn btn-primary" type="submit" disabled={lookupBusy}>
          {lookupBusy ? 'Looking up...' : 'Continue →'}
        </button>
      </form>
      <button className="btn btn-outline" style={{ marginTop: 12 }} onClick={onBack}>Back</button>
    </>
  )
})

export function AccessRequest() {
  const nav = useNavigate()
  const { worker } = useAccessGuardStore()

  const [step, setStep] = useState<Step>('method')
  const [err, setErr] = useState('')
  const [studentId, setStudentId] = useState<string | null>(null)
  const [vocalQuality, setVocalQuality] = useState<number | null>(null)
  const [vocalError, setVocalError] = useState('')
  const [vocalPhase, setVocalPhase] = useState<VocalPhase>('idle')
  const [vocalCountdown, setVocalCountdown] = useState(VOCAL_COUNTDOWN_SEC)
  const [lookupBusy, setLookupBusy] = useState(false)
  const [attempts, setAttempts] = useState(0)
  const [decision, setDecision] = useState<Decision | null>(null)

  const voice = useVoiceBiometrics()
  const behavioral = useBehavioral()
  const vocalEmbeddingRef = useRef<Float32Array | null>(null)

  useEffect(() => {
    return () => {
      try { behavioral.stop() } catch { /* already stopped */ }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const [form, setForm] = useState<AccessForm>({
    firstName: worker?.firstName ?? '',
    lastName: worker?.lastName ?? '',
    site: '',
    zone: worker?.employerSite?.split(' — ')[1] ?? '',
    access_point: '',
  })

  const handleFirstNameChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    setForm(v => ({ ...v, firstName: e.target.value }))
  }, [])

  const handleLastNameChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    setForm(v => ({ ...v, lastName: e.target.value }))
  }, [])

  const handleZoneChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    setForm(v => ({ ...v, zone: e.target.value }))
  }, [])

  const handleAccessPointChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    setForm(v => ({ ...v, access_point: e.target.value }))
  }, [])

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
    // After QR, go to lookup
    doLookup(form.firstName || worker?.firstName || '', form.lastName || worker?.lastName || '')
  }

  async function doLookup(firstName: string, lastName: string) {
    if (!firstName.trim() || !lastName.trim()) {
      // No name yet → go to manual
      setStep('manual')
      return
    }
    setLookupBusy(true)
    setErr('')
    try {
      await requestMotionPermission()
    } catch { /* user denied or unsupported */ }
    try {
      const lookup = await lookupEnrollment({
        first_name: firstName.trim(),
        last_name: lastName.trim(),
      })
      if (!lookup.found) {
        setStep('not-enrolled')
        return
      }
      if (lookup.student_id) setStudentId(lookup.student_id)
      void behavioral.start()
      setStep('selfie')
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Profile lookup failed')
    } finally {
      setLookupBusy(false)
    }
  }

  const beginManual = useCallback(async (e: FormEvent) => {
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
    await doLookup(form.firstName, form.lastName)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.firstName, form.lastName, form.zone])

  const handleSelfie = useCallback(async (b64: string) => {
    setErr('')
    try {
      const res = await verifyWorker({
        selfie_b64: b64,
        first_name: form.firstName,
        last_name: form.lastName,
        student_id: studentId ?? undefined,
      })
      if (res.student_id) setStudentId(res.student_id)
      setStep('vocal')
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Face check failed')
      setStep('method')
    }
  }, [form.firstName, form.lastName, studentId])

  const handleVocal = useCallback(async () => {
    setVocalError('')
    setVocalPhase('countdown')
    setVocalCountdown(VOCAL_COUNTDOWN_SEC)

    // Visual countdown 3-2-1
    for (let i = VOCAL_COUNTDOWN_SEC; i >= 1; i--) {
      setVocalCountdown(i)
      await new Promise(r => setTimeout(r, 1000))
    }

    setVocalPhase('recording')
    let samples: Float32Array
    try {
      samples = await voice.recordAudio(VOCAL_RECORD_MS)
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e)
      console.error('[vocal] recordAudio failed', errMsg)
      setVocalError(errMsg)
      setVocalQuality(0)
      setVocalPhase('idle')
      submitDecision()
      return
    }

    if (!samples || samples.length === 0) {
      console.error('[vocal] recordAudio returned empty buffer')
      setVocalError('Microphone returned empty audio')
      setVocalQuality(0)
      setVocalPhase('idle')
      submitDecision()
      return
    }

    setVocalPhase('processing')
    const embedding = voice.extractMFCC(samples, 16000)
    vocalEmbeddingRef.current = embedding

    try {
      const resp = await vocalVerify({
        first_name: form.firstName,
        last_name: form.lastName,
        vocal_embedding: Array.from(embedding),
      })
      const score = Math.max(0, Math.min(1, resp.vocal_score))
      setVocalQuality(score)
      console.log('[vocal] verify result', { score, reason: resp.reason, samples: samples.length })
    } catch (verifyErr) {
      const errMsg = verifyErr instanceof Error ? verifyErr.message : String(verifyErr)
      console.warn('[vocal-verify] failed', errMsg)
      setVocalQuality(0)
    }

    setVocalPhase('done')
    await new Promise(r => setTimeout(r, 800))
    setVocalPhase('idle')
    submitDecision()
  }, [voice, form.firstName, form.lastName])

  const submitDecision = useCallback(async () => {
    setStep('computing')
    const nextAttempts = attempts + 1
    setAttempts(nextAttempts)

    let behavioralScore = 0
    try {
      const profile = behavioral.stop()
      behavioralScore = behavioralScoreFromProfile(profile)
    } catch {
      behavioralScore = 0
    }

    if (!studentId) {
      setDecision('REVIEW')
      setStep('decision')
      return
    }

    try {
      const result = await sendAuthAccessSignals({
        student_id: studentId,
        vocal_score: vocalQuality ?? 0,
        behavioral_score: behavioralScore,
        reaction_ms: 0,
      })
      let d: Decision = result.decision as Decision
      if (d === 'REJECTED' && nextAttempts >= MAX_ATTEMPTS) {
        d = 'MANUAL_REVIEW'
      }

      // Log locally
      addAccessLogEntry({
        at: Date.now(),
        first_name: form.firstName,
        last_name: form.lastName,
        site: form.site || 'Unknown site',
        zone: form.zone || 'Unknown zone',
        access_point: form.access_point || '—',
        granted: d === 'APPROVED',
        similarity: Math.round((result.detail?.facial ?? 0) * 100),
      })

      setDecision(d)
    } catch {
      // Network failure → REVIEW (never APPROVED without backend)
      setDecision('REVIEW')
    }
    setStep('decision')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempts, studentId, vocalQuality, behavioral, form])

  const retry = useCallback(() => {
    setDecision(null)
    setErr('')
    setVocalQuality(null)
    setVocalError('')
    setVocalPhase('idle')
    vocalEmbeddingRef.current = null
    void behavioral.start()
    setStep('selfie')
  }, [behavioral])

  const restart = useCallback(() => {
    setDecision(null)
    setErr('')
    setAttempts(0)
    setVocalQuality(null)
    setVocalError('')
    setVocalPhase('idle')
    vocalEmbeddingRef.current = null
    setStudentId(null)
    setStep('method')
  }, [])

  const progressPct = useMemo(() => {
    switch (step) {
      case 'method':       return 0
      case 'qr':           return 10
      case 'manual':       return 10
      case 'not-enrolled': return 0
      case 'selfie':       return 35
      case 'vocal':        return 65
      case 'computing':    return 90
      case 'decision':     return 100
    }
  }, [step])

  return (
    <div className="page">
      <div className="logo" style={{ cursor: 'pointer' }} onClick={() => nav('/')}>← ACCESSGUARD</div>

      <div className="progress-bar" style={{ width: '100%', maxWidth: 440 }}>
        <div className="progress-fill" style={{ width: `${progressPct}%` }} />
      </div>

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
        <ManualEntryForm
          err={err}
          form={form}
          lookupBusy={lookupBusy}
          onSubmit={beginManual}
          onFirstNameChange={handleFirstNameChange}
          onLastNameChange={handleLastNameChange}
          onZoneChange={handleZoneChange}
          onAccessPointChange={handleAccessPointChange}
          onBack={() => setStep('method')}
        />
      )}

      {step === 'not-enrolled' && (
        <>
          <div className="badge" style={{ background: 'rgba(239,68,68,0.12)', color: 'var(--red)', border: '1px solid rgba(239,68,68,0.25)', margin: '0 auto 16px' }}>
            No profile found
          </div>
          <h1 className="step-title">
            {form.firstName} {form.lastName} is not enrolled yet.
          </h1>
          <p className="step-sub">
            Please complete enrolment first — we need a registered face and
            voice profile to verify identity before granting access.
          </p>
          <button className="btn btn-primary" onClick={() => nav('/enroll')}>
            Go to enrolment →
          </button>
          <button className="btn btn-outline" style={{ marginTop: 12 }} onClick={() => setStep('method')}>
            Try a different name
          </button>
        </>
      )}

      {step === 'selfie' && (
        <>
          <div className="badge badge-cyan">Step 2 of 3 — Live photo</div>
          <h1 className="step-title">Face Verification</h1>
          <p className="step-sub">
            Center your face in the frame and capture.
          </p>
          <div className="card" style={{ width: '100%', padding: 14, marginTop: 0, marginBottom: 12 }}>
            <div className="metric-row">
              <span className="metric-label">Worker</span>
              <span className="metric-value">{form.firstName} {form.lastName}</span>
            </div>
            <div className="metric-row">
              <span className="metric-label">Zone</span>
              <span className="metric-value">{zoneLabel}</span>
            </div>
          </div>
          <SelfieCapture onCapture={handleSelfie} />
        </>
      )}

      {step === 'vocal' && (
        <>
          <div className="badge badge-cyan">Step 3 of 3 — Voice sample</div>
          <h1 className="step-title">Voice Verification</h1>
          <p className="step-sub">
            Read this sentence aloud when recording starts:
            <br />
            <em style={{ color: 'var(--ink, #fff)' }}>"I confirm my access request."</em>
          </p>
          {vocalError && (
            <div className="card" style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>
              {vocalError} — continuing without voice.
            </div>
          )}

          {vocalPhase === 'idle' && (
            <button
              className="btn btn-primary"
              type="button"
              onClick={handleVocal}
            >
              Start voice sample →
            </button>
          )}

          {vocalPhase === 'countdown' && (
            <div className="card" style={{ textAlign: 'center', padding: '28px 12px' }}>
              <p style={{ fontSize: 12, color: 'var(--grey)', letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 8 }}>
                Get ready...
              </p>
              <p style={{ fontSize: 56, fontWeight: 800, color: 'var(--cyan, #06b6d4)', lineHeight: 1 }}>
                {vocalCountdown}
              </p>
            </div>
          )}

          {vocalPhase === 'recording' && (
            <div className="card" style={{ textAlign: 'center', padding: '20px 12px' }}>
              <p style={{ fontSize: 12, color: 'var(--grey)', letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 8 }}>
                Recording...
              </p>
              <p style={{ fontSize: 28, fontWeight: 800, color: 'var(--cyan, #06b6d4)' }}>
                {(voice.countdownMs / 1000).toFixed(1)}s
              </p>
              {voice.waveform && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 2, height: 40, marginTop: 12 }}>
                  {Array.from({ length: 24 }, (_, i) => {
                    const idx = Math.floor((i / 24) * voice.waveform!.length)
                    const v = Math.abs((voice.waveform![idx] - 128) / 128)
                    return (
                      <div key={i} style={{
                        width: 3, borderRadius: 2, transition: 'height 0.08s',
                        height: Math.max(4, v * 36),
                        background: 'var(--cyan, #06b6d4)', opacity: 0.7 + v * 0.3,
                      }} />
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {vocalPhase === 'processing' && (
            <div className="card" style={{ textAlign: 'center', padding: '28px 12px' }}>
              <p style={{ fontSize: 12, color: 'var(--grey)', letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 8 }}>
                Processing...
              </p>
              <div style={{ fontSize: 28, color: 'var(--cyan, #06b6d4)' }}>⬡</div>
            </div>
          )}

          {vocalPhase === 'done' && (
            <div className="card" style={{ textAlign: 'center', padding: '28px 12px' }}>
              <p style={{ fontSize: 28, fontWeight: 800, color: 'var(--green, #22c55e)' }}>
                Done ✓
              </p>
            </div>
          )}
        </>
      )}

      {step === 'computing' && (
        <>
          <h1 className="step-title">Computing decision...</h1>
          <div style={{ marginTop: 40, color: 'var(--cyan)', fontSize: 48 }}>⬡</div>
        </>
      )}

      {step === 'decision' && decision && (
        <DecisionCard
          decision={decision}
          attempts={attempts}
          form={form}
          onRetry={retry}
          onRestart={restart}
          onViewLog={() => nav('/log')}
        />
      )}
    </div>
  )
}

interface DecisionCardProps {
  decision: Decision
  attempts: number
  form: AccessForm
  onRetry: () => void
  onRestart: () => void
  onViewLog: () => void
}

function DecisionCard({ decision, attempts, form, onRetry, onRestart, onViewLog }: DecisionCardProps) {
  const tone = TONE[decision]
  const copy = COPY[decision]
  const canRetry = decision === 'REJECTED' && attempts < MAX_ATTEMPTS
  const nowLabel = new Date().toLocaleString('en-ZA', { hour: '2-digit', minute: '2-digit', year: 'numeric', month: '2-digit', day: '2-digit' })

  return (
    <div style={{ display: 'grid', gap: 16, width: '100%' }}>
      <div style={{
        borderRadius: 16,
        border: `1px solid ${tone.border}`,
        background: tone.bg,
        padding: '24px 20px',
        textAlign: 'center',
      }}>
        <div style={{
          width: 64, height: 64, borderRadius: '50%',
          background: tone.color, color: '#fff',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 36, fontWeight: 800, margin: '0 auto 12px',
        }}>
          {tone.glyph}
        </div>
        <div style={{
          fontSize: 11, fontWeight: 800, letterSpacing: '0.18em',
          textTransform: 'uppercase', color: tone.color, marginBottom: 8,
        }}>
          {decision.replace('_', ' ')}
        </div>
        <div style={{ fontSize: 20, fontWeight: 800, color: '#fff', marginBottom: 4 }}>
          {copy.title}
        </div>
        <div style={{ fontSize: 13, color: 'var(--grey)', lineHeight: 1.6 }}>
          {copy.sub}
        </div>
      </div>

      {decision === 'APPROVED' && (
        <div className="card" style={{ width: '100%' }}>
          <div className="metric-row">
            <span className="metric-label">Worker</span>
            <span className="metric-value">{form.firstName} {form.lastName}</span>
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
            <span className="metric-label">Post-quantum</span>
            <span className="metric-value">ML-KEM-768 ✓</span>
          </div>
        </div>
      )}

      {canRetry && (
        <button className="btn btn-primary" onClick={onRetry}>
          Try again
        </button>
      )}
      <button className="btn btn-outline" onClick={onViewLog}>
        View Access Log →
      </button>
      <button className="btn btn-outline" onClick={onRestart}>
        New Request
      </button>
    </div>
  )
}
