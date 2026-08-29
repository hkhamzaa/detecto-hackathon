import { fireEvent } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { Camera } from '@/lib/cameras/api'
import { CAMERAS_KEY } from '@/lib/cameras/queries'
import type { NotificationSettings } from '@/lib/notifications/api'
import { NOTIFICATIONS_KEY } from '@/lib/notifications/queries'
import { ALL_PERMISSION_KEYS } from '@/lib/roles/permissions'
import type { Directory, Role } from '@/lib/roles/api'
import { DIRECTORY_KEY } from '@/lib/roles/queries'
import type { Claims } from '@/lib/auth/claims'
import OrgZonesPage from '@/pages/org/settings/zones'
import { NO_GRANTS, renderPage, signIn } from '@/test/harness'

const ORG_ADMIN: Claims = {
  sub: 'usr_admin',
  email: 'admin@northgate.com',
  role: 'org_admin',
  permissions: ALL_PERMISSION_KEYS,
  orgId: 'org_northgate',
  exp: Math.floor(Date.now() / 1000) + 900,
}

function camera(id: string, name: string, zone: string): Camera {
  return { id, name, zone, online: true, lastSeen: null }
}

const CAMERAS: Camera[] = [
  camera('cam_1', 'Loading bay', 'Yard'),
  camera('cam_2', 'Gate', 'Yard'),
  camera('cam_3', 'Main entrance', 'Front of house'),
]

const YARD_TEAM: Role = {
  id: 'role_yard',
  name: 'Yard team',
  permissions: ['alerts:view'],
  zones: ['Yard'],
  isDefault: false,
}

const CONTROL_ROOM: Role = {
  id: 'role_control',
  name: 'Control room',
  permissions: ['alerts:view', 'alerts:confirm', 'org:settings'],
  zones: null,
  isDefault: true,
}

const DIRECTORY: Directory = {
  roles: [CONTROL_ROOM, YARD_TEAM],
  people: [
    {
      id: 'usr_admin',
      name: 'Ade Okafor',
      email: 'admin@northgate.com',
      roleId: 'role_control',
      status: 'active',
      invitedAt: null,
    },
  ],
}

const SETTINGS: NotificationSettings = {
  routes: [{ kind: 'zone', target: 'Yard', roleIds: ['role_yard'] }],
  escalation: { enabled: false, afterMinutes: 15, roleIds: [] },
}

function open({
  cameras = CAMERAS,
  directory = DIRECTORY,
  settings = SETTINGS,
}: {
  cameras?: Camera[]
  directory?: Directory
  settings?: NotificationSettings
} = {}) {
  return renderPage(<OrgZonesPage />, {
    seed: (client) => {
      client.setQueryData(CAMERAS_KEY, cameras)
      client.setQueryData(DIRECTORY_KEY, directory)
      client.setQueryData(NOTIFICATIONS_KEY, settings)
    },
  })
}

/** Opens one zone's rename or merge panel. */
function act(view: ReturnType<typeof open>, name: string | RegExp) {
  fireEvent.click(view.getByRole('button', { name }))
}

describe('the zones themselves', () => {
  it('lists the zones the cameras are actually in', () => {
    signIn(ORG_ADMIN)
    const out = open().text()

    expect(out).toContain('Yard')
    expect(out).toContain('Front of house')
  })

  it('says what each one is holding up', () => {
    signIn(ORG_ADMIN)
    // Yard: two cameras, the yard team, and a notification route.
    expect(open().text()).toContain('2 cameras, 1 role and 1 notification route')
  })

  it('offers no way to create one, because a zone with no cameras is not a place', () => {
    signIn(ORG_ADMIN)
    const view = open()

    expect(view.queryAllByRole('button', { name: /add zone|create zone|new zone/i })).toHaveLength(0)
    expect(view.text()).toContain('Zones are created by assigning a camera')
  })

  it('explains that a zone is a name in three places, not a record', () => {
    signIn(ORG_ADMIN)
    const out = open().text()

    expect(out).toContain('A zone is a name, not a record')
    expect(out).toContain('would leave people holding access to a zone that no longer')
  })

  it('sends somebody with no cameras to connect some first', () => {
    signIn(ORG_ADMIN)
    expect(open({ cameras: [] }).text()).toContain('No cameras yet')
  })
})

describe('cameras with no zone', () => {
  it('names them, and says exactly what they miss', () => {
    signIn(ORG_ADMIN)
    const out = open({
      cameras: [...CAMERAS, camera('cam_4', 'Skip', '')],
    }).text()

    expect(out).toContain('1 camera is not in any zone: Skip')
    // The important half: they are still watched.
    expect(out).toContain('They are still watched')
    expect(out).toContain('a zone notification route will not cover them')
  })

  it('says nothing when every camera has one', () => {
    signIn(ORG_ADMIN)
    expect(open().text()).not.toContain('not in any zone')
  })
})

describe('names nothing is in', () => {
  it('flags a role still held to a zone with no cameras', () => {
    signIn(ORG_ADMIN)
    const stranded: Role = { ...YARD_TEAM, zones: ['Yard', 'Perimeter'] }

    const out = open({
      directory: { ...DIRECTORY, roles: [CONTROL_ROOM, stranded] },
    }).text()

    expect(out).toContain('Names nothing is in')
    expect(out).toContain('Perimeter')
    expect(out).toContain('reaches no cameras through this name')
  })

  it('offers no control for one, because tidying it belongs to another page', () => {
    signIn(ORG_ADMIN)
    const stranded: Role = { ...YARD_TEAM, zones: ['Perimeter'] }
    const view = open({ directory: { ...DIRECTORY, roles: [CONTROL_ROOM, stranded] } })

    expect(view.text()).toContain('by editing the role that names it')
  })
})

