import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { confirmAlert, dismissAlert, getAlert, listAlerts } from '@/lib/alerts/api'

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
  return useQuery({
    queryKey: alertKey(id),
    queryFn: async () => {
      const result = await getAlert(id)
      if (!result.ok) throw new Error(result.code)
      return result.alert
    },
  })
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
      const result =
        decision === 'confirm' ? await confirmAlert(id) : await dismissAlert(id)
      if (!result.ok) throw new Error(result.code)
      return result.alert
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ALERTS_KEY })
    },
  })
}
