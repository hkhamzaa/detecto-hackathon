import { useQuery } from '@tanstack/react-query'

import { getPlatformHealth } from '@/lib/health/api'

export const HEALTH_KEY = ['admin', 'health'] as const

/**
 * Kept short-lived on purpose. This is the one page in the product that is a
 * monitor rather than a report — a stale reading of whether boxes are talking
 * is worse than no reading, because it looks current.
 */
export function usePlatformHealth() {
  return useQuery({
    queryKey: HEALTH_KEY,
    queryFn: async () => {
      const result = await getPlatformHealth()
      if (!result.ok) throw new Error(result.code)
      return result.health
    },
    staleTime: 30_000,
  })
}
