import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { changePassword, getAccount, saveAccount, type Account } from '@/lib/account/api'

export const ACCOUNT_KEY = ['account'] as const

export function useAccount() {
  return useQuery({
    queryKey: ACCOUNT_KEY,
    queryFn: async () => {
      const result = await getAccount()
      if (!result.ok) throw new Error(result.code)
      return result.account
    },
  })
}

export function useSaveAccount() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (patch: Pick<Account, 'name' | 'email'>) => {
      const result = await saveAccount(patch)
      if (!result.ok) throw new Error(result.code)
      return result.account
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ACCOUNT_KEY })
    },
  })
}

/**
 * Invalidates nothing on success, deliberately.
 *
 * A password change alters no data this app displays — the account record is
 * the same name and the same email afterwards — so refetching it would be a
 * request made to prove a point. What the page does instead is say plainly that
 * the change took, which is the only thing a person can act on here.
 */
export function useChangePassword() {
  return useMutation({
    mutationFn: async (vars: { currentPassword: string; newPassword: string }) => {
      const result = await changePassword(vars.currentPassword, vars.newPassword)
      if (!result.ok) throw new Error(result.code)
      return result
    },
  })
}
