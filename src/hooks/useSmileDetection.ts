import * as faceapi from '@vladmandic/face-api'
import { useCallback, useEffect, useRef, useState } from 'react'
import { FACE_API_MODEL_URL } from '../lib/constants'
import { debug, debugError, debugWarn } from '../lib/debug'

let modelsPromise: Promise<void> | null = null

async function loadModels(): Promise<void> {
  if (!modelsPromise) {
    debug('SmileDetection', 'loading models from', FACE_API_MODEL_URL)
    modelsPromise = (async () => {
      await faceapi.nets.tinyFaceDetector.loadFromUri(FACE_API_MODEL_URL)
      debug('SmileDetection', 'tinyFaceDetector loaded')
      await faceapi.nets.faceExpressionNet.loadFromUri(FACE_API_MODEL_URL)
      debug('SmileDetection', 'faceExpressionNet loaded')
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
  const frameCount = useRef(0)

  debug('SmileDetection', 'hook render', { active, ready, liveScore, finalScore })

  useEffect(() => {
    let cancelled = false
    debug('SmileDetection', 'loading models...')
    loadModels()
      .then(() => {
        if (!cancelled) {
          debug('SmileDetection', 'models ready')
          setReady(true)
        }
      })
      .catch((err) => {
        debugError('SmileDetection', 'model load FAILED', err)
        if (!cancelled) setError('Failed to load smile detection models')
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    debug('SmileDetection', 'detection effect', { active, ready })

    if (!active || !ready) return

    samples.current = []
    frameCount.current = 0
    setFinalScore(null)
    debug('SmileDetection', 'starting detection loop')

    const interval = window.setInterval(async () => {
      const video = videoRef.current
      frameCount.current++

      if (!video) {
        if (frameCount.current % 20 === 0) {
          debugWarn('SmileDetection', 'no video element ref')
        }
        return
      }

      if (video.readyState < 2 || video.videoWidth === 0) {
        if (frameCount.current % 20 === 0) {
          debug('SmileDetection', 'video not ready', {
            readyState: video.readyState,
            videoWidth: video.videoWidth,
            videoHeight: video.videoHeight,
            paused: video.paused,
            srcObject: Boolean(video.srcObject),
          })
        }
        return
      }

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
        const rounded = Math.round(avg)
        setLiveScore(rounded)

        if (frameCount.current % 10 === 0) {
          debug('SmileDetection', 'frame sample', {
            frame: frameCount.current,
            faceDetected: Boolean(detection),
            happy,
            score,
            avgScore: rounded,
            sampleCount: samples.current.length,
            expressions: detection?.expressions,
          })
        }
      } catch (err) {
        if (frameCount.current % 10 === 0) {
          debugWarn('SmileDetection', 'detection error', err)
        }
      }
    }, 150)

    return () => {
      window.clearInterval(interval)
      debug('SmileDetection', 'stopping detection loop', {
        totalFrames: frameCount.current,
        sampleCount: samples.current.length,
      })
      if (samples.current.length) {
        const avg =
          samples.current.reduce((sum, value) => sum + value, 0) /
          samples.current.length
        const final = Math.round(avg * 10) / 10
        debug('SmileDetection', 'final score computed', final)
        setFinalScore(final)
      } else {
        debugWarn('SmileDetection', 'no samples — final score 0')
        setFinalScore(0)
      }
    }
  }, [active, ready, videoRef])

  const reset = useCallback(() => {
    debug('SmileDetection', 'reset')
    samples.current = []
    setLiveScore(0)
    setFinalScore(null)
  }, [])

  return { liveScore, finalScore, ready, error, reset }
}
