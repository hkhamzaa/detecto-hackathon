import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  getNotificationSettings,
  setEscalation,
  setRoute,
  type EscalationPolicy,
} from '@/lib/notifications/api'
import type { RouteKind } from '@/lib/notifications/routing'

export const NOTIFICATIONS_KEY = ['org-notifications'] as const

export function useNotificationSettings() {
  return useQuery({
    queryKey: NOTIFICATIONS_KEY,
    queryFn: async () => {
      const result = await getNotificationSettings()
      if (!result.ok) throw new Error(result.code)
      return result.settings
    },
  })
}

/**
 * Neither of these is optimistic, and for the same reason the role writes are
 * not: a module toggle is a switch that has to move under the finger, and
 * nothing here is a switch. Both change who gets woken up when a weapon is
 * found, and showing that as done before the server has agreed to it would be
 * guessing about whether anybody is watching.
 */
function useSettingsWrite<TVars>(mutationFn: (vars: TVars) => Promise<unknown>) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_KEY })
    },
  })
}

export function useSetRoute() {
  return useSettingsWrite(
    async (vars: { kind: RouteKind; target: string; roleIds: string[] | null }) => {
      const result = await setRoute(vars.kind, vars.target, vars.roleIds)
      if (!result.ok) throw new Error(result.code)
      return result.settings
    },
  )
}

export function useSetEscalation() {
  return useSettingsWrite(async (policy: EscalationPolicy) => {
    const result = await setEscalation(policy)
    if (!result.ok) throw new Error(result.code)
    return result.settings
  })
}
