/**
 * The permissions an organisation can actually grant, in the words a customer
 * would use for them.
 *
 * Every key here already exists in the claims system — `can()` is asked about
 * these exact strings elsewhere in the app. Nothing is invented: a role builder
 * that can hand out a permission nothing checks would be a lie told with a
 * checkbox.
 *
 * `admin:*` is deliberately absent. Those are platform grants held by Detecto's
 * own staff, and no org admin can issue them.
 *
 * Not offered, because the claims system has no such key: **managing** cameras
 * as distinct from viewing them. Today `cameras:view` is the only camera grant,
 * and connecting or renaming a camera is gated by being in the org area at all.
 * When a `cameras:manage` key exists, it belongs in the Cameras group below.
 */

export type PermissionDef = {
  key: string
  /** Checkbox label. */
  label: string
  /** Verb phrase, for composing a summary sentence. Lower case, no full stop. */
  phrase: string
  description: string
  /**
   * Worth saying out loud wherever this role is shown. Reserved for the two
   * grants that hand over something more than a screen.
   */
  note?: string
}

export type PermissionGroup = {
  id: string
  label: string
  permissions: PermissionDef[]
}

export const PERMISSION_GROUPS: PermissionGroup[] = [
  {
    id: 'cameras',
    label: 'Cameras',
    permissions: [
      {
        key: 'cameras:view',
        label: 'View cameras',
        phrase: 'view cameras',
        description:
          'See the camera list, which zone each one covers, and whether it is sending a picture.',
      },
    ],
  },
  {
    id: 'alerts',
    label: 'Alerts',
    permissions: [
      {
        key: 'alerts:view',
        label: 'See the alert queue',
        phrase: 'see the alert queue',
        description:
          'Open detections and read what the model reported. On its own, this does not let them decide anything.',
      },
      {
        key: 'alerts:confirm',
        label: 'Confirm and dismiss alerts',
        phrase: 'confirm alerts',
        description:
          'Take responsibility for a detection, or mark it a false positive. The decision is recorded against their account.',
        note: 'This is the only permission that can begin an escalation. Give it to people you would trust to make that call.',
      },
    ],
  },
  {
    id: 'modules',
    label: 'Detection modules',
    permissions: [
      {
        key: 'modules:manage',
        label: 'Turn detection on and off',
        phrase: 'turn detection modules on and off',
        description:
          'Choose which detections run on which cameras, across the zones this role can reach.',
      },
    ],
  },
  {
    id: 'records',
    label: 'Records and reporting',
    permissions: [
      {
        key: 'history:view',
        label: 'Search past detections',
        phrase: 'search past detections',
        description: 'Open the history of everything raised, with the clip and the decision.',
      },
      {
        key: 'analytics:view',
        label: 'See analytics',
        phrase: 'see analytics',
        description: 'Detection volume, false-positive rates and response times.',
      },
      {
        key: 'audit:view',
        label: 'Read the audit log',
        phrase: 'read the audit log',
        description: 'Every action taken in the account, by whom, and when.',
      },
    ],
  },
  {
    id: 'organisation',
    label: 'Running the organisation',
    permissions: [
      {
        key: 'org:overview',
        label: 'See the overview',
        phrase: 'see the overview',
        description: 'The dashboard of what is happening across your sites.',
      },
      {
        key: 'users:manage',
        label: 'Manage people and roles',
        phrase: 'manage people and roles',
        description: 'Invite people, build roles, and change what anyone can do.',
        note: 'Someone with this can change what everyone in your organisation can do — including their own role, and including handing this same permission to somebody else.',
      },
      {
        key: 'billing:manage',
        label: 'Manage billing',
        phrase: 'manage billing',
        description: 'The plan, invoices, payment method and billing contact.',
      },
      {
        key: 'org:settings',
        label: 'Change organisation settings',
        phrase: 'change organisation settings',
        description: 'Sites and zones, notification routes, and escalation contacts.',
      },
    ],
  },
]

export const ALL_PERMISSIONS: PermissionDef[] = PERMISSION_GROUPS.flatMap(
  (group) => group.permissions,
)

export const ALL_PERMISSION_KEYS = ALL_PERMISSIONS.map((p) => p.key)

export function permissionByKey(key: string) {
  return ALL_PERMISSIONS.find((permission) => permission.key === key)
}

function joinPhrases(phrases: string[]) {
  if (phrases.length <= 1) return phrases[0] ?? ''
  return `${phrases.slice(0, -1).join(', ')} and ${phrases[phrases.length - 1]}`
}

/**
 * A role's permissions as a sentence, never as a list of keys.
 *
 * Whoever is handing out access has to be able to read what they are handing
 * out. `cameras:view, alerts:confirm` is a thing the machine understands; it is
 * not a thing an office manager can check before pressing save.
 */
export function summarisePermissions(permissions: string[]): string {
  const held = ALL_PERMISSIONS.filter((permission) =>
    permissions.includes(permission.key),
  )

  if (held.length === 0) {
    return 'Nothing yet. Nobody holding this role can see anything.'
  }
  if (held.length === ALL_PERMISSIONS.length) {
    return 'Everything in this organisation.'
  }
  return `Can ${joinPhrases(held.map((permission) => permission.phrase))}.`
}

/** The notes worth repeating wherever the role is shown. */
export function notesFor(permissions: string[]): string[] {
  return ALL_PERMISSIONS.filter(
    (permission) => permissions.includes(permission.key) && permission.note,
  ).map((permission) => permission.note as string)
}

/** `null` zones means every camera; otherwise the zones it is held to. */
export function summariseScope(zones: string[] | null): string {
  if (zones === null) return 'All cameras'
  if (zones.length === 0) return 'No zones — this role reaches no cameras'
  if (zones.length === 1) return `${zones[0]} only`
  return `${zones.slice(0, -1).join(', ')} and ${zones[zones.length - 1]} only`
}
