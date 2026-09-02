import { create } from 'zustand'

import { decodeClaims, type Claims } from '@/lib/auth/claims'

type AuthState = {
  accessToken: string | null
  claims: Claims | null
  signIn: (accessToken: string) => Claims | null
  signOut: () => void
}

/**
 * Deliberately NOT wrapped in `persist`.
 *
 * The access token is short-lived and lives only here, in memory. A reload
 * drops it, and the app asks the backend for a new one using the httpOnly
 * refresh cookie — which JavaScript cannot read, and which is the whole point.
 * Nothing token-shaped is ever written to localStorage or sessionStorage.
 *
 * In-memory is not immune to XSS either; it is simply the smallest surface
 * available to a browser client, and it means a stolen token dies with the tab.
 *
 * Boot seam: `main.tsx` calls the refresh endpoint once on load
 * (`lib/auth/session.ts`'s `bootstrapSession`) and `signIn`s with whatever
 * comes back, so a reload resumes the session instead of bouncing to
 * /login. The same module's fetch interceptor does the same thing
 * mid-session, on a 401 from any other call.
 */
export const useAuthStore = create<AuthState>((set) => ({
  accessToken: null,
  claims: null,

  // Returns the claims so a caller can route immediately, without waiting a
  // render for the subscription to fire.
  signIn: (accessToken) => {
    const claims = decodeClaims(accessToken)
    set({ accessToken, claims })
    return claims
  },

  signOut: () => set({ accessToken: null, claims: null }),
}))
