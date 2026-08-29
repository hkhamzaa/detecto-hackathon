import { mockCurrentPassword, mockSetPassword } from '@/lib/auth/api'
import { USE_MOCKS } from '@/lib/config/mocks'
import { MIN_PASSWORD } from '@/lib/forms'
import { useAuthStore } from '@/store/auth-store'

/**
 * The signed-in person's own account.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS MODULE KNOWS ABOUT EXACTLY ONE PERSON: WHOEVER IS HOLDING THE SESSION
 *
 * No function here takes a person id, an org id, or any other handle, and none
 * is coming. "Change my name" and "change somebody's name" are different
 * operations with different authority behind them, and the second one already
 * exists elsewhere, gated on `users:manage`, in `lib/roles/api.ts`. Keeping
 * them in separate modules is what stops this page — which anybody signed in
 * can open, with no grant at all — from growing a parameter that would let it
 * edit a colleague.
 *
 * Nothing here reads or returns anything about the organisation either: not its
 * name, not its people, not its roles. See `pages/account/boundary.test.tsx`.
 *
 * NO CHANNEL PREFERENCE, STILL
 *
 * A `Person` carries a name, an email address and a role. There is no channel
 * preference on it, no consent record and no telephone number — which is what
 * `/org/settings/notifications` found when it refused to draw a per-person
 * channel matrix, and it is just as true from this side. The account page
 * states the same gap rather than offering somebody a switch over their own
 * notifications that would write to nothing.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Same shape as every other module: one function per operation, a real
 * transport, and a dev mock that only ever runs in dev.
 */

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

export type Account = {
  /** Whoever is signed in. Never anybody else. */
  id: string
  name: string
  email: string
}

export type AccountResult =
  | { ok: true; account: Account }
  | { ok: false; code: 'unavailable' }

export type AccountWriteResult =
  | { ok: true; account: Account }
  | { ok: false; code: 'email_taken' }
  | { ok: false; code: 'unavailable' }

export type PasswordResult =
  | { ok: true }
  /** The current password given did not match. Never says which field was wrong. */
  | { ok: false; code: 'wrong_password' }
  | { ok: false; code: 'weak_password' }
  | { ok: false; code: 'unavailable' }

/* -------------------------------------------------------------------------- */
/* Public surface                                                             */
/* -------------------------------------------------------------------------- */

export function getAccount(): Promise<AccountResult> {
  return USE_MOCKS ? mockGet() : realGet()
}

export function saveAccount(
  patch: Pick<Account, 'name' | 'email'>,
): Promise<AccountWriteResult> {
  return USE_MOCKS ? mockSave(patch) : realSave(patch)
}

/**
 * Changing your own password, while signed in.
 *
 * A different operation from the reset-link flow in `lib/auth/api.ts`, and
 * deliberately a different endpoint: that one proves you own an inbox, this one
 * proves you know the current password. Requiring the current password is what
 * stops an unattended, still-signed-in machine from becoming a permanent
 * takeover, so it is not optional here.
 */
export function changePassword(
  currentPassword: string,
  newPassword: string,
): Promise<PasswordResult> {
  return USE_MOCKS
    ? mockChangePassword(currentPassword, newPassword)
    : realChangePassword(currentPassword, newPassword)
}

/* -------------------------------------------------------------------------- */
/* Real transport                                                             */
/* -------------------------------------------------------------------------- */

