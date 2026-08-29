import { useMutation, useQueryClient } from '@tanstack/react-query'

import { CAMERAS_KEY } from '@/lib/cameras/queries'
import { NOTIFICATIONS_KEY } from '@/lib/notifications/queries'
import { DIRECTORY_KEY } from '@/lib/roles/queries'
import { mergeZones, renameZone } from '@/lib/zones/api'

/**
 * There is no `useZones()` here, and that is the point.
 *
 * A zone is not a record to fetch — it is a name derived from the cameras that
 * are in it, so the page reads `useCameras()`, `useDirectory()` and
 * `useNotificationSettings()` and works the zones out with the pure helpers in
 * `lib/zones/references.ts`. A query key for zones would imply a store that
 * does not exist.
 *
 * What does live here is the invalidation, because it is the one thing a caller
 * would get wrong: a zone write changes all three of those caches at once, and
 * refreshing only the cameras would leave the page showing the new zone name
 * beside a role still listed under the old one.
 */
function useZoneWrite<TVars>(mutationFn: (vars: TVars) => Promise<unknown>) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: CAMERAS_KEY })
      void queryClient.invalidateQueries({ queryKey: DIRECTORY_KEY })
      void queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_KEY })
    },
  })
}

/**
 * Neither of these is optimistic.
 *
 * Both rewrite an access boundary across three stores. Showing a role as
 * re-scoped before the server has agreed would be guessing about who can open
 * which camera, which is the one thing the interface must never do on this
 * page's subject.
 */
export function useRenameZone() {
  return useZoneWrite(async (vars: { from: string; to: string }) => {
    const result = await renameZone(vars.from, vars.to)
    if (!result.ok) throw new Error(result.code)
    return result
  })
}

export function useMergeZones() {
  return useZoneWrite(async (vars: { from: string; into: string }) => {
    const result = await mergeZones(vars.from, vars.into)
    if (!result.ok) throw new Error(result.code)
    return result
  })
}
