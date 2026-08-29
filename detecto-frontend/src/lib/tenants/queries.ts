import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  getPlatformSummary,
  getTenant,
  listTenants,
  setTenantNote,
  setTenantStatus,
  type TenantStatus,
} from '@/lib/tenants/api'

/**
 * `['tenants']` is a prefix of `['tenants', id]`, so invalidating the list
 * after a write refreshes the open tenant too — the same arrangement the alert
 * queue uses. `['admin', 'summary']` sits outside that prefix and is
 * invalidated explicitly, because suspending an account changes the platform
 * counts on the overview as surely as it changes the row.
 */
export const TENANTS_KEY = ['tenants'] as const
export const SUMMARY_KEY = ['admin', 'summary'] as const
export const tenantKey = (id: string) => ['tenants', id] as const

export function usePlatformSummary() {
  return useQuery({
    queryKey: SUMMARY_KEY,
    queryFn: async () => {
      const result = await getPlatformSummary()
      if (!result.ok) throw new Error(result.code)
      return result.summary
    },
  })
}

export function useTenants() {
  return useQuery({
    queryKey: TENANTS_KEY,
    queryFn: async () => {
      const result = await listTenants()
      if (!result.ok) throw new Error(result.code)
      return result.tenants
    },
  })
}

export function useTenant(id: string) {
  return useQuery({
    queryKey: tenantKey(id),
    queryFn: async () => {
      const result = await getTenant(id)
      if (!result.ok) throw new Error(result.code)
      return result.tenant
    },
  })
}

function useTenantWrite(id: string) {
  const queryClient = useQueryClient()
  return () => {
    void queryClient.invalidateQueries({ queryKey: TENANTS_KEY })
    void queryClient.invalidateQueries({ queryKey: SUMMARY_KEY })
    void queryClient.invalidateQueries({ queryKey: tenantKey(id) })
  }
}

/**
 * Suspending or restoring an account. Deliberately not optimistic: this one cuts
 * a customer's detection off, and the interface must not show it as done until
 * the platform says it is.
 */
export function useSetTenantStatus(id: string) {
  const invalidate = useTenantWrite(id)

  return useMutation({
    mutationFn: async (status: Extract<TenantStatus, 'active' | 'suspended'>) => {
      const result = await setTenantStatus(id, status)
      if (!result.ok) throw new Error(result.code)
      return result.tenant
    },
    onSuccess: invalidate,
  })
}

export function useSetTenantNote(id: string) {
  const invalidate = useTenantWrite(id)

  return useMutation({
    mutationFn: async (note: string) => {
      const result = await setTenantNote(id, note)
      if (!result.ok) throw new Error(result.code)
      return result.tenant
    },
    onSuccess: invalidate,
  })
}
