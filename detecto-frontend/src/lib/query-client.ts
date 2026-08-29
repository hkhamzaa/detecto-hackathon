import { QueryClient } from '@tanstack/react-query'

/**
 * Server state for Detecto is mostly operational data that goes stale fast
 * (alert queues, camera health). Real-time deltas arrive over Socket.IO and
 * are written into this cache, so background refetching stays conservative.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
})
