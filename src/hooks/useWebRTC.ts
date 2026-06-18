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
  const remoteStreamRef = useRef<MediaStream | null>(null)
  const hadRemoteMediaRef = useRef(false)
  const connectedRef = useRef(false)
  const peerPresentRef = useRef(false)
  const makingOffer = useRef(false)
  const ignoreOffer = useRef(false)
  const pendingIceRef = useRef<RTCIceCandidateInit[]>([])
  const isHostRef = useRef(isHost)

  isHostRef.current = isHost

  useEffect(() => {
    if (!lobbyId || !enabled || !supabase) return

    const client = supabase
    let active = true
    let channel = client.channel(`webrtc:${lobbyId}`, {
      config: { broadcast: { self: false } },
    })
    let offerRetryTimer: number | null = null
    let signalChain = Promise.resolve()

    setError(null)
    setRemoteStream(null)
    setConnected(false)
    connectedRef.current = false
    hadRemoteMediaRef.current = false
    peerPresentRef.current = false
    remoteStreamRef.current = null
    pendingIceRef.current = []

    debug('useWebRTC', 'starting session', { lobbyId, playerId, isHost })

    const sendSignal = (payload: SignalPayload) => {
      debug('useWebRTC', 'sendSignal', { type: payload.type, from: payload.from })
      void channel.send({
        type: 'broadcast',
        event: 'signal',
        payload,
      })
    }

    const flushPendingIce = async (pc: RTCPeerConnection) => {
      if (!pc.remoteDescription) return
      const pending = pendingIceRef.current
      pendingIceRef.current = []
      for (const candidate of pending) {
        try {
          await pc.addIceCandidate(candidate)
        } catch (err) {
          debugWarn('useWebRTC', 'queued ICE candidate failed', err)
        }
      }
    }

    const addRemoteTrack = (track: MediaStreamTrack) => {
      if (!active) return
      let stream = remoteStreamRef.current
      if (!stream) {
        stream = new MediaStream()
        remoteStreamRef.current = stream
      }
      if (!stream.getTracks().some((t) => t.id === track.id)) {
        stream.addTrack(track)
      }
      hadRemoteMediaRef.current = true
      connectedRef.current = true
      debug('useWebRTC', 'remote track received', {
        kind: track.kind,
        streamId: stream.id,
        trackCount: stream.getTracks().length,
      })
      setRemoteStream(stream)
      setConnected(true)
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
        if (pc.iceConnectionState === 'failed' && !hadRemoteMediaRef.current) {
          debugWarn('useWebRTC', 'ICE failed before remote media — host will retry offer')
        }
      }

      pc.onsignalingstatechange = () => {
        debug('useWebRTC', 'signalingState', pc.signalingState)
      }

      pc.ontrack = (event) => {
        const [stream] = event.streams
        if (stream) {
          remoteStreamRef.current = stream
          hadRemoteMediaRef.current = true
          connectedRef.current = true
          debug('useWebRTC', 'remote stream received', { streamId: stream.id })
          setRemoteStream(stream)
          setConnected(true)
          return
        }
        addRemoteTrack(event.track)
      }

      pc.onconnectionstatechange = () => {
        debug('useWebRTC', 'connectionState', pc.connectionState)
        if (pc.connectionState === 'connected') {
          connectedRef.current = true
          setConnected(true)
        }
        if (pc.connectionState === 'failed') {
          if (hadRemoteMediaRef.current) {
            debugWarn('useWebRTC', 'connection dropped after remote media was flowing')
          } else if (peerPresentRef.current && active) {
            debugError('useWebRTC', 'peer connection FAILED before remote video')
            setError('Video connection failed. Try leaving and rejoining.')
          } else {
            debugWarn('useWebRTC', 'connection failed before opponent joined signaling')
          }
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

    const sendOffer = async () => {
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

    const resendOffer = async () => {
      const pc = pcRef.current
      if (!pc) {
        await sendOffer()
        return
      }
      await attachLocalTracks(pc)
      if (pc.signalingState === 'stable') {
        await sendOffer()
        return
      }
      if (pc.localDescription?.type === 'offer') {
        sendSignal({
          type: 'offer',
          sdp: pc.localDescription.sdp ?? '',
          from: playerId,
        })
        debug('useWebRTC', 'offer re-sent')
      }
    }

    const handleSignal = async (payload: SignalPayload) => {
      if (payload.from === playerId) return

      if (payload.type === 'hello') {
        peerPresentRef.current = true
        debug('useWebRTC', 'peer hello received', { from: payload.from })
        if (isHostRef.current) {
          await resendOffer()
        }
        return
      }

      const pc = ensurePeerConnection()
      await attachLocalTracks(pc)

      if (payload.type === 'offer') {
        peerPresentRef.current = true
        const offerCollision = makingOffer.current || pc.signalingState !== 'stable'
        ignoreOffer.current = !isHostRef.current && offerCollision
        if (ignoreOffer.current) {
          debugWarn('useWebRTC', 'ignored offer (collision)', { isHost: isHostRef.current })
          return
        }

        await pc.setRemoteDescription({ type: 'offer', sdp: payload.sdp })
        await flushPendingIce(pc)
        const answer = await pc.createAnswer()
        await pc.setLocalDescription(answer)
        sendSignal({ type: 'answer', sdp: answer.sdp ?? '', from: playerId })
        debug('useWebRTC', 'answer sent')
        return
      }

      if (payload.type === 'answer' && pc.signalingState === 'have-local-offer') {
        await pc.setRemoteDescription({ type: 'answer', sdp: payload.sdp })
        await flushPendingIce(pc)
        debug('useWebRTC', 'remote answer applied')
        return
      }

      if (payload.type === 'ice' && payload.candidate) {
        if (pc.remoteDescription) {
          try {
            await pc.addIceCandidate(payload.candidate)
          } catch (err) {
            debugWarn('useWebRTC', 'ICE candidate failed', err)
          }
        } else {
          pendingIceRef.current.push(payload.candidate)
        }
      }
    }

    const enqueueSignal = (payload: SignalPayload) => {
      signalChain = signalChain
        .then(() => handleSignal(payload))
        .catch((err) => debugError('useWebRTC', 'signal handler failed', err))
    }

    const announcePresence = () => {
      sendSignal({ type: 'hello', from: playerId })
    }

    const start = async () => {
      try {
        channel = client.channel(`webrtc:${lobbyId}`, {
          config: { broadcast: { self: false } },
        })

        channel.on('broadcast', { event: 'signal' }, ({ payload }) => {
          enqueueSignal(payload as SignalPayload)
        })

        await channel.subscribe((status, err) => {
          debug('useWebRTC', 'signaling channel', { status, err })
        })

        announcePresence()

        if (isHostRef.current) {
          await sendOffer()
          offerRetryTimer = window.setInterval(() => {
            if (!active || !isHostRef.current || connectedRef.current) return
            void resendOffer()
          }, 3000)
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
      if (offerRetryTimer != null) window.clearInterval(offerRetryTimer)
      pcRef.current?.close()
      pcRef.current = null
      localStreamRef.current?.getTracks().forEach((track) => track.stop())
      localStreamRef.current = null
      remoteStreamRef.current = null
      hadRemoteMediaRef.current = false
      connectedRef.current = false
      peerPresentRef.current = false
      pendingIceRef.current = []
      setLocalStream(null)
      setRemoteStream(null)
      setConnected(false)
      void client.removeChannel(channel)
    }
  }, [lobbyId, playerId, enabled])

  return { localStream, remoteStream, connected, error }
}
