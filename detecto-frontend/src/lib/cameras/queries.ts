import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { approveCamera, listCameras } from '@/lib/cameras/api'

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

/**
 * Moves one box-reported camera from `'pending'` to `'approved'`. Not
 * optimistic — same reasoning as `useDecision` in lib/alerts/queries.ts:
 * this is the one action in the product that puts a camera into use, so the
 * list shouldn't say it happened until the server confirms it did.
 */
export function useApproveCamera() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (id: string) => {
      const result = await approveCamera(id)
      if (!result.ok) throw new Error(result.code)
      return result.camera
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: CAMERAS_KEY })
    },
  })
}
