export type AccessLogEntry = {
  at: number
  first_name: string
  last_name: string
  site: string
  zone: string
  access_point: string
  granted: boolean
  similarity: number
}

const LS_KEY = 'accessguard-access-log'

// Supabase (future backend)
// -- CREATE TABLE IF NOT EXISTS access_logs (
// --   id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
// --   tenant_id TEXT,
// --   student_id TEXT,
// --   first_name TEXT,
// --   site TEXT,
// --   zone TEXT,
// --   access_point TEXT,
// --   granted BOOLEAN,
// --   similarity FLOAT,
// --   accessed_at TIMESTAMPTZ DEFAULT now()
// -- );

export function loadAccessLog(): AccessLogEntry[] {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed as AccessLogEntry[]
  } catch {
    return []
  }
}

export function saveAccessLog(entries: AccessLogEntry[]) {
  localStorage.setItem(LS_KEY, JSON.stringify(entries))
}

export function addAccessLogEntry(entry: AccessLogEntry) {
  const prev = loadAccessLog()
  // keep last 200 entries
  const next = [entry, ...prev].slice(0, 200)
  saveAccessLog(next)
}

export function clearAccessLog() {
  localStorage.removeItem(LS_KEY)
}

export function getTodayAccessLog(): AccessLogEntry[] {
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  const startMs = start.getTime()
  return loadAccessLog().filter(e => e.at >= startMs)
}
