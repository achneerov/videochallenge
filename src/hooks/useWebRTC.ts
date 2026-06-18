import { useEffect, useRef, useState } from 'react'
import { ICE_SERVERS } from '../lib/constants'
import { debug, debugError, debugWarn } from '../lib/debug'
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
  const localStreamRef = useRef<MediaStream | null>(null)
  const makingOffer = useRef(false)
  const ignoreOffer = useRef(false)
  const isHostRef = useRef(isHost)

  isHostRef.current = isHost

  useEffect(() => {
    if (!lobbyId || !enabled || !supabase) return

    const client = supabase
    let active = true
    let channel = client.channel(`webrtc:${lobbyId}`, {
      config: { broadcast: { self: false } },
    })

    debug('useWebRTC', 'starting session', { lobbyId, playerId, isHost })

    const sendSignal = (payload: SignalPayload) => {
      debug('useWebRTC', 'sendSignal', { type: payload.type, from: payload.from })
      void channel.send({
        type: 'broadcast',
        event: 'signal',
        payload,
      })
    }

    const ensurePeerConnection = () => {
      if (pcRef.current) return pcRef.current

      debug('useWebRTC', 'creating RTCPeerConnection')
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

      pc.oniceconnectionstatechange = () => {
        debug('useWebRTC', 'iceConnectionState', pc.iceConnectionState)
      }

      pc.onsignalingstatechange = () => {
        debug('useWebRTC', 'signalingState', pc.signalingState)
      }

      pc.ontrack = (event) => {
        const [stream] = event.streams
        if (stream && active) {
          debug('useWebRTC', 'remote stream received', { streamId: stream.id })
          setRemoteStream(stream)
          setConnected(true)
        }
      }

      pc.onconnectionstatechange = () => {
        debug('useWebRTC', 'connectionState', pc.connectionState)
        if (pc.connectionState === 'connected') setConnected(true)
        if (pc.connectionState === 'failed') {
          debugError('useWebRTC', 'peer connection FAILED')
          setError('Video connection failed. Try leaving and rejoining.')
        }
      }

      return pc
    }

    const attachLocalTracks = async (pc: RTCPeerConnection) => {
      if (localStreamRef.current) {
        const stream = localStreamRef.current
        const senders = pc.getSenders()
        for (const track of stream.getTracks()) {
          if (!senders.some((sender) => sender.track?.id === track.id)) {
            pc.addTrack(track, stream)
          }
        }
        return stream
      }

      debug('useWebRTC', 'requesting getUserMedia')
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'user',
          width: { ideal: 640 },
          height: { ideal: 480 },
        },
        audio: true,
      })

      if (!active) {
        stream.getTracks().forEach((track) => track.stop())
        return null
      }

      localStreamRef.current = stream
      setLocalStream(stream)

      for (const track of stream.getTracks()) {
        pc.addTrack(track, stream)
      }

      debug('useWebRTC', 'local stream ready', { streamId: stream.id })
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
        debug('useWebRTC', 'offer sent')
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
        ignoreOffer.current = !isHostRef.current && offerCollision
        if (ignoreOffer.current) {
          debugWarn('useWebRTC', 'ignored offer (collision)', { isHost: isHostRef.current })
          return
        }

        await pc.setRemoteDescription({ type: 'offer', sdp: payload.sdp })
        const answer = await pc.createAnswer()
        await pc.setLocalDescription(answer)
        sendSignal({ type: 'answer', sdp: answer.sdp ?? '', from: playerId })
        debug('useWebRTC', 'answer sent')
        return
      }

      if (payload.type === 'answer' && pc.signalingState === 'have-local-offer') {
        await pc.setRemoteDescription({ type: 'answer', sdp: payload.sdp })
        debug('useWebRTC', 'remote answer applied')
        return
      }

      if (payload.type === 'ice' && payload.candidate) {
        try {
          await pc.addIceCandidate(payload.candidate)
        } catch {
          // ICE can arrive before remote description is set
        }
      }
    }

    const start = async () => {
      try {
        channel = client.channel(`webrtc:${lobbyId}`, {
          config: { broadcast: { self: false } },
        })

        channel.on('broadcast', { event: 'signal' }, ({ payload }) => {
          void handleSignal(payload as SignalPayload)
        })

        await channel.subscribe((status, err) => {
          debug('useWebRTC', 'signaling channel', { status, err })
        })

        if (isHostRef.current) {
          await createOffer()
        }
      } catch (err) {
        debugError('useWebRTC', 'start failed', err)
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
      debug('useWebRTC', 'cleanup session', { lobbyId, playerId })
      active = false
      pcRef.current?.close()
      pcRef.current = null
      localStreamRef.current?.getTracks().forEach((track) => track.stop())
      localStreamRef.current = null
      setLocalStream(null)
      setRemoteStream(null)
      setConnected(false)
      void client.removeChannel(channel)
    }
  }, [lobbyId, playerId, enabled])

  return { localStream, remoteStream, connected, error }
}
