import { scopeLabel } from '@/lib/auth/labels'
import { USE_MOCKS } from '@/lib/config/mocks'
import type { OrgProfile } from '@/lib/org/profile'
import type { OrgType } from '@/lib/plans'
import { ORG_TYPES } from '@/lib/plans'
import { useAuthStore } from '@/store/auth-store'

/**
 * The organisation's own record: what it is called, and how its sessions
 * behave.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ONE RECORD, TWO PAGES
 *
 * Profile and security are two screens because they are two conversations, but
 * they are one row on one endpoint — `/api/org/settings` — so the page that
 * changes a phone number and the page that changes a session length are not
 * racing each other over separate writes to the same organisation.
 *
 * SCOPE
 *
 * This is the signed-in person's own organisation, decided by the session. No
 * function here takes an org id and none is coming: an endpoint that accepted
 * one would be an endpoint somebody could pass a different one to. The same
 * rule `lib/subscription/api.ts` holds for the same reason.
 *
 * WHAT THE SECURITY HALF DOES NOT DO
 *
 * `idleTimeoutMinutes` is stored and nothing enforces it — see the long note on
 * the type below, and the page, which says so above the control rather than
 * underneath it. There is no `requireMfa` field at all, deliberately: MFA does
 * not exist in the auth system, and a stored flag nothing checks is the
 * checkbox-shaped lie this codebase refuses everywhere else.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Same shape as every other module: one function per operation, a real
 * transport, and a dev mock that only ever runs in dev.
 */

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * How long a session may sit idle. A short list, not a freeform field.
 *
 * Three values because the useful question is "roughly how long", and a box
 * accepting 23 would invite somebody to tune a number against nothing — the
 * same reasoning the escalation delays follow in
 * `lib/notifications/api.ts`.
 */
export type IdleTimeout = 15 | 30 | 60
export const IDLE_TIMEOUTS: IdleTimeout[] = [15, 30, 60]

export type OrgSecurity = {
  /**
   * ⚠ Stored, and enforced by nothing today.
   *
   * A session ends when its access token expires, and that lifetime is issued
   * by the backend — this setting is not consulted anywhere, because there is
   * no backend to consult it. There is also no idle tracking in the browser.
   *
   * Adding a browser-side idle timer would be worse than leaving it out: it
   * would sign somebody out of this tab while their token stayed valid on the
   * server for its full lifetime, which looks like a security control and is
   * not one. What makes this real is the backend honouring it when it issues
   * the token, and the page says exactly that.
   */
  idleTimeoutMinutes: IdleTimeout
}

export type OrgSettings = {
  profile: OrgProfile
  security: OrgSecurity
}

export type OrgSettingsResult =
  | { ok: true; settings: OrgSettings }
  | { ok: false; code: 'unavailable' }

export type OrgWriteResult =
  | { ok: true; settings: OrgSettings }
  | { ok: false; code: 'forbidden' }
  | { ok: false; code: 'unavailable' }

/* -------------------------------------------------------------------------- */
/* Public surface                                                             */
/* -------------------------------------------------------------------------- */

export function getOrgSettings(): Promise<OrgSettingsResult> {
  return USE_MOCKS ? mockGet() : realGet()
}

export function saveOrgProfile(profile: OrgProfile): Promise<OrgWriteResult> {
  return USE_MOCKS ? mockSave({ profile }) : realSave({ profile })
}

export function saveOrgSecurity(security: OrgSecurity): Promise<OrgWriteResult> {
  return USE_MOCKS ? mockSave({ security }) : realSave({ security })
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

function toOrgType(value: unknown): OrgType | '' {
  return ORG_TYPES.find((type) => type === value) ?? ''
}

function toTimeout(value: unknown): IdleTimeout {
  // An unrecognised value falls to the shortest, not the longest. A setting
  // this build cannot read should not quietly extend how long a session lives.
  return IDLE_TIMEOUTS.find((minutes) => minutes === value) ?? 15
}

function toSettings(payload: Record<string, unknown> | null): OrgSettings | null {
  if (!payload) return null

  const profile =
    typeof payload.profile === 'object' && payload.profile !== null
      ? (payload.profile as Record<string, unknown>)
      : {}
  const security =
    typeof payload.security === 'object' && payload.security !== null
      ? (payload.security as Record<string, unknown>)
      : {}

  return {
    profile: {
      name: str(profile.name) ?? '',
      type: toOrgType(profile.type),
      contactEmail: str(profile.contactEmail) ?? '',
      contactPhone: str(profile.contactPhone) ?? '',
    },
    security: { idleTimeoutMinutes: toTimeout(security.idleTimeoutMinutes) },
  }
}

async function realGet(): Promise<OrgSettingsResult> {
  let response: Response
  try {
    response = await fetch('/api/org/settings', { headers: authHeaders() })
  } catch {
    return { ok: false, code: 'unavailable' }
  }
  if (!response.ok) return { ok: false, code: 'unavailable' }

  const settings = toSettings(await readObject(response))
  return settings ? { ok: true, settings } : { ok: false, code: 'unavailable' }
}

async function realSave(patch: Partial<OrgSettings>): Promise<OrgWriteResult> {
  let response: Response
  try {
    response = await fetch('/api/org/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(patch),
    })
  } catch {
    return { ok: false, code: 'unavailable' }
  }

  if (response.status === 403) return { ok: false, code: 'forbidden' }
  if (!response.ok) return { ok: false, code: 'unavailable' }

  const settings = toSettings(await readObject(response))
  return settings ? { ok: true, settings } : { ok: false, code: 'unavailable' }
}

/* -------------------------------------------------------------------------- */
/* Dev mock — delete once /api/org/settings is live                           */
/* -------------------------------------------------------------------------- */

const MOCK_DELAY = { read: 400, write: 600 }

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

let store: OrgSettings | null = null

/**
 * Seeded from the session rather than invented.
 *
 * The organisation's name comes from the same `scopeLabel` the header shows, so
 * the settings page and the chrome above it cannot disagree about what this
 * organisation is called before anybody has edited anything. The contact fields
 * start empty — nothing captured one at signup, and a plausible-looking address
 * would be a fabrication sitting in a field somebody is about to trust.
 */
function seed(): OrgSettings {
  const claims = useAuthStore.getState().claims

  return {
    profile: {
      name: claims ? scopeLabel(claims) : '',
      type: '',
      contactEmail: '',
      contactPhone: '',
    },
    security: { idleTimeoutMinutes: 15 },
  }
}

function settings(): OrgSettings {
  store ??= seed()
  return store
}

/** A copy, so a caller holding the result cannot write through it. */
function snapshot(): OrgSettings {
  const current = settings()
  return {
    profile: { ...current.profile },
    security: { ...current.security },
  }
}

async function mockGet(): Promise<OrgSettingsResult> {
  await wait(MOCK_DELAY.read)
  return { ok: true, settings: snapshot() }
}

async function mockSave(patch: Partial<OrgSettings>): Promise<OrgWriteResult> {
  await wait(MOCK_DELAY.write)
  const current = settings()

  if (patch.profile) current.profile = { ...patch.profile }
  if (patch.security) current.security = { ...patch.security }

  return { ok: true, settings: snapshot() }
}
