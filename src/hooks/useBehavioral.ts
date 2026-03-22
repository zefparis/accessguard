import { useCallback, useMemo, useRef, useState } from 'react'

export type DeviceType = 'mobile' | 'desktop' | 'unknown'

export type BehavioralProfile = {
  device: {
    device_type: DeviceType
    user_agent: string
    language: string
    languages: string[]
    timezone_offset_min: number
    touch_capable: boolean
    hardware_concurrency?: number
    screen: {
      width: number
      height: number
      device_pixel_ratio: number
    }
  }
  permissions: {
    motion: 'granted' | 'denied' | 'prompt' | 'unsupported'
    orientation: 'granted' | 'denied' | 'prompt' | 'unsupported'
  }
  session: {
    started_at_ms: number
    ended_at_ms: number
    duration_ms: number
  }
  motion: {
    samples: number
    interval_ms_mean: number
    accel_gravity: VecStats
    rotation_rate: VecStats
  }
  orientation: {
    samples: number
    alpha_beta_gamma: VecStats
  }
  touch: {
    pointer_down: number
    pointer_move: number
    pointer_up: number
    taps: number
    tap_duration_ms_mean: number
    inter_tap_ms_mean: number
    move_speed_px_per_ms_mean: number
    move_path_len_px_mean: number
  }
}

export type BehavioralController = {
  start: () => Promise<void>
  stop: () => BehavioralProfile
  isCapturing: boolean
}

type VecStats = {
  mean: [number, number, number]
  std: [number, number, number]
  mag_mean: number
  mag_std: number
}

function isTouchCapable(): boolean {
  // navigator.maxTouchPoints is the most reliable modern signal
  const nav = navigator as Navigator & { maxTouchPoints?: number }
  return (nav.maxTouchPoints ?? 0) > 0 || 'ontouchstart' in window
}

function inferDeviceType(): DeviceType {
  const touch = isTouchCapable()
  const smallScreen = Math.min(window.screen.width, window.screen.height) <= 820
  if (touch && smallScreen) return 'mobile'
  if (!touch && !smallScreen) return 'desktop'
  return touch ? 'mobile' : 'unknown'
}

type RunningVec = {
  n: number
  mean: [number, number, number]
  m2: [number, number, number]
  mag_mean: number
  mag_m2: number
}

function createRunningVec(): RunningVec {
  return {
    n: 0,
    mean: [0, 0, 0],
    m2: [0, 0, 0],
    mag_mean: 0,
    mag_m2: 0,
  }
}

function updateRunningVec(stats: RunningVec, x: number, y: number, z: number) {
  stats.n += 1
  const v: [number, number, number] = [x, y, z]
  for (let i = 0; i < 3; i += 1) {
    const delta = v[i] - stats.mean[i]
    stats.mean[i] += delta / stats.n
    const delta2 = v[i] - stats.mean[i]
    stats.m2[i] += delta * delta2
  }
  const mag = Math.sqrt(x * x + y * y + z * z)
  const dMag = mag - stats.mag_mean
  stats.mag_mean += dMag / stats.n
  const dMag2 = mag - stats.mag_mean
  stats.mag_m2 += dMag * dMag2
}

function finalizeRunningVec(stats: RunningVec): VecStats {
  const denom = Math.max(1, stats.n - 1)
  const std: [number, number, number] = [
    Math.sqrt(stats.m2[0] / denom),
    Math.sqrt(stats.m2[1] / denom),
    Math.sqrt(stats.m2[2] / denom),
  ]
  return {
    mean: stats.mean,
    std,
    mag_mean: stats.mag_mean,
    mag_std: Math.sqrt(stats.mag_m2 / denom),
  }
}

async function requestPermissionIfNeeded(
  kind: 'motion' | 'orientation'
): Promise<'granted' | 'denied' | 'prompt' | 'unsupported'> {
  // iOS 13+: requestPermission exists and must be called from a user gesture.
  // In our flow we start on mount; the call can fail — we treat it as "prompt".
  try {
    if (kind === 'motion') {
      const anyDM = DeviceMotionEvent as unknown as { requestPermission?: () => Promise<'granted' | 'denied'> }
      if (!anyDM.requestPermission) return 'unsupported'
      const res = await anyDM.requestPermission()
      return res
    }

    const anyDO = DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<'granted' | 'denied'> }
    if (!anyDO.requestPermission) return 'unsupported'
    const res = await anyDO.requestPermission()
    return res
  } catch {
    return 'prompt'
  }
}

