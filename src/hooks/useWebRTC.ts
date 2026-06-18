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
  const makingOffer = useRef(false)
  const ignoreOffer = useRef(false)
  const started = useRef(false)

  debug('useWebRTC', 'hook render', { lobbyId, playerId, isHost, enabled })

  useEffect(() => {
    debug('useWebRTC', 'effect run', {
      lobbyId,
      playerId,
      isHost,
      enabled,
      hasSupabase: Boolean(supabase),
    })

    if (!lobbyId || !enabled || !supabase) {
      debug('useWebRTC', 'effect skipped', {
        reason: !lobbyId ? 'no lobbyId' : !enabled ? 'not enabled' : 'no supabase',
      })
      return
    }

    let active = true
    let channel = supabase.channel(`webrtc:${lobbyId}`, {
      config: { broadcast: { self: false } },
    })

    const sendSignal = (payload: SignalPayload) => {
      debug('useWebRTC', 'sendSignal', payload)
      void channel.send({
        type: 'broadcast',
        event: 'signal',
        payload,
      })
    }

    const ensurePeerConnection = () => {
      if (pcRef.current) {
        debug('useWebRTC', 'reusing existing RTCPeerConnection', {
          signalingState: pcRef.current.signalingState,
          connectionState: pcRef.current.connectionState,
          iceState: pcRef.current.iceConnectionState,
        })
        return pcRef.current
      }

      debug('useWebRTC', 'creating new RTCPeerConnection', { iceServers: ICE_SERVERS })
      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })
      pcRef.current = pc

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          debug('useWebRTC', 'local ICE candidate', event.candidate.toJSON())
          sendSignal({
            type: 'ice',
            candidate: event.candidate.toJSON(),
            from: playerId,
          })
        } else {
          debug('useWebRTC', 'ICE gathering complete (null candidate)')
        }
      }

      pc.onicegatheringstatechange = () => {
        debug('useWebRTC', 'iceGatheringState', pc.iceGatheringState)
      }

      pc.oniceconnectionstatechange = () => {
        debug('useWebRTC', 'iceConnectionState', pc.iceConnectionState)
      }

      pc.onsignalingstatechange = () => {
        debug('useWebRTC', 'signalingState', pc.signalingState)
      }

      pc.ontrack = (event) => {
        const [stream] = event.streams
        debug('useWebRTC', 'ontrack fired', {
          streamId: stream?.id,
          trackKinds: stream?.getTracks().map((t) => t.kind),
          active,
        })
        if (stream && active) {
          setRemoteStream(stream)
          setConnected(true)
          debug('useWebRTC', 'remote stream set, connected=true')
        }
      }

      pc.onconnectionstatechange = () => {
        debug('useWebRTC', 'connectionState', pc.connectionState)
        if (pc.connectionState === 'connected') {
          setConnected(true)
          debug('useWebRTC', 'peer connection connected')
        }
        if (pc.connectionState === 'failed') {
          debugError('useWebRTC', 'peer connection FAILED')
          setError('Video connection failed. Try leaving and rejoining.')
        }
        if (pc.connectionState === 'disconnected') {
          debugWarn('useWebRTC', 'peer connection disconnected')
        }
      }

      return pc
    }

    const attachLocalTracks = async (pc: RTCPeerConnection) => {
      let stream = localStream
      if (!stream) {
        debug('useWebRTC', 'requesting getUserMedia...')
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: {
              facingMode: 'user',
              width: { ideal: 640 },
              height: { ideal: 480 },
            },
            audio: true,
          })
          debug('useWebRTC', 'getUserMedia success', {
            streamId: stream.id,
            tracks: stream.getTracks().map((t) => ({
              kind: t.kind,
              id: t.id,
              enabled: t.enabled,
              readyState: t.readyState,
              label: t.label,
            })),
          })
        } catch (err) {
          debugError('useWebRTC', 'getUserMedia FAILED', err)
          throw err
        }
        if (!active) {
          debug('useWebRTC', 'inactive after getUserMedia — stopping tracks')
          stream.getTracks().forEach((track) => track.stop())
          return null
        }
        setLocalStream(stream)
      } else {
        debug('useWebRTC', 'reusing existing local stream', { streamId: stream.id })
      }

      const senders = pc.getSenders()
      for (const track of stream.getTracks()) {
        if (!senders.some((sender) => sender.track?.id === track.id)) {
          debug('useWebRTC', 'addTrack', { kind: track.kind, id: track.id })
          pc.addTrack(track, stream)
        }
      }
      return stream
    }

    const createOffer = async () => {
      debug('useWebRTC', 'createOffer start', { isHost })
      const pc = ensurePeerConnection()
      await attachLocalTracks(pc)
      makingOffer.current = true
      try {
        const offer = await pc.createOffer()
        debug('useWebRTC', 'offer created', { type: offer.type, sdpLength: offer.sdp?.length })
        await pc.setLocalDescription(offer)
        debug('useWebRTC', 'local description set (offer)')
        sendSignal({ type: 'offer', sdp: offer.sdp ?? '', from: playerId })
      } catch (err) {
        debugError('useWebRTC', 'createOffer failed', err)
        throw err
      } finally {
        makingOffer.current = false
      }
    }

    const handleSignal = async (payload: SignalPayload) => {
      debug('useWebRTC', 'handleSignal received', payload)

      if (payload.from === playerId) {
        debug('useWebRTC', 'ignoring own signal')
        return
      }

      const pc = ensurePeerConnection()
      await attachLocalTracks(pc)

      if (payload.type === 'offer') {
        const offerCollision = makingOffer.current || pc.signalingState !== 'stable'
        ignoreOffer.current = !isHost && offerCollision
        debug('useWebRTC', 'processing offer', {
          offerCollision,
          ignoreOffer: ignoreOffer.current,
          isHost,
          signalingState: pc.signalingState,
        })
        if (ignoreOffer.current) return

        try {
          await pc.setRemoteDescription({ type: 'offer', sdp: payload.sdp })
          debug('useWebRTC', 'remote description set (offer)')
          const answer = await pc.createAnswer()
          debug('useWebRTC', 'answer created', { type: answer.type, sdpLength: answer.sdp?.length })
          await pc.setLocalDescription(answer)
          debug('useWebRTC', 'local description set (answer)')
          sendSignal({ type: 'answer', sdp: answer.sdp ?? '', from: playerId })
        } catch (err) {
          debugError('useWebRTC', 'handle offer failed', err)
        }
        return
      }

      if (payload.type === 'answer' && pc.signalingState === 'have-local-offer') {
        try {
          await pc.setRemoteDescription({ type: 'answer', sdp: payload.sdp })
          debug('useWebRTC', 'remote description set (answer)')
        } catch (err) {
          debugError('useWebRTC', 'handle answer failed', err)
        }
        return
      }

      if (payload.type === 'answer' && pc.signalingState !== 'have-local-offer') {
        debugWarn('useWebRTC', 'ignored answer — wrong signaling state', {
          signalingState: pc.signalingState,
        })
      }

      if (payload.type === 'ice' && payload.candidate) {
        try {
          await pc.addIceCandidate(payload.candidate)
          debug('useWebRTC', 'ICE candidate added', payload.candidate)
        } catch (err) {
          debugWarn('useWebRTC', 'addIceCandidate failed (may be ok if early)', err)
        }
      }
    }

    const start = async () => {
      if (!supabase) return
      debug('useWebRTC', 'start() called')
      try {
        channel = supabase.channel(`webrtc:${lobbyId}`, {
          config: { broadcast: { self: false } },
        })

        channel.on('broadcast', { event: 'signal' }, ({ payload }) => {
          debug('useWebRTC', 'broadcast event received', payload)
          void handleSignal(payload as SignalPayload)
        })

        const subStatus = await channel.subscribe((status, err) => {
          debug('useWebRTC', 'signaling channel subscribe', { status, err })
        })
        debug('useWebRTC', 'channel subscribed', subStatus)

        if (isHost && !started.current) {
          started.current = true
          debug('useWebRTC', 'host creating offer...')
          await createOffer()
        } else {
          debug('useWebRTC', 'not creating offer', { isHost, started: started.current })
        }
      } catch (err) {
        debugError('useWebRTC', 'start() failed', err)
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
      debug('useWebRTC', 'cleanup', { lobbyId, playerId })
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
    debug('useWebRTC', 'streams state', {
      hasLocal: Boolean(localStream),
      localTracks: localStream?.getTracks().map((t) => t.kind),
      hasRemote: Boolean(remoteStream),
      remoteTracks: remoteStream?.getTracks().map((t) => t.kind),
      connected,
      error,
    })
  }, [localStream, remoteStream, connected, error])

  useEffect(() => {
    return () => {
      debug('useWebRTC', 'stopping local stream tracks on unmount')
      localStream?.getTracks().forEach((track) => track.stop())
    }
  }, [localStream])

  return { localStream, remoteStream, connected, error }
}
