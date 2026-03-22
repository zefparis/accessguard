import { useMemo, useState } from 'react'
import QRCode from 'qrcode'

type Payload = {
  site: string
  zone: string
  access_point: string
}

export function QRGenerator() {
  const [form, setForm] = useState<Payload>({ site: '', zone: '', access_point: '' })
  const [dataUrl, setDataUrl] = useState<string | null>(null)
  const [err, setErr] = useState<string>('')

  const payloadJson = useMemo(() => JSON.stringify(form, null, 2), [form])

  async function generate() {
    setErr('')
    setDataUrl(null)
    if (!form.site || !form.zone || !form.access_point) {
      setErr('Please fill Site, Zone and Access point.')
      return
    }
    try {
      const url = await QRCode.toDataURL(payloadJson, {
        errorCorrectionLevel: 'M',
        margin: 1,
        scale: 10,
        color: { dark: '#0b1220', light: '#ffffff' },
      })
      setDataUrl(url)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'QR generation failed')
    }
  }

  function download() {
    if (!dataUrl) return
    const a = document.createElement('a')
    a.href = dataUrl
    a.download = `accessguard_${form.site}_${form.zone}_${form.access_point}`.replace(/\s+/g, '_') + '.png'
    a.click()
  }

  function printQr() {
    if (!dataUrl) return
    const w = window.open('', '_blank', 'noopener,noreferrer,width=800,height=900')
    if (!w) return
    w.document.open()
    w.document.write(`<!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <title>ACCESSGUARD QR</title>
          <style>
            body { font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; padding: 24px; }
            h1 { margin: 0 0 6px; }
            .muted { color:#475569; margin: 0 0 16px; }
            img { width: 360px; max-width: 100%; border: 1px solid #e2e8f0; border-radius: 12px; padding: 12px; }
            pre { white-space: pre-wrap; background:#f1f5f9; border: 1px solid #e2e8f0; border-radius: 12px; padding: 12px; }
          </style>
        </head>
        <body>
          <h1>ACCESSGUARD — Site QR</h1>
          <p class="muted">Print this QR and place it at the access point.</p>
          <img src="${dataUrl}" />
          <h2 style="margin-top:18px; font-size:16px;">Payload</h2>
          <pre>${payloadJson.replace(/</g, '&lt;')}</pre>
          <script>window.print()</script>
        </body>
      </html>`)
    w.document.close()
  }

  function field<K extends keyof Payload>(key: K) {
    return (e: React.ChangeEvent<HTMLInputElement>) => setForm(v => ({ ...v, [key]: e.target.value }))
  }

  return (
    <div style={{ width: '100%' }}>
      <div className="card" style={{ width: '100%', marginTop: 16 }}>
        <div className="field">
          <label>Site name</label>
          <input value={form.site} onChange={field('site')} placeholder="Mine Site A" />
        </div>
        <div className="field">
          <label>Zone</label>
          <input value={form.zone} onChange={field('zone')} placeholder="Zone B — Restricted" />
        </div>
        <div className="field">
          <label>Access point</label>
          <input value={form.access_point} onChange={field('access_point')} placeholder="Gate 3" />
        </div>
        {err && <div style={{ color: 'var(--red)', fontSize: 13, marginBottom: 10 }}>{err}</div>}
        <button className="btn btn-primary" onClick={generate}>Generate QR</button>

        {dataUrl && (
          <div style={{ marginTop: 16 }}>
            <img src={dataUrl} alt="QR" style={{ width: '100%', borderRadius: 12, border: '1px solid var(--border)' }} />
            <div style={{ display: 'flex', gap: 12, marginTop: 12 }}>
              <button className="btn btn-outline" onClick={download}>Download QR</button>
              <button className="btn btn-outline" onClick={printQr}>Print QR</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
