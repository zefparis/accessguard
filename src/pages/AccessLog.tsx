import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { clearAccessLog, getTodayAccessLog } from '../services/accessLog'

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' })
}

function toCsv(rows: ReturnType<typeof getTodayAccessLog>): string {
  const header = ['time', 'first_name', 'last_name', 'site', 'zone', 'access_point', 'status', 'similarity']
  const lines = [header.join(',')]
  for (const r of rows) {
    const status = r.granted ? 'GRANTED' : 'DENIED'
    const values = [
      fmtTime(r.at),
      r.first_name,
      r.last_name,
      r.site,
      r.zone,
      r.access_point,
      status,
      String(r.similarity),
    ].map(v => `"${String(v).replace(/"/g, '""')}"`)
    lines.push(values.join(','))
  }
  return lines.join('\n')
}

export function AccessLog() {
  const nav = useNavigate()
  const [tick, setTick] = useState(0)

  const rows = useMemo(() => {
    void tick
    return getTodayAccessLog()
  }, [tick])

  const stats = useMemo(() => {
    const total = rows.length
    const granted = rows.filter(r => r.granted).length
    const denied = total - granted
    const last = rows[0]
    return { total, granted, denied, last }
  }, [rows])

  function handleClear() {
    clearAccessLog()
    setTick(t => t + 1)
  }

  function handleExport() {
    const csv = toCsv(rows)
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `accessguard_log_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="page">
      <div className="logo" style={{ cursor: 'pointer' }} onClick={() => nav('/')}>← ACCESSGUARD</div>
      <div className="badge badge-cyan">Access Log</div>
      <h1 className="step-title">Today's Access Events</h1>
      <p className="step-sub">Stored locally (air-gap / offline ready).</p>

      <div className="card" style={{ width: '100%', marginTop: 8 }}>
        <div className="metric-row">
          <span className="metric-label">Total attempts</span>
          <span className="metric-value">{stats.total}</span>
        </div>
        <div className="metric-row">
          <span className="metric-label">Granted</span>
          <span className="metric-value" style={{ color: 'var(--green)' }}>{stats.granted}</span>
        </div>
        <div className="metric-row">
          <span className="metric-label">Denied</span>
          <span className="metric-value" style={{ color: 'var(--red)' }}>{stats.denied}</span>
        </div>
        <div className="metric-row">
          <span className="metric-label">Last access</span>
          <span className="metric-value">{stats.last ? fmtTime(stats.last.at) : '—'}</span>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12, width: '100%', marginTop: 12 }}>
        <button className="btn btn-outline" onClick={handleClear}>Clear Log</button>
        <button className="btn btn-outline" onClick={handleExport} disabled={rows.length === 0}>Export CSV</button>
      </div>

      <div className="card" style={{ width: '100%', marginTop: 16, padding: 16 }}>
        <div style={{ fontSize: 12, color: 'var(--grey)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          Events
        </div>

        {rows.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--grey)' }}>No access attempts today.</div>
        ) : (
          rows.map((r, idx) => (
            <div key={idx} style={{ padding: '10px 0', borderBottom: idx === rows.length - 1 ? 'none' : '1px solid var(--border)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                <div style={{ fontWeight: 800 }}>
                  {r.granted ? (
                    <span style={{ color: 'var(--green)' }}>GRANTED</span>
                  ) : (
                    <span style={{ color: 'var(--red)' }}>DENIED</span>
                  )}
                </div>
                <div style={{ fontSize: 12, color: 'var(--grey)' }}>{fmtTime(r.at)}</div>
              </div>
              <div style={{ fontSize: 12, color: 'var(--grey)', marginTop: 2, lineHeight: 1.5 }}>
                <div><b style={{ color: 'var(--white)' }}>{r.first_name} {r.last_name}</b> — {r.zone}</div>
                <div>Point: {r.access_point} · Match: <span style={{ color: r.granted ? 'var(--green)' : 'var(--red)' }}>{r.similarity}%</span></div>
              </div>
            </div>
          ))
        )}
      </div>

      <button className="btn btn-outline" style={{ marginTop: 16 }} onClick={() => nav('/')}>Back Home</button>
    </div>
  )
}
