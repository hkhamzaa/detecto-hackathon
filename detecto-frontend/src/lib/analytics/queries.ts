import { useQuery } from '@tanstack/react-query'

import { getAlertHistory } from '@/lib/analytics/api'

export const ANALYTICS_KEY = ['analytics', 'alerts'] as const

/**
 * Deliberately not under `['alerts']`. A decision taken in the queue
 * invalidates that prefix on every confirm, and re-pulling eight weeks of
 * history because one alert changed state would be a lot of work to move a bar
 * by a pixel. The reporting window is stale by the minute by design; it is a
 * report, not a monitor.
 */
export function useAlertHistory() {
  return useQuery({
    queryKey: ANALYTICS_KEY,
    queryFn: async () => {
      const result = await getAlertHistory()
      if (!result.ok) throw new Error(result.code)
      return result.history
    },
    staleTime: 5 * 60 * 1000,
  })
}
