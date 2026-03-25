import { useRef, useCallback, useEffect, useState } from 'react'

export function useCamera() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [isInitializing, setIsInitializing] = useState(true)

  useEffect(() => {
    let active = true
    async function start() {
      try {
        setIsInitializing(true)
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }
        })
        if (!active) { stream.getTracks().forEach(t => t.stop()); return }
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          videoRef.current.onloadedmetadata = () => {
            videoRef.current?.play()
            // Wait for 2 seconds of loading sequence before marking as ready
            setTimeout(() => {
              if (active) {
                setReady(true)
                setIsInitializing(false)
              }
            }, 2000)
          }
        }
      } catch {
        setError('Camera access denied. Please allow camera in browser settings.')
        setIsInitializing(false)
      }
    }
    start()
    return () => {
      active = false
      streamRef.current?.getTracks().forEach(t => t.stop())
    }
  }, [])

  const capture = useCallback((): string | null => {
    const video = videoRef.current
    if (!video || !ready) return null
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth || 640
    canvas.height = video.videoHeight || 480
    canvas.getContext('2d')?.drawImage(video, 0, 0)
    return canvas.toDataURL('image/jpeg', 0.92)
  }, [ready])

  return { videoRef, ready, error, capture, isInitializing }
}
