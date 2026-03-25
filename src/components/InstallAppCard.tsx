import { useEffect, useMemo, useState } from 'react'

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

type Props = {
  appName: string
  badgeClassName: string
}

type NavigatorWithStandalone = Navigator & {
  standalone?: boolean
}

type MediaQueryListWithLegacyListeners = MediaQueryList & {
  addListener?: (listener: (event: MediaQueryListEvent) => void) => void
  removeListener?: (listener: (event: MediaQueryListEvent) => void) => void
}

function isStandaloneMode() {
  return window.matchMedia('(display-mode: standalone)').matches || Boolean((window.navigator as NavigatorWithStandalone).standalone)
}

export function InstallAppCard({ appName, badgeClassName }: Props) {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [installed, setInstalled] = useState(false)

  const userAgent = useMemo(() => navigator.userAgent.toLowerCase(), [])
  const isIos = useMemo(() => /iphone|ipad|ipod/.test(userAgent), [userAgent])
  const isSafari = useMemo(() => isIos && /safari/.test(userAgent) && !/crios|fxios|edgios/.test(userAgent), [isIos, userAgent])

  useEffect(() => {
    setInstalled(isStandaloneMode())

    const mediaQuery = window.matchMedia('(display-mode: standalone)') as MediaQueryListWithLegacyListeners
    const handleDisplayModeChange = () => setInstalled(isStandaloneMode())
    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault()
      setDeferredPrompt(event as BeforeInstallPromptEvent)
    }
    const handleAppInstalled = () => {
      setInstalled(true)
      setDeferredPrompt(null)
    }

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', handleDisplayModeChange)
    } else {
      mediaQuery.addListener?.(handleDisplayModeChange)
    }
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
    window.addEventListener('appinstalled', handleAppInstalled)

    return () => {
      if (typeof mediaQuery.removeEventListener === 'function') {
        mediaQuery.removeEventListener('change', handleDisplayModeChange)
      } else {
        mediaQuery.removeListener?.(handleDisplayModeChange)
      }
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
      window.removeEventListener('appinstalled', handleAppInstalled)
    }
  }, [])

  async function handleInstall() {
    if (!deferredPrompt) {
      return
    }

    await deferredPrompt.prompt()
    const choice = await deferredPrompt.userChoice
    if (choice.outcome === 'accepted') {
      setInstalled(true)
    }
    setDeferredPrompt(null)
  }

  return (
    <div className="card" style={{ width: '100%', marginTop: 18 }}>
      <div className={badgeClassName}>{installed ? 'Installed' : 'Install on phone'}</div>
      <h2 style={{ fontSize: 18, marginTop: 10, marginBottom: 6 }}>{appName} mobile app</h2>
      <p style={{ fontSize: 13, color: 'var(--grey)', lineHeight: 1.6, marginBottom: 0 }}>
        Install this module on your phone for faster launch, full-screen access and an iPhone-friendly home screen shortcut.
      </p>

      {installed ? (
        <p style={{ fontSize: 13, color: 'var(--green)', lineHeight: 1.6, marginTop: 12, marginBottom: 0 }}>
          This app is already installed on this device. You can open it directly from the home screen.
        </p>
      ) : deferredPrompt ? (
        <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <button className="btn btn-primary" onClick={() => void handleInstall()}>
            Install {appName}
          </button>
          <p style={{ fontSize: 12, color: 'var(--grey)', lineHeight: 1.6, margin: 0 }}>
            If you are on iPhone and no install popup appears, open this page in Safari and use Share then Add to Home Screen.
          </p>
        </div>
      ) : isIos ? (
        <div style={{ marginTop: 14, display: 'grid', gap: 8 }}>
          <div className="metric-row">
            <span className="metric-label">Step 1</span>
            <span className="metric-value">{isSafari ? 'Tap the Share button in Safari' : 'Open this page in Safari'}</span>
          </div>
          <div className="metric-row">
            <span className="metric-label">Step 2</span>
            <span className="metric-value">Tap Add to Home Screen</span>
          </div>
          <div className="metric-row">
            <span className="metric-label">Step 3</span>
            <span className="metric-value">Launch {appName} from your iPhone home screen</span>
          </div>
        </div>
      ) : (
        <p style={{ fontSize: 13, color: 'var(--grey)', lineHeight: 1.6, marginTop: 12, marginBottom: 0 }}>
          Open this module on your phone to install it. Supported browsers may show an install prompt automatically.
        </p>
      )}
    </div>
  )
}
