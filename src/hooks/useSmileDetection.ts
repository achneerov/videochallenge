import * as faceapi from '@vladmandic/face-api'
import { useCallback, useEffect, useRef, useState } from 'react'
import { FACE_API_MODEL_URL } from '../lib/constants'

let modelsPromise: Promise<void> | null = null

async function loadModels(): Promise<void> {
  if (!modelsPromise) {
    modelsPromise = (async () => {
      await faceapi.nets.tinyFaceDetector.loadFromUri(FACE_API_MODEL_URL)
      await faceapi.nets.faceExpressionNet.loadFromUri(FACE_API_MODEL_URL)
    })()
  }
  await modelsPromise
}

export function useSmileDetection(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  active: boolean,
) {
  const [liveScore, setLiveScore] = useState(0)
  const [finalScore, setFinalScore] = useState<number | null>(null)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const samples = useRef<number[]>([])

  useEffect(() => {
    let cancelled = false
    loadModels()
      .then(() => {
        if (!cancelled) setReady(true)
      })
      .catch(() => {
        if (!cancelled) setError('Failed to load smile detection models')
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!active || !ready) return

    samples.current = []
    setFinalScore(null)

    const interval = window.setInterval(async () => {
      const video = videoRef.current
      if (!video || video.readyState < 2 || video.videoWidth === 0) return

      try {
        const detection = await faceapi
          .detectSingleFace(video, new faceapi.TinyFaceDetectorOptions())
          .withFaceExpressions()

        const happy = detection?.expressions.happy ?? 0
        const score = Math.round(happy * 100)
        samples.current.push(score)

        const avg =
          samples.current.reduce((sum, value) => sum + value, 0) /
          samples.current.length
        setLiveScore(Math.round(avg))
      } catch {
        // Skip frame on transient detection errors
      }
    }, 150)

    return () => {
      window.clearInterval(interval)
      if (samples.current.length) {
        const avg =
          samples.current.reduce((sum, value) => sum + value, 0) /
          samples.current.length
        setFinalScore(Math.round(avg * 10) / 10)
      } else {
        setFinalScore(0)
      }
    }
  }, [active, ready, videoRef])

  const reset = useCallback(() => {
    samples.current = []
    setLiveScore(0)
    setFinalScore(null)
  }, [])

  return { liveScore, finalScore, ready, error, reset }
}
