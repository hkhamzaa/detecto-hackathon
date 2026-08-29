import { useQuery } from '@tanstack/react-query'

import { getBillingLedger } from '@/lib/billing/api'

export const BILLING_KEY = ['admin', 'billing'] as const

/**
 * One read, and no mutations anywhere in this module.
 *
 * The billing page changes nothing: there is no processor behind it to change
 * anything with. Revenue is not fetched at all — it is derived from the tenant
 * registry by `lib/billing/revenue.ts`, so the page reads `useTenants()` for
 * that and this for the part only a processor could answer.
 */
export function useBillingLedger() {
  return useQuery({
    queryKey: BILLING_KEY,
    queryFn: async () => {
      const result = await getBillingLedger()
      if (!result.ok) throw new Error(result.code)
      return result.ledger
    },
  })
}