function authHeaders(): Record<string, string> {
  const token = useAuthStore.getState().accessToken
  return token ? { Authorization: `Bearer ${token}` } : {}
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

async function readObject(response: Response) {
  const data: unknown = await response.json().catch(() => null)
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return null
  return data as Record<string, unknown>
}

function toAccount(payload: Record<string, unknown> | null): Account | null {
  if (!payload) return null

  const id = str(payload.id)
  const email = str(payload.email)
  if (!id || !email) return null

  return { id, name: str(payload.name) ?? email, email }
}

async function realGet(): Promise<AccountResult> {
  let response: Response
  try {
    // No id in the path. The session is the identity.
    response = await fetch('/api/account', { headers: authHeaders() })
  } catch {
    return { ok: false, code: 'unavailable' }
  }
  if (!response.ok) return { ok: false, code: 'unavailable' }

  const account = toAccount(await readObject(response))
  return account ? { ok: true, account } : { ok: false, code: 'unavailable' }
}

async function realSave(
  patch: Pick<Account, 'name' | 'email'>,
): Promise<AccountWriteResult> {
  let response: Response
  try {
    response = await fetch('/api/account', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(patch),
    })
  } catch {
    return { ok: false, code: 'unavailable' }
  }

  if (response.status === 409) return { ok: false, code: 'email_taken' }
  if (!response.ok) return { ok: false, code: 'unavailable' }

  const account = toAccount(await readObject(response))
  return account ? { ok: true, account } : { ok: false, code: 'unavailable' }
}

async function realChangePassword(
  currentPassword: string,
  newPassword: string,
): Promise<PasswordResult> {
  let response: Response
  try {
    response = await fetch('/api/account/password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      // Sent so the backend can revoke other sessions if it chooses to. Whether
      // it does is its decision, not something this page claims on its behalf.
      credentials: 'include',
      body: JSON.stringify({ currentPassword, newPassword }),
    })
  } catch {
    return { ok: false, code: 'unavailable' }
  }

  if (response.status === 401) return { ok: false, code: 'wrong_password' }
  if (response.status === 422) return { ok: false, code: 'weak_password' }
  if (!response.ok) return { ok: false, code: 'unavailable' }

  return { ok: true }
}

/* -------------------------------------------------------------------------- */
/* Dev mock — delete once /api/account is live                                */
/* -------------------------------------------------------------------------- */

const MOCK_DELAY = { read: 350, write: 600 }

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Seeded from the claims, because that is genuinely where this comes from.
 *
 * The signed-in email is in the token; the display name is not, so it is
 * derived from the local part the same way the roles mock derives one for an
 * invited colleague. Held per session so an edit sticks while the tab is open.
 */
let store: Account | null = null

function nameFromEmail(email: string) {
  const local = email.split('@')[0] ?? email
  return (
    local
      .split(/[._-]+/)
      .filter(Boolean)
      .map((part) => part[0].toUpperCase() + part.slice(1))
      .join(' ') || email
  )
}

function account(): Account {
  const claims = useAuthStore.getState().claims
  const email = claims?.email ?? 'you@example.com'

  // Re-seeded when a different person signs in on this tab, so the page never
  // shows the previous session's name.
  if (!store || store.id !== (claims?.sub ?? 'usr_anon')) {
    store = { id: claims?.sub ?? 'usr_anon', name: nameFromEmail(email), email }
  }
  return store
}

async function mockGet(): Promise<AccountResult> {
  await wait(MOCK_DELAY.read)
  return { ok: true, account: { ...account() } }
}

async function mockSave(
  patch: Pick<Account, 'name' | 'email'>,
): Promise<AccountWriteResult> {
  await wait(MOCK_DELAY.write)

  const current = account()
  store = { ...current, name: patch.name, email: patch.email }
  return { ok: true, account: { ...store } }
}

/**
 * Verifies the current password against what login actually accepts, then
 * changes it — so the rest of the session signs in with the new one.
 *
 * See `mockSetPassword` in `lib/auth/api.ts`: without that seam this would
 * report success while login carried on taking the old password, which is a
 * mock lying about the one thing this screen exists to do.
 */
async function mockChangePassword(
  currentPassword: string,
  newPassword: string,
): Promise<PasswordResult> {
  await wait(MOCK_DELAY.write)

  if (currentPassword !== mockCurrentPassword()) {
    return { ok: false, code: 'wrong_password' }
  }
  // Checked here as well as in the browser — the same refusal the backend gives.
  if (newPassword.length < MIN_PASSWORD) return { ok: false, code: 'weak_password' }

  mockSetPassword(newPassword)
  return { ok: true }
}
