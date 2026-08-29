import { useQuery } from '@tanstack/react-query'

import { listCameras } from '@/lib/cameras/api'

/** One key, so the list page and the wizard cannot drift apart. */
export const CAMERAS_KEY = ['cameras'] as const

/**
 * The transport returns a result object rather than throwing, the way the auth
 * API does. Query wants a rejection for a failure, so the translation happens
 * here — once — instead of every caller re-checking `ok`.
 */
export function useCameras() {
  return useQuery({
    queryKey: CAMERAS_KEY,
    queryFn: async () => {
      const result = await listCameras()
      if (!result.ok) throw new Error(result.code)
      return result.cameras
    },
  })
}
