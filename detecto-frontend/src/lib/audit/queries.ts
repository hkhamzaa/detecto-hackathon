import { useQuery } from '@tanstack/react-query'

import { getAuditLog } from '@/lib/audit/api'

export const AUDIT_KEY = ['org-audit'] as const

/**
 * One read, and there will never be a mutation here.
 *
 * A log the client can write to is not a log. See the header of
 * `lib/audit/api.ts` for why this whole module is read-only by construction
 * rather than by convention.
 */
export function useAuditLog() {
  return useQuery({
    queryKey: AUDIT_KEY,
    queryFn: async () => {
      const result = await getAuditLog()
      if (!result.ok) throw new Error(result.code)
      return result.entries
    },
  })
}
