import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  getOrgSettings,
  saveOrgProfile,
  saveOrgSecurity,
  type OrgSecurity,
} from '@/lib/org/api'
import type { OrgProfile } from '@/lib/org/profile'

export const ORG_SETTINGS_KEY = ['org-settings'] as const

export function useOrgSettings() {
  return useQuery({
    queryKey: ORG_SETTINGS_KEY,
    queryFn: async () => {
      const result = await getOrgSettings()
      if (!result.ok) throw new Error(result.code)
      return result.settings
    },
  })
}

function useOrgWrite<TVars>(mutationFn: (vars: TVars) => Promise<unknown>) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ORG_SETTINGS_KEY })
    },
  })
}

/**
 * Neither is optimistic, and neither needs a confirm step.
 *
 * Not optimistic, because a settings page that shows a change as saved before
 * the server agreed teaches people to close the tab too early. Not behind a
 * confirm either: renaming an organisation changes a label, and a change that
 * is visible, reversible and affects nobody's access does not earn the friction
 * that role deletion and escalation changes do. Spending a confirm step here
 * would make the ones that matter cheaper.
 */
export function useSaveOrgProfile() {
  return useOrgWrite(async (profile: OrgProfile) => {
    const result = await saveOrgProfile(profile)
    if (!result.ok) throw new Error(result.code)
    return result.settings
  })
}

export function useSaveOrgSecurity() {
  return useOrgWrite(async (security: OrgSecurity) => {
    const result = await saveOrgSecurity(security)
    if (!result.ok) throw new Error(result.code)
    return result.settings
  })
}
