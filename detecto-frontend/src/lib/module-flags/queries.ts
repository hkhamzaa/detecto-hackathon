import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  listModuleFlags,
  setModulePlans,
  setModuleRate,
  setModuleStatus,
} from '@/lib/module-flags/api'
import type { ModuleStatus } from '@/lib/modules/catalogue'

export const MODULE_FLAGS_KEY = ['admin', 'modules'] as const

export function useModuleFlags() {
  return useQuery({
    queryKey: MODULE_FLAGS_KEY,
    queryFn: async () => {
      const result = await listModuleFlags()
      if (!result.ok) throw new Error(result.code)
      return result.modules
    },
  })
}

/**
 * Only this page's own cache is invalidated, and deliberately so.
 *
 * `module_status` has two readers, but they are never the same browser: areas
 * are mutually exclusive, so a super admin cannot reach an organisation's
 * modules page and has no `['modules']` cache to refresh. Invalidating one from
 * here would be dead code that also coupled a platform surface to an org
 * transport. Organisations pick the change up on their next fetch, from the
 * backend, which is where the field actually lives.
 */
function useFlagWrite() {
  const queryClient = useQueryClient()
  return () => {
    void queryClient.invalidateQueries({ queryKey: MODULE_FLAGS_KEY })
  }
}

/**
 * Releasing a module, or pulling it back.
 *
 * Deliberately not optimistic. This one changes what every organisation on an
 * included plan is offered, and the interface must not show it as done until
 * the platform says it is — the same rule the alert confirmation follows, and
 * the same rule the tenant suspension follows, for the same reason.
 */
export function useSetModuleStatus(id: string) {
  const invalidate = useFlagWrite()

  return useMutation({
    mutationFn: async (status: ModuleStatus) => {
      const result = await setModuleStatus(id, status)
      if (!result.ok) throw new Error(result.code)
      return result.module
    },
    onSuccess: invalidate,
  })
}

export function useSetModulePlans(id: string) {
  const invalidate = useFlagWrite()

  return useMutation({
    mutationFn: async (planIds: string[]) => {
      const result = await setModulePlans(id, planIds)
      if (!result.ok) throw new Error(result.code)
      return result.module
    },
    onSuccess: invalidate,
  })
}

export function useSetModuleRate(id: string) {
  const invalidate = useFlagWrite()

  return useMutation({
    mutationFn: async (rate: number | null) => {
      const result = await setModuleRate(id, rate)
      if (!result.ok) throw new Error(result.code)
      return result.module
    },
    onSuccess: invalidate,
  })
}
