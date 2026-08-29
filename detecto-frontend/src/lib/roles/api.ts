import { USE_MOCKS } from '@/lib/config/mocks'
import { ALL_PERMISSION_KEYS } from '@/lib/roles/permissions'
import { useAuthStore } from '@/store/auth-store'

/**
 * People in an organisation, and the roles they hold.
 *
 * Roles are built from a permission checklist rather than picked from fixed
 * tiers, because the shape of a security team is not something Detecto gets to
 * decide. A corner shop has one person who does everything; a hospital has
 * night staff who confirm alerts and never touch billing. Both are expressible
 * here, and neither had to be anticipated.
 *
 * Same structure as the other modules: real transport, dev mock, one function
 * per operation.
 */

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

export type Role = {
  id: string
  name: string
  /** Keys from the claims system. Nothing else is accepted. */
  permissions: string[]
  /** null means every camera. Otherwise the zones this role is held to. */
  zones: string[] | null
  /**
   * The organisation's own admin role. It cannot be deleted — an org that
   * deletes the role granting `users:manage` has locked itself out of its own
   * account, and no confirm dialogue makes that recoverable.
   */
  isDefault: boolean
}

export type PersonStatus = 'active' | 'invited' | 'deactivated'

export type Person = {
  id: string
  name: string
  email: string
  /** null means they hold no role, and can therefore see nothing. */
  roleId: string | null
  status: PersonStatus
  /** When the invite went out — for spotting one nobody ever answered. */
  invitedAt: string | null
}

export type Directory = { roles: Role[]; people: Person[] }

export type RoleDraft = {
  /** Absent when creating. */
  id?: string
  name: string
  permissions: string[]
  zones: string[] | null
}

/** What happens to the people holding a role that is being deleted. */
export type RoleDisposition =
  | { kind: 'unassign' }
  | { kind: 'reassign'; roleId: string }

export type DirectoryResult =
  | { ok: true; directory: Directory }
  | { ok: false; code: 'unavailable' }

export type RoleResult =
  | { ok: true; role: Role }
  | { ok: false; code: 'duplicate_name' }
  | { ok: false; code: 'forbidden' }
  | { ok: false; code: 'unavailable' }

export type DeleteResult =
  | { ok: true; moved: number }
  | { ok: false; code: 'protected_role' }
  | { ok: false; code: 'forbidden' }
  | { ok: false; code: 'unavailable' }

export type PersonResult =
  | { ok: true; person: Person }
  | { ok: false; code: 'already_here' }
  | { ok: false; code: 'forbidden' }
  | { ok: false; code: 'unavailable' }

/* -------------------------------------------------------------------------- */
/* Public surface                                                             */
/* -------------------------------------------------------------------------- */

export function getDirectory(): Promise<DirectoryResult> {
  return USE_MOCKS ? mockDirectory() : realDirectory()
}

export function saveRole(draft: RoleDraft): Promise<RoleResult> {
  return USE_MOCKS ? mockSaveRole(draft) : realSaveRole(draft)
}

export function deleteRole(
  id: string,
  disposition: RoleDisposition,
): Promise<DeleteResult> {
  return USE_MOCKS ? mockDeleteRole(id, disposition) : realDeleteRole(id, disposition)
}

export function invitePerson(email: string, roleId: string): Promise<PersonResult> {
  return USE_MOCKS ? mockInvite(email, roleId) : realInvite(email, roleId)
}

export function setPersonRole(id: string, roleId: string | null): Promise<PersonResult> {
  return USE_MOCKS ? mockPatchPerson(id, { roleId }) : realPatchPerson(id, { roleId })
}

/**
 * Access on or off. Never deletion — a person's confirmations are part of the
 * organisation's audit trail, and removing them would rewrite a record of who
 * decided what.
 */
export function setPersonStatus(
  id: string,
  status: Extract<PersonStatus, 'active' | 'deactivated'>,
): Promise<PersonResult> {
  return USE_MOCKS ? mockPatchPerson(id, { status }) : realPatchPerson(id, { status })
}

/* -------------------------------------------------------------------------- */
/* Real transport                                                             */
/* -------------------------------------------------------------------------- */

function authHeaders(): Record<string, string> {
  const token = useAuthStore.getState().accessToken
  return token ? { Authorization: `Bearer ${token}` } : {}
}

function json(body: unknown): RequestInit {
  return {
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body),
  }
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

async function readObject(response: Response) {
  const data: unknown = await response.json().catch(() => null)
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return null
  return data as Record<string, unknown>
}

/** Unknown permission keys are dropped, not passed through. */
function knownPermissions(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter(
    (key): key is string =>
      typeof key === 'string' && ALL_PERMISSION_KEYS.includes(key),
  )
}

function toRole(value: unknown): Role | null {
  if (typeof value !== 'object' || value === null) return null
  const r = value as Record<string, unknown>
  const id = str(r.id)
  const name = str(r.name)
  if (!id || !name) return null

  return {
    id,
    name,
    permissions: knownPermissions(r.permissions),
    zones: Array.isArray(r.zones)
      ? r.zones.filter((zone): zone is string => typeof zone === 'string')
      : null,
    isDefault: r.isDefault === true,
  }
}