describe('renaming', () => {
  it('says what it will rewrite, and that access does not move', () => {
    signIn(ORG_ADMIN)
    const view = open()

    act(view, 'Rename Yard')
    expect(view.text()).toContain('rewrites the name on 2 cameras, 1 role and 1 notification route')
    expect(view.text()).toContain("Nobody's access changes")
  })

  it('says history keeps the old name', () => {
    signIn(ORG_ADMIN)
    const view = open()

    act(view, 'Rename Yard')
    expect(view.text()).toContain('Detections already raised keep the name they were raised under')
  })

  it('refuses a name that is already a different zone, and points at merge', () => {
    signIn(ORG_ADMIN)
    const view = open()

    act(view, 'Rename Yard')
    fireEvent.change(view.getByLabelText('New name'), {
      target: { value: 'Front of house' },
    })

    expect(view.text()).toContain('already has a zone called')
    expect(
      (view.getByRole('button', { name: 'Rename everywhere' }) as HTMLButtonElement).disabled,
    ).toBe(true)
  })

  it('will not submit an unchanged name', () => {
    signIn(ORG_ADMIN)
    const view = open()

    act(view, 'Rename Yard')
    expect(
      (view.getByRole('button', { name: 'Rename everywhere' }) as HTMLButtonElement).disabled,
    ).toBe(true)
  })

  it('allows a genuinely new name', () => {
    signIn(ORG_ADMIN)
    const view = open()

    act(view, 'Rename Yard')
    fireEvent.change(view.getByLabelText('New name'), {
      target: { value: 'Loading yard' },
    })

    expect(
      (view.getByRole('button', { name: 'Rename everywhere' }) as HTMLButtonElement).disabled,
    ).toBe(false)
  })
})

describe('merging', () => {
  it('does not merge on the first click', () => {
    signIn(ORG_ADMIN)
    const view = open()

    act(view, 'Merge Yard into another zone')
    expect(view.text()).toContain('Merge Yard into another zone')
    expect(view.text()).not.toContain('Merging…')
  })

  it('states what it affects, as a count', () => {
    signIn(ORG_ADMIN)
    const view = open()

    act(view, 'Merge Yard into another zone')
    fireEvent.click(view.getByRole('button', { name: 'Review the merge' }))

    expect(view.text()).toContain(
      '2 cameras, 1 role and 1 notification route reference Yard',
    )
    expect(view.text()).toContain('2 cameras move into Front of house')
  })

  it('warns that access widens, and names who gains what', () => {
    // The consequence somebody would otherwise discover afterwards.
    signIn(ORG_ADMIN)
    const view = open()

    act(view, 'Merge Yard into another zone')
    fireEvent.click(view.getByRole('button', { name: 'Review the merge' }))

    expect(view.text()).toContain('This widens access')
    expect(view.text()).toContain('Yard team will be able to open 1 camera it cannot today')
  })

  it('says who ends up being notified, and why', () => {
    signIn(ORG_ADMIN)
    const view = open()

    act(view, 'Merge Yard into another zone')
    fireEvent.click(view.getByRole('button', { name: 'Review the merge' }))

    // Yard was narrowed, Front of house was not — so the merged zone widens.
    expect(view.text()).toContain('nobody stops being notified')
  })

  it('says it cannot be undone by merging back', () => {
    signIn(ORG_ADMIN)
    const view = open()

    act(view, 'Merge Yard into another zone')
    fireEvent.click(view.getByRole('button', { name: 'Review the merge' }))

    expect(view.text()).toContain('cannot be undone by merging back')
  })

  it('can be backed out of', () => {
    signIn(ORG_ADMIN)
    const view = open()

    act(view, 'Merge Yard into another zone')
    fireEvent.click(view.getByRole('button', { name: 'Review the merge' }))
    fireEvent.click(view.getByRole('button', { name: 'Back' }))

    expect(view.text()).not.toContain('This widens access')
  })

  it('is not offered when there is only one zone to merge with', () => {
    signIn(ORG_ADMIN)
    const view = open({ cameras: [camera('cam_1', 'Loading bay', 'Yard')] })

    expect(view.queryAllByRole('button', { name: /^Merge / })).toHaveLength(0)
  })
})

describe('permissions', () => {
  it('shows the zones read-only to somebody without the grant', () => {
    // `org:settings`, matching the notification settings beside it.
    signIn(NO_GRANTS)
    const view = open()

    expect(view.text()).toContain('Yard')
    expect(view.queryAllByRole('button', { name: /^Rename / })).toHaveLength(0)
    expect(view.queryAllByRole('button', { name: /^Merge / })).toHaveLength(0)
  })
})

describe('when the page cannot see everything', () => {
  it('refuses to offer either action rather than understating what they touch', () => {
    // Roles and routes are unreachable, so the counts would only include
    // cameras — and agreeing to a merge on an understated count is exactly the
    // thing the confirm step exists to prevent.
    signIn(ORG_ADMIN)
    const view = renderPage(<OrgZonesPage />, {
      seed: (client) => {
        client.setQueryData(CAMERAS_KEY, CAMERAS)
      },
    })

    expect(view.text()).toContain("couldn't reach your roles or your notification routing")
    expect(view.queryAllByRole('button', { name: /^Rename / })).toHaveLength(0)
  })
})
