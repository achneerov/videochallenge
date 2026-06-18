import { useEffect, useRef, useState } from 'react'
import { ICE_SERVERS } from '../lib/constants'
import { supabase } from '../lib/supabase'
import type { SignalPayload } from '../types'

export function useWebRTC(
  lobbyId: string | null,
  playerId: string,
  isHost: boolean,
  enabled: boolean,
) {
  const [localStream, setLocalStream] = useState<MediaStream | null>(null)
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null)
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const pcRef = useRef<RTCPeerConnection | null>(null)
  const makingOffer = useRef(false)
  const ignoreOffer = useRef(false)
  const started = useRef(false)

  useEffect(() => {
    if (!lobbyId || !enabled || !supabase) return

    let active = true
    let channel = supabase.channel(`webrtc:${lobbyId}`, {
      config: { broadcast: { self: false } },
    })

    const sendSignal = (payload: SignalPayload) => {
      void channel.send({
        type: 'broadcast',
        event: 'signal',
        payload,
      })
    }

    const ensurePeerConnection = () => {
      if (pcRef.current) return pcRef.current

      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })
      pcRef.current = pc

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          sendSignal({
            type: 'ice',
            candidate: event.candidate.toJSON(),
            from: playerId,
          })
        }
      }

      pc.ontrack = (event) => {
        const [stream] = event.streams
        if (stream && active) {
          setRemoteStream(stream)
          setConnected(true)
        }
      }

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'connected') {
          setConnected(true)
        }
        if (pc.connectionState === 'failed') {
          setError('Video connection failed. Try leaving and rejoining.')
        }
      }

      return pc
    }

    const attachLocalTracks = async (pc: RTCPeerConnection) => {
      let stream = localStream
      if (!stream) {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
          audio: true,
        })
        if (!active) {
          stream.getTracks().forEach((track) => track.stop())
          return null
        }
        setLocalStream(stream)
      }

      const senders = pc.getSenders()
      for (const track of stream.getTracks()) {
        if (!senders.some((sender) => sender.track?.id === track.id)) {
          pc.addTrack(track, stream)
        }
      }
      return stream
    }

    const createOffer = async () => {
      const pc = ensurePeerConnection()
      await attachLocalTracks(pc)
      makingOffer.current = true
      try {
        const offer = await pc.createOffer()
        await pc.setLocalDescription(offer)
        sendSignal({ type: 'offer', sdp: offer.sdp ?? '', from: playerId })
      } finally {
        makingOffer.current = false
      }
    }

    const handleSignal = async (payload: SignalPayload) => {
      if (payload.from === playerId) return

      const pc = ensurePeerConnection()
      await attachLocalTracks(pc)

      if (payload.type === 'offer') {
        const offerCollision = makingOffer.current || pc.signalingState !== 'stable'
        ignoreOffer.current = !isHost && offerCollision
        if (ignoreOffer.current) return

        await pc.setRemoteDescription({ type: 'offer', sdp: payload.sdp })
        const answer = await pc.createAnswer()
        await pc.setLocalDescription(answer)
        sendSignal({ type: 'answer', sdp: answer.sdp ?? '', from: playerId })
        return
      }

      if (payload.type === 'answer' && pc.signalingState === 'have-local-offer') {
        await pc.setRemoteDescription({ type: 'answer', sdp: payload.sdp })
        return
      }

      if (payload.type === 'ice' && payload.candidate) {
        try {
          await pc.addIceCandidate(payload.candidate)
        } catch {
          // ICE candidates can arrive before remote description is set
        }
      }
    }

    const start = async () => {
      if (!supabase) return
      try {
        channel = supabase.channel(`webrtc:${lobbyId}`, {
          config: { broadcast: { self: false } },
        })

        channel.on('broadcast', { event: 'signal' }, ({ payload }) => {
          void handleSignal(payload as SignalPayload)
        })

        await channel.subscribe()

        if (isHost && !started.current) {
          started.current = true
          await createOffer()
        }
      } catch (err) {
        if (active) {
          setError(
            err instanceof Error
              ? err.message
              : 'Could not access camera or microphone',
          )
        }
      }
    }

    void start()

    return () => {
      active = false
      started.current = false
      pcRef.current?.close()
      pcRef.current = null
      setRemoteStream(null)
      setConnected(false)
      if (supabase) void supabase.removeChannel(channel)
    }
  }, [lobbyId, playerId, isHost, enabled])

  useEffect(() => {
    return () => {
      localStream?.getTracks().forEach((track) => track.stop())
    }
  }, [localStream])

  return { localStream, remoteStream, connected, error }
}