const STATUSES: string[] = ['active', 'invited', 'deactivated']

function toPerson(value: unknown): Person | null {
  if (typeof value !== 'object' || value === null) return null
  const p = value as Record<string, unknown>
  const id = str(p.id)
  const email = str(p.email)
  const status = str(p.status)
  if (!id || !email || !status || !STATUSES.includes(status)) return null

  return {
    id,
    name: str(p.name) ?? email,
    email,
    roleId: str(p.roleId),
    status: status as PersonStatus,
    invitedAt: str(p.invitedAt),
  }
}

async function realDirectory(): Promise<DirectoryResult> {
  let response: Response
  try {
    response = await fetch('/api/org/directory', { headers: authHeaders() })
  } catch {
    return { ok: false, code: 'unavailable' }
  }
  if (!response.ok) return { ok: false, code: 'unavailable' }

  const payload = await readObject(response)
  if (!payload) return { ok: false, code: 'unavailable' }

  return {
    ok: true,
    directory: {
      roles: (Array.isArray(payload.roles) ? payload.roles : [])
        .map(toRole)
        .filter((role): role is Role => role !== null),
      people: (Array.isArray(payload.people) ? payload.people : [])
        .map(toPerson)
        .filter((person): person is Person => person !== null),
    },
  }
}

async function realSaveRole(draft: RoleDraft): Promise<RoleResult> {
  let response: Response
  try {
    response = await fetch(
      draft.id ? `/api/org/roles/${encodeURIComponent(draft.id)}` : '/api/org/roles',
      { method: draft.id ? 'PUT' : 'POST', ...json(draft) },
    )
  } catch {
    return { ok: false, code: 'unavailable' }
  }

  if (response.status === 403) return { ok: false, code: 'forbidden' }
  if (response.status === 409) return { ok: false, code: 'duplicate_name' }
  if (!response.ok) return { ok: false, code: 'unavailable' }

  const role = toRole(await readObject(response))
  return role ? { ok: true, role } : { ok: false, code: 'unavailable' }
}

async function realDeleteRole(
  id: string,
  disposition: RoleDisposition,
): Promise<DeleteResult> {
  let response: Response
  try {
    response = await fetch(`/api/org/roles/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      ...json({ disposition }),
    })
  } catch {
    return { ok: false, code: 'unavailable' }
  }

  if (response.status === 403) return { ok: false, code: 'forbidden' }
  if (response.status === 409) return { ok: false, code: 'protected_role' }
  if (!response.ok) return { ok: false, code: 'unavailable' }

  const payload = await readObject(response)
  return {
    ok: true,
    moved: payload && typeof payload.moved === 'number' ? payload.moved : 0,
  }
}

async function realInvite(email: string, roleId: string): Promise<PersonResult> {
  let response: Response
  try {
    response = await fetch('/api/org/people', {
      method: 'POST',
      ...json({ email, roleId }),
    })
  } catch {
    return { ok: false, code: 'unavailable' }
  }

  if (response.status === 403) return { ok: false, code: 'forbidden' }
  if (response.status === 409) return { ok: false, code: 'already_here' }
  if (!response.ok) return { ok: false, code: 'unavailable' }

  const person = toPerson(await readObject(response))
  return person ? { ok: true, person } : { ok: false, code: 'unavailable' }
}

async function realPatchPerson(
  id: string,
  patch: Partial<Pick<Person, 'roleId' | 'status'>>,
): Promise<PersonResult> {
  let response: Response
  try {
    response = await fetch(`/api/org/people/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      ...json(patch),
    })
  } catch {
    return { ok: false, code: 'unavailable' }
  }

  if (response.status === 403) return { ok: false, code: 'forbidden' }
  if (!response.ok) return { ok: false, code: 'unavailable' }

  const person = toPerson(await readObject(response))
  return person ? { ok: true, person } : { ok: false, code: 'unavailable' }
}

/* -------------------------------------------------------------------------- */
/* Dev mock — delete once /api/org is live                                    */
/* -------------------------------------------------------------------------- */

/**
 * A new organisation gets exactly one role: the admin access the person who
 * signed up already has. No "Manager", no "Viewer", no invented ladder — the
 * whole point of building roles from a checklist is that Detecto does not know
 * what this customer's team looks like.
 *
 * The people are seeded so every status is visible without waiting: one active,
 * one invited yesterday, one whose invite has sat unanswered for eleven days,
 * and one deactivated.
 */
const MOCK_DELAY = { read: 400, write: 600 }
const DAY = 86_400_000

let directory: Directory | null = null
let counter = 0

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function nextId(prefix: string) {
  counter += 1
  return `${prefix}_${String(counter).padStart(3, '0')}`
}

/** `sam.okafor@northgate.com` → `Sam Okafor`. */
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

