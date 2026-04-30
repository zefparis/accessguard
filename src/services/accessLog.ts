export type AccessLogEntry = {
  at: number
  first_name: string
  last_name: string
  site: string
  zone: string
  access_point: string
  granted: boolean
  similarity: number
  synced?: boolean
}

const LS_KEY = 'accessguard-access-log'
const PENDING_KEY = 'accessguard-pending-sync'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
const TENANT_ID = import.meta.env.VITE_TENANT_ID as string | undefined

// ────────────────────────────────────────────────────────────────
// localStorage persistence
// ────────────────────────────────────────────────────────────────

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
  const next = [entry, ...prev].slice(0, 200)
  saveAccessLog(next)

  // Fire-and-forget Supabase sync
  pushToSupabase(entry)
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

// ────────────────────────────────────────────────────────────────
// Supabase online sync (fire-and-forget)
// ────────────────────────────────────────────────────────────────

function pushToSupabase(entry: AccessLogEntry): void {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    addPending(entry)
    return
  }

  const payload = {
    tenant_id: TENANT_ID ?? 'accessguard-demo',
    first_name: entry.first_name,
    last_name: entry.last_name,
    site: entry.site,
    zone: entry.zone,
    access_point: entry.access_point,
    granted: entry.granted,
    similarity: entry.similarity,
    accessed_at: new Date(entry.at).toISOString(),
  }

  fetch(`${SUPABASE_URL}/rest/v1/access_logs`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(payload),
  })
    .then((res) => {
      if (!res.ok) addPending(entry)
    })
    .catch(() => {
      addPending(entry)
    })
}

// ────────────────────────────────────────────────────────────────
// Offline queue — replay when back online
// ────────────────────────────────────────────────────────────────

function addPending(entry: AccessLogEntry): void {
  try {
    const raw = localStorage.getItem(PENDING_KEY)
    const pending: AccessLogEntry[] = raw ? JSON.parse(raw) : []
    pending.push(entry)
    localStorage.setItem(PENDING_KEY, JSON.stringify(pending.slice(-100)))
  } catch { /* quota exceeded — drop */ }
}

export function syncPendingLogs(): void {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return
  try {
    const raw = localStorage.getItem(PENDING_KEY)
    if (!raw) return
    const pending: AccessLogEntry[] = JSON.parse(raw)
    if (pending.length === 0) return

    localStorage.removeItem(PENDING_KEY)

    for (const entry of pending) {
      pushToSupabase(entry)
    }
  } catch { /* ignore */ }
}

// Auto-sync when coming back online
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => syncPendingLogs())
}
