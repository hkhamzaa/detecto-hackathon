import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  confirmAlert,
  dismissAlert,
  getAlert,
  listAlerts,
  type Alert,
} from '@/lib/alerts/api'
import { useAuthStore } from '@/store/auth-store'

/**
 * `['alerts']` is a prefix of `['alerts', id]`, so invalidating the queue after
 * a decision refreshes the open alert too. One call, both surfaces.
 */
export const ALERTS_KEY = ['alerts'] as const
export const alertKey = (id: string) => ['alerts', id] as const

export function useAlerts() {
  return useQuery({
    queryKey: ALERTS_KEY,
    queryFn: async () => {
      const result = await listAlerts()
      if (!result.ok) throw new Error(result.code)
      return result.alerts
    },
  })
}

export function useAlert(id: string) {
  const queryClient = useQueryClient()

  return useQuery({
    queryKey: alertKey(id),
    queryFn: async () => {
      // An alert that arrived over the socket exists nowhere else. Asking the
      // alerts endpoint for it gets an honest `not_found`, which the page then
      // reports as "no such alert" about a row the operator is looking at.
      //
      // So a live alert answers from what it already has. This is narrow on
      // purpose: only a cached alert that says it came from the beta pipeline
      // takes this path, and every other alert still refetches exactly as it
      // did. When the pipeline gets a real endpoint, this goes away.
      const cached = queryClient.getQueryData<Alert>(alertKey(id))
      if (cached?.pipelineStatus === 'beta') return cached

      const result = await getAlert(id)
      if (!result.ok) throw new Error(result.code)
      return result.alert
    },
  })
}

/**
 * A decision on a live alert, taken in this browser and going no further.
 *
 * The beta pipeline emits alerts and accepts nothing back — there is no
 * endpoint that can record a decision on one, in mocks or otherwise. Rather
 * than fail every hold with "your decision didn't reach Detecto" (true, but it
 * describes a network fault that is not what happened), the decision is written
 * to the cache and marked for exactly what it is.
 *
 * `decisionScope: 'local'` is what keeps that honest. The interface must not
 * claim something has been recorded when it has not, so the alert carries the
 * qualifier with it and every surface that reports the outcome says so.
 */
function decideLocally(alert: Alert, decision: 'confirm' | 'dismiss'): Alert {
  const claims = useAuthStore.getState().claims
  return {
    ...alert,
    status: decision === 'confirm' ? 'confirmed' : 'dismissed',
    decidedBy: claims?.email ?? 'Unknown operator',
    decidedAt: new Date().toISOString(),
    decisionScope: 'local',
  }
}

/**
 * Confirming and dismissing are the same shape of operation and differ only in
 * what they record, so they share one hook. Neither is optimistic: this is the
 * one place in the product where the interface must not claim something has
 * happened until the server says it has.
 */
export function useDecision(id: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (decision: 'confirm' | 'dismiss') => {
      // Same guard as `useAlert`: only a cached alert that says it came from
      // the beta pipeline takes this path. Everything else goes to the real
      // transport, unchanged.
      const cached = queryClient.getQueryData<Alert>(alertKey(id))
      if (cached?.pipelineStatus === 'beta') return decideLocally(cached, decision)

      const result =
        decision === 'confirm' ? await confirmAlert(id) : await dismissAlert(id)
      if (!result.ok) throw new Error(result.code)
      return result.alert
    },
    onSuccess: (alert) => {
      if (alert.decisionScope !== 'local') {
        void queryClient.invalidateQueries({ queryKey: ALERTS_KEY })
        return
      }

      // Nothing on a server changed, so there is nothing to refetch — and a
      // refetch would be actively destructive here, replacing the queue with a
      // list that has never contained this alert.
      queryClient.setQueryData(alertKey(alert.id), alert)
      queryClient.setQueryData<Alert[]>(ALERTS_KEY, (queue) =>
        queue?.map((item) => (item.id === alert.id ? alert : item)),
      )
    },
  })
}
