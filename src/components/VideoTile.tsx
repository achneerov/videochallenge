import { useEffect, useRef } from 'react'

interface VideoTileProps {
  stream: MediaStream | null
  label: string
  score?: number | null
  mirrored?: boolean
  placeholder?: string
}

export function VideoTile({
  stream,
  label,
  score,
  mirrored = false,
  placeholder = 'Waiting for opponent…',
}: VideoTileProps) {
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    video.srcObject = stream
  }, [stream])

  return (
    <div className="video-tile">
      <div className="video-tile__header">
        <span>{label}</span>
        {score != null && <span className="video-tile__score">{score}</span>}
      </div>
      <div className="video-tile__frame">
        {stream ? (
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted={mirrored}
            className={mirrored ? 'mirrored' : undefined}
          />
        ) : (
          <div className="video-tile__placeholder">{placeholder}</div>
        )}
      </div>
    </div>
  )
}