function seed(): Directory {
  const claims = useAuthStore.getState().claims
  const email = claims?.email ?? 'admin@northgate.com'
  const now = Date.now()

  const admin: Role = {
    id: 'role_admin',
    name: 'Admin',
    permissions: [...ALL_PERMISSION_KEYS],
    zones: null,
    isDefault: true,
  }

  return {
    roles: [admin],
    people: [
      {
        id: claims?.sub ?? nextId('usr'),
        name: nameFromEmail(email),
        email,
        roleId: admin.id,
        status: 'active',
        invitedAt: null,
      },
      {
        id: nextId('usr'),
        name: 'Rhea Mehta',
        email: 'rhea.mehta@northgate.com',
        roleId: admin.id,
        status: 'invited',
        invitedAt: new Date(now - 1 * DAY).toISOString(),
      },
      {
        id: nextId('usr'),
        name: 'Tomas Bergstrom',
        email: 'tomas.bergstrom@northgate.com',
        roleId: admin.id,
        status: 'invited',
        invitedAt: new Date(now - 11 * DAY).toISOString(),
      },
      {
        id: nextId('usr'),
        name: 'Joan Whitfield',
        email: 'joan.whitfield@northgate.com',
        roleId: admin.id,
        status: 'deactivated',
        invitedAt: null,
      },
    ],
  }
}

function store() {
  directory ??= seed()
  return directory
}

async function mockDirectory(): Promise<DirectoryResult> {
  await wait(MOCK_DELAY.read)
  const current = store()
  return {
    ok: true,
    directory: {
      roles: current.roles.slice(),
      people: current.people.slice(),
    },
  }
}

async function mockSaveRole(draft: RoleDraft): Promise<RoleResult> {
  await wait(MOCK_DELAY.write)
  const current = store()

  const wanted = draft.name.trim().toLowerCase()
  const clash = current.roles.some(
    (role) => role.id !== draft.id && role.name.trim().toLowerCase() === wanted,
  )
  if (clash) return { ok: false, code: 'duplicate_name' }

  const permissions = draft.permissions.filter((key) =>
    ALL_PERMISSION_KEYS.includes(key),
  )

  if (draft.id) {
    const index = current.roles.findIndex((role) => role.id === draft.id)
    if (index === -1) return { ok: false, code: 'unavailable' }

    const updated: Role = {
      ...current.roles[index],
      name: draft.name.trim(),
      permissions,
      zones: draft.zones,
    }
    current.roles[index] = updated
    return { ok: true, role: updated }
  }

  const created: Role = {
    id: nextId('role'),
    name: draft.name.trim(),
    permissions,
    zones: draft.zones,
    isDefault: false,
  }
  current.roles = [...current.roles, created]
  return { ok: true, role: created }
}

async function mockDeleteRole(
  id: string,
  disposition: RoleDisposition,
): Promise<DeleteResult> {
  await wait(MOCK_DELAY.write)
  const current = store()

  const role = current.roles.find((item) => item.id === id)
  if (!role) return { ok: false, code: 'unavailable' }
  if (role.isDefault) return { ok: false, code: 'protected_role' }

  const nextRoleId = disposition.kind === 'reassign' ? disposition.roleId : null
  let moved = 0

  current.people = current.people.map((person) => {
    if (person.roleId !== id) return person
    moved += 1
    return { ...person, roleId: nextRoleId }
  })
  current.roles = current.roles.filter((item) => item.id !== id)

  return { ok: true, moved }
}

async function mockInvite(email: string, roleId: string): Promise<PersonResult> {
  await wait(MOCK_DELAY.write)
  const current = store()

  const normalised = email.trim().toLowerCase()
  if (current.people.some((person) => person.email.toLowerCase() === normalised)) {
    return { ok: false, code: 'already_here' }
  }

  const person: Person = {
    id: nextId('usr'),
    name: nameFromEmail(normalised),
    email: normalised,
    roleId,
    status: 'invited',
    invitedAt: new Date().toISOString(),
  }
  current.people = [...current.people, person]
  return { ok: true, person }
}

/**
 * Re-scopes every role held to one zone, so it is held to another instead.
 *
 * Exported for the zones mock — see the note on `mockRewriteCameraZone`. This
 * is the half of a zone rename that matters most: `zones` is an access
 * boundary, so a rename that missed it would leave a role pointing at a zone
 * that no longer exists, which reaches no cameras at all. Deduplicated, because
 * a merge can leave a role holding both names.
 *
 * A role with `zones: null` reaches every camera and is deliberately untouched.
 */
export function mockRewriteRoleZone(from: string, to: string): number {
  const current = store()
  let changed = 0

  current.roles = current.roles.map((role) => {
    if (role.zones === null || !role.zones.includes(from)) return role
    changed += 1
    return {
      ...role,
      zones: [...new Set(role.zones.map((zone) => (zone === from ? to : zone)))],
    }
  })

  return changed
}

async function mockPatchPerson(
  id: string,
  patch: Partial<Pick<Person, 'roleId' | 'status'>>,
): Promise<PersonResult> {
  await wait(MOCK_DELAY.write)
  const current = store()

  const index = current.people.findIndex((person) => person.id === id)
  if (index === -1) return { ok: false, code: 'unavailable' }

  const updated: Person = { ...current.people[index], ...patch }
  current.people[index] = updated
  return { ok: true, person: updated }
}
