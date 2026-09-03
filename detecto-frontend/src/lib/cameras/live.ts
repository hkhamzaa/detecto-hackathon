import { useEffect, useState } from 'react'
import { io } from 'socket.io-client'

import { getCameraDetections } from '@/lib/cameras/api'
import {
  mergeTicks,
  parseTick,
  type DetectionTick,
} from '@/lib/cameras/overlay'
import {
  DETECTION_TICK_EVENT,
  DETECTION_TICK_HISTORY_EVENT,
  LIVE_ALERTS_URL,
  WATCH_CAMERA_EVENT,
} from '@/lib/config/live-alerts'

/**
 * Scores for one camera: the persisted model timeline for THIS file, plus
 * live ticks while it is still being classified.
 *
 * History is not blended with another camera: every merge is scoped to
 * `cameraId`, and a completed REST timeline replaces socket leftovers.
 */
export function useDetectionTicks(cameraId: string | undefined) {
  const [ticks, setTicks] = useState<DetectionTick[]>([])
  const [connected, setConnected] = useState(false)
  const [complete, setComplete] = useState(false)

  useEffect(() => {
    if (!cameraId) return

    setTicks([])
    setComplete(false)
    let cancelled = false

    const pull = async () => {
      const result = await getCameraDetections(cameraId)
      if (cancelled || !result.ok) return false
      const scoped = result.ticks.filter((tick) => tick.cameraId === cameraId)
      if (result.complete) {
        setTicks(scoped)
      } else {
        setTicks((current) => mergeTicks(current, scoped, cameraId))
      }
      setComplete(result.complete)
      return result.complete
    }

    void pull()
    const poll = window.setInterval(() => {
      void pull().then((done) => {
        if (done) window.clearInterval(poll)
      })
    }, 1000)

    const socket = io(LIVE_ALERTS_URL)

    socket.on('connect', () => {
      setConnected(true)
      socket.emit(WATCH_CAMERA_EVENT, { cameraId })
    })
    socket.on('disconnect', () => setConnected(false))
    socket.on('connect_error', (error) => {
      setConnected(false)
      console.warn(`[live-overlay] cannot reach ${LIVE_ALERTS_URL}:`, error.message)
    })

    socket.on(DETECTION_TICK_HISTORY_EVENT, (payload: unknown) => {
      if (typeof payload !== 'object' || payload === null) return
      const body = payload as Record<string, unknown>
      if (body.cameraId !== cameraId) return
      const parsed = Array.isArray(body.ticks)
        ? body.ticks.map((row) => parseTick(row, cameraId)).filter((tick): tick is DetectionTick => tick !== null)
        : []
      setTicks((current) => mergeTicks(current, parsed, cameraId))
    })

    socket.on(DETECTION_TICK_EVENT, (payload: unknown) => {
      const tick = parseTick(payload, cameraId)
      if (!tick) return
      setTicks((current) => mergeTicks(current, [tick], cameraId))
    })

    return () => {
      cancelled = true
      window.clearInterval(poll)
      socket.disconnect()
    }
  }, [cameraId])

  return { ticks, connected, complete }
}
