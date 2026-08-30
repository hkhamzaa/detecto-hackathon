import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { io } from 'socket.io-client'

import { parseAlert, type Alert } from '@/lib/alerts/api'
import { ALERTS_KEY, alertKey } from '@/lib/alerts/queries'
import {
  LIVE_ALERTS,
  LIVE_ALERTS_EVENT,
  LIVE_ALERTS_URL,
} from '@/lib/config/live-alerts'

/**
 * Detections arriving over a socket, folded into the queue that is already on
 * screen.
 *
 * This is not a second source of alerts sitting beside the first. It writes
 * into the same React Query cache `useAlerts` reads, through the same
 * `parseAlert` the HTTP transport uses, so a live alert and a fetched one are
 * the same object by the time anything renders. A parallel list would drift
 * from this one, and the page that drifted would be the one nobody was
 * watching.
 *
 * Scope, deliberately: no auth, no reconnection policy beyond what socket.io
 * does by itself, no replay of what was missed while disconnected. Alerts
 * raised before this hook mounted are gone — the server holds nothing.
 */
export function useLiveAlerts() {
  const queryClient = useQueryClient()

  useEffect(() => {
    if (!LIVE_ALERTS) return

    const socket = io(LIVE_ALERTS_URL)

    socket.on('connect', () => {
      console.info(`[live-alerts] connected to ${LIVE_ALERTS_URL}`)
    })

    // Worth a word rather than silence: the usual cause is the server not
    // running, and a queue that simply never updates gives no clue why.
    socket.on('connect_error', (error) => {
      console.warn(`[live-alerts] cannot reach ${LIVE_ALERTS_URL}:`, error.message)
    })

    socket.on(LIVE_ALERTS_EVENT, (payload: unknown) => {
      const alert = parseAlert(payload)
      if (!alert) {
        // The parser is the contract. Something that fails it is not an alert,
        // and inventing the missing half would put a fiction in the queue.
        console.warn('[live-alerts] discarded an unparseable payload:', payload)
        return
      }

      const queue = queryClient.getQueryData<Alert[]>(ALERTS_KEY)
      // Ids restart at ALR-0001 every time the server restarts, so a repeat is
      // a live possibility rather than a theoretical one.
      const alreadyQueued = queue?.some((existing) => existing.id === alert.id) ?? false

      // Only prepend to a queue that has actually loaded. Seeding a list into a
      // still-pending query would resolve it with a list of one, and then lose
      // that alert when the real fetch landed on top.
      if (queue && !alreadyQueued) {
        queryClient.setQueryData<Alert[]>(ALERTS_KEY, [alert, ...queue])
      }

      // Seeded whether or not the list took it. These are two independent cache
      // entries, and the detail page reads this one — an alert that arrived
      // before the queue had loaded is still an alert somebody can open, and
      // nothing else will ever be able to answer for it.
      queryClient.setQueryData(alertKey(alert.id), alert)

      if (!alreadyQueued) {
        console.info(
          `[live-alerts] ${alert.id} ${alert.kind} ${alert.confidence.toFixed(2)} on ${alert.cameraName}`,
        )
      }
    })

    return () => {
      socket.disconnect()
    }
  }, [queryClient])
}
