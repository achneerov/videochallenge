import { useEffect, useRef } from 'react'
import { debug, diag } from '../lib/debug'

interface VideoTileProps {
  stream: MediaStream | null
  label: string
  score?: number | null
  mirrored?: boolean
  placeholder?: string
}

async function startPlayback(video: HTMLVideoElement, label: string): Promise<void> {
  const tryPlay = async () => {
    if (!video.isConnected) return
    if (!video.paused && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) return
    await video.play()
  }

  try {
    await tryPlay()
    diag('Video', `playing "${label}"`, {
      videoWidth: video.videoWidth,
      videoHeight: video.videoHeight,
      readyState: video.readyState,
    })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      await new Promise((resolve) => requestAnimationFrame(resolve))
      try {
        await tryPlay()
        diag('Video', `playing "${label}" (after AbortError retry)`, {
          videoWidth: video.videoWidth,
          videoHeight: video.videoHeight,
        })
        return
      } catch (retryErr) {
        diag('Video', `play() retry failed for "${label}"`, retryErr)
        return
      }
    }
    diag('Video', `play() failed for "${label}"`, err)
    debug('VideoTile', `play() failed for "${label}"`, err)
  }
}

export function VideoTile({
  stream,
  label,
  score,
  mirrored = false,
  placeholder = 'Waiting for opponent…',
}: VideoTileProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const labelRef = useRef(label)
  labelRef.current = label

  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    if (!stream) {
      diag('Video', `no stream for "${labelRef.current}"`)
      video.srcObject = null
      return
    }

    diag('Video', `attaching stream for "${labelRef.current}"`, {
      streamId: stream.id,
      tracks: stream.getTracks().map((t) => ({
        kind: t.kind,
        enabled: t.enabled,
        readyState: t.readyState,
      })),
    })
    debug('VideoTile', `attaching stream for "${labelRef.current}"`, {
      streamId: stream.id,
      tracks: stream.getTracks().map((t) => ({
        kind: t.kind,
        enabled: t.enabled,
        readyState: t.readyState,
      })),
    })

    if (video.srcObject !== stream) {
      video.srcObject = stream
    }

    const onReady = () => {
      void startPlayback(video, labelRef.current)
    }

    video.addEventListener('loadedmetadata', onReady)
    video.addEventListener('resize', onReady)
    void startPlayback(video, labelRef.current)

    return () => {
      video.removeEventListener('loadedmetadata', onReady)
      video.removeEventListener('resize', onReady)
    }
  }, [stream])

  return (
    <div className="video-tile">
      <div className="video-tile__header">
        <span>{label}</span>
        {score != null && <span className="video-tile__score">{score}</span>}
      </div>
      <div className="video-tile__frame">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className={mirrored ? 'mirrored' : undefined}
        />
        {!stream && (
          <div className="video-tile__placeholder">{placeholder}</div>
        )}
      </div>
    </div>
  )
}
