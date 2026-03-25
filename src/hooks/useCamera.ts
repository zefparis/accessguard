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
          video: { facingMode: 'user', width: 640, height: 480 }
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
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(video, 0, 0)
    
    // Basic face detection check (center region should have content)
    const imageData = ctx.getImageData(canvas.width * 0.3, canvas.height * 0.3, canvas.width * 0.4, canvas.height * 0.4)
    const pixels = imageData.data
    let brightness = 0
    for (let i = 0; i < pixels.length; i += 4) {
      brightness += (pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3
    }
    const avgBrightness = brightness / (pixels.length / 4)
    
    // If center region is too dark or too bright, likely no face
    if (avgBrightness < 20 || avgBrightness > 240) {
      console.warn('No face detected in center region')
    }
    
    return canvas.toDataURL('image/jpeg', 0.9)
  }, [ready])

  return { videoRef, ready, error, capture, isInitializing }
}
