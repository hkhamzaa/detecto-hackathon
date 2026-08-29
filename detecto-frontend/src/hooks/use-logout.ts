import { useCallback, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'

import { logout } from '@/lib/auth/api'
import { useAuthStore } from '@/store/auth-store'

/**
 * Signing out, in the order that matters.
 *
 * The server is told first, because it is the only side that can revoke the
 * session and expire the httpOnly refresh cookie. Then the token and claims go,
 * then the query cache — a cache left behind would show the previous person's
 * cameras and alerts to whoever signs in next on this device, before the first
 * refetch lands.
 *
 * `pending` stays true through the navigation. The button unmounts with the
 * shell, so there is nothing to reset, and nothing to double-fire.
 */
export function useLogout() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const signOut = useAuthStore((s) => s.signOut)
  const [pending, setPending] = useState(false)

  const signOutNow = useCallback(async () => {
    if (pending) return
    setPending(true)

    await logout()
    signOut()
    queryClient.clear()
    navigate('/login', { replace: true })
  }, [navigate, pending, queryClient, signOut])

  return { signOutNow, pending }
}