export function useBehavioral(): BehavioralController {
  const [isCapturing, setIsCapturing] = useState(false)

  const startedAtRef = useRef<number | null>(null)
  const endedAtRef = useRef<number | null>(null)
  const stoppedProfileRef = useRef<BehavioralProfile | null>(null)

  const motionVecRef = useRef<RunningVec>(createRunningVec())
  const gyroVecRef = useRef<RunningVec>(createRunningVec())
  const orientVecRef = useRef<RunningVec>(createRunningVec())

  const motionSamplesRef = useRef(0)
  const orientSamplesRef = useRef(0)

  const motionLastTsRef = useRef<number | null>(null)
  const motionIntervalSumRef = useRef(0)

  const touchRef = useRef({
    pointerDown: 0,
    pointerMove: 0,
    pointerUp: 0,
    taps: 0,
    tapDurSum: 0,
    interTapSum: 0,
    interTapN: 0,
    moveSpeedSum: 0,
    moveSpeedN: 0,
    movePathSum: 0,
    movePathN: 0,

    active: new Map<number, { x: number; y: number; t: number; path: number }>(),
    lastTapUpTs: null as number | null,
  })

  const permissionsRef = useRef<BehavioralProfile['permissions']>({
    motion: 'unsupported',
    orientation: 'unsupported',
  })

  const cleanupRef = useRef<(() => void) | null>(null)

  const stop = useCallback((): BehavioralProfile => {
    if (stoppedProfileRef.current) return stoppedProfileRef.current

    if (cleanupRef.current) cleanupRef.current()
    cleanupRef.current = null

    endedAtRef.current = performance.now()
    setIsCapturing(false)

    const startedAt = startedAtRef.current ?? endedAtRef.current
    const endedAt = endedAtRef.current ?? startedAt
    const duration = Math.max(0, endedAt - startedAt)

    const motionSamples = motionSamplesRef.current
    const orientSamples = orientSamplesRef.current
    const intervalMean = motionSamples > 1
      ? motionIntervalSumRef.current / Math.max(1, motionSamples - 1)
      : 0

    const t = touchRef.current
    const tapDurMean = t.taps ? t.tapDurSum / t.taps : 0
    const interTapMean = t.interTapN ? t.interTapSum / t.interTapN : 0
    const moveSpeedMean = t.moveSpeedN ? t.moveSpeedSum / t.moveSpeedN : 0
    const movePathMean = t.movePathN ? t.movePathSum / t.movePathN : 0

    const profile: BehavioralProfile = {
      device: {
        device_type: inferDeviceType(),
        user_agent: navigator.userAgent,
        language: navigator.language,
        languages: Array.from(navigator.languages ?? []),
        timezone_offset_min: new Date().getTimezoneOffset(),
        touch_capable: isTouchCapable(),
        hardware_concurrency: navigator.hardwareConcurrency,
        screen: {
          width: window.screen.width,
          height: window.screen.height,
          device_pixel_ratio: window.devicePixelRatio || 1,
        },
      },
      permissions: permissionsRef.current,
      session: {
        started_at_ms: startedAt,
        ended_at_ms: endedAt,
        duration_ms: duration,
      },
      motion: {
        samples: motionSamples,
        interval_ms_mean: intervalMean,
        accel_gravity: finalizeRunningVec(motionVecRef.current),
        rotation_rate: finalizeRunningVec(gyroVecRef.current),
      },
      orientation: {
        samples: orientSamples,
        alpha_beta_gamma: finalizeRunningVec(orientVecRef.current),
      },
      touch: {
        pointer_down: t.pointerDown,
        pointer_move: t.pointerMove,
        pointer_up: t.pointerUp,
        taps: t.taps,
        tap_duration_ms_mean: tapDurMean,
        inter_tap_ms_mean: interTapMean,
        move_speed_px_per_ms_mean: moveSpeedMean,
        move_path_len_px_mean: movePathMean,
      },
    }

    stoppedProfileRef.current = profile
    return profile
  }, [])

  const start = useCallback(async () => {
    if (isCapturing) return
    stoppedProfileRef.current = null

    // reset accumulators
    startedAtRef.current = performance.now()
    endedAtRef.current = null
    motionVecRef.current = createRunningVec()
    gyroVecRef.current = createRunningVec()
    orientVecRef.current = createRunningVec()
    motionSamplesRef.current = 0
    orientSamplesRef.current = 0
    motionLastTsRef.current = null
    motionIntervalSumRef.current = 0
    touchRef.current.pointerDown = 0
    touchRef.current.pointerMove = 0
    touchRef.current.pointerUp = 0
    touchRef.current.taps = 0
    touchRef.current.tapDurSum = 0
    touchRef.current.interTapSum = 0
    touchRef.current.interTapN = 0
    touchRef.current.moveSpeedSum = 0
    touchRef.current.moveSpeedN = 0
    touchRef.current.movePathSum = 0
    touchRef.current.movePathN = 0
    touchRef.current.active.clear()
    touchRef.current.lastTapUpTs = null

    setIsCapturing(true)

    // We try to request permissions, but this can fail if not initiated by gesture.
    permissionsRef.current = {
      motion: await requestPermissionIfNeeded('motion'),
      orientation: await requestPermissionIfNeeded('orientation'),
    }

    const onMotion = (e: DeviceMotionEvent) => {
      // accelerationIncludingGravity is more widely supported
      const a = e.accelerationIncludingGravity
      const r = e.rotationRate
      if (a) updateRunningVec(motionVecRef.current, a.x ?? 0, a.y ?? 0, a.z ?? 0)
      if (r) updateRunningVec(gyroVecRef.current, r.alpha ?? 0, r.beta ?? 0, r.gamma ?? 0)

      const now = performance.now()
      if (motionLastTsRef.current !== null) motionIntervalSumRef.current += (now - motionLastTsRef.current)
      motionLastTsRef.current = now
      motionSamplesRef.current += 1
    }

    const onOrientation = (e: DeviceOrientationEvent) => {
      updateRunningVec(orientVecRef.current, e.alpha ?? 0, e.beta ?? 0, e.gamma ?? 0)
      orientSamplesRef.current += 1
    }

    const onPointerDown = (e: PointerEvent) => {
      const t = touchRef.current
      t.pointerDown += 1
      t.active.set(e.pointerId, { x: e.clientX, y: e.clientY, t: performance.now(), path: 0 })
    }
    const onPointerMove = (e: PointerEvent) => {
      const t = touchRef.current
      t.pointerMove += 1
      const cur = t.active.get(e.pointerId)
      if (!cur) return
      const now = performance.now()
      const dx = e.clientX - cur.x
      const dy = e.clientY - cur.y
      const dist = Math.sqrt(dx * dx + dy * dy)
      const dt = Math.max(1, now - cur.t)
      cur.path += dist

      t.moveSpeedSum += dist / dt
      t.moveSpeedN += 1

      cur.x = e.clientX
      cur.y = e.clientY
      cur.t = now
      t.active.set(e.pointerId, cur)
    }
    const onPointerUpOrCancel = (e: PointerEvent) => {
      const t = touchRef.current
      t.pointerUp += 1

      const cur = t.active.get(e.pointerId)
      if (!cur) return
      t.active.delete(e.pointerId)

      const now = performance.now()
      const dur = Math.max(0, now - cur.t)
      // consider as tap if short and small travel
      const isTap = cur.path <= 12
      if (isTap) {
        t.taps += 1
        t.tapDurSum += dur
        if (t.lastTapUpTs !== null) {
          t.interTapSum += (now - t.lastTapUpTs)
          t.interTapN += 1
        }
        t.lastTapUpTs = now
      }

      t.movePathSum += cur.path
      t.movePathN += 1
    }

    window.addEventListener('devicemotion', onMotion, { passive: true })
    window.addEventListener('deviceorientation', onOrientation, { passive: true })

    window.addEventListener('pointerdown', onPointerDown, { passive: true })
    window.addEventListener('pointermove', onPointerMove, { passive: true })
    window.addEventListener('pointerup', onPointerUpOrCancel, { passive: true })
    window.addEventListener('pointercancel', onPointerUpOrCancel, { passive: true })

    cleanupRef.current = () => {
      window.removeEventListener('devicemotion', onMotion)
      window.removeEventListener('deviceorientation', onOrientation)

      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUpOrCancel)
      window.removeEventListener('pointercancel', onPointerUpOrCancel)
    }
  }, [isCapturing])

  return useMemo(() => ({ start, stop, isCapturing }), [isCapturing, start, stop])
}
