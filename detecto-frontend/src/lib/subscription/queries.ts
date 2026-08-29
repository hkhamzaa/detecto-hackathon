import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { getSubscription, requestPlanChange, withdrawPlanChange } from '@/lib/subscription/api'

export const SUBSCRIPTION_KEY = ['org-subscription'] as const

export function useSubscription() {
  return useQuery({
    queryKey: SUBSCRIPTION_KEY,
    queryFn: async () => {
      const result = await getSubscription()
      if (!result.ok) throw new Error(result.code)
      return result.subscription
    },
  })
}

function useSubscriptionWrite<TVars>(mutationFn: (vars: TVars) => Promise<unknown>) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: SUBSCRIPTION_KEY })
    },
  })
}

/**
 * Neither of these is optimistic.
 *
 * Asking to move plans is the closest thing on this page to a payment-adjacent
 * action, and an interface that showed the request as sent before the server
 * agreed would be guessing about a customer's bill. Withdrawing is not
 * optimistic either, for the same reason in reverse: somebody taking a request
 * back needs to know it was actually taken back.
 */
export function useRequestPlanChange() {
  return useSubscriptionWrite(async (planId: string) => {
    const result = await requestPlanChange(planId)
    if (!result.ok) throw new Error(result.code)
    return result.subscription
  })
}

export function useWithdrawPlanChange() {
  return useSubscriptionWrite(async () => {
    const result = await withdrawPlanChange()
    if (!result.ok) throw new Error(result.code)
    return result.subscription
  })
}
