import { fireEvent, waitFor } from '@testing-library/react'
import { beforeAll, describe, expect, it } from 'vitest'

import { listAlerts, type Alert } from '@/lib/alerts/api'
import { ALERTS_KEY } from '@/lib/alerts/queries'
import type { Camera } from '@/lib/cameras/api'
import { CAMERAS_KEY } from '@/lib/cameras/queries'
import { MOCK_CATALOGUE } from '@/lib/modules/catalogue'
import { MODULES_KEY } from '@/lib/modules/queries'
import type { NotificationSettings } from '@/lib/notifications/api'
import { NOTIFICATIONS_KEY } from '@/lib/notifications/queries'
import type { Directory, Person, Role } from '@/lib/roles/api'
import { DIRECTORY_KEY } from '@/lib/roles/queries'
import { ALL_PERMISSION_KEYS } from '@/lib/roles/permissions'
import OrgNotificationsPage from '@/pages/org/settings/notifications'
import { NO_GRANTS, renderPage, signIn } from '@/test/harness'
import type { Claims } from '@/lib/auth/claims'

/**
 * The notifications page, rendered against a directory with more than one role
 * in it.
 *
 * The dev mock seeds exactly one role on purpose — Detecto does not invent a
 * ladder of roles for a customer — but a routing page whose whole subject is
 * narrowing needs at least two to have anything to narrow *to*. So the
 * directory here is a fixture rather than the mock: it is the shape a real
 * organisation reaches after using the People page, which is the state this
 * page is for.
 */

const ORG_ADMIN: Claims = {
  sub: 'usr_admin',
  email: 'admin@northgate.com',
  role: 'org_admin',
  permissions: ALL_PERMISSION_KEYS,
  orgId: 'org_northgate',
  exp: Math.floor(Date.now() / 1000) + 900,
}

const CONTROL_ROOM: Role = {
  id: 'role_control',
  name: 'Control room',
  permissions: ['alerts:view', 'alerts:confirm', 'org:settings'],
  zones: null,
  isDefault: true,
}

const YARD_TEAM: Role = {
  id: 'role_yard',
  name: 'Yard team',
  permissions: ['alerts:view'],
  zones: ['Yard'],
  isDefault: false,
}

/** Holds no alerts grant, so it can never be a notification recipient. */
const INSTALLER: Role = {
  id: 'role_installer',
  name: 'Installer',
  permissions: ['cameras:view'],
  zones: null,
  isDefault: false,
}

const PEOPLE: Person[] = [
  {
    id: 'usr_admin',
    name: 'Ade Okafor',
    email: 'admin@northgate.com',
    roleId: 'role_control',
    status: 'active',
    invitedAt: null,
  },
  {
    id: 'usr_rhea',
    name: 'Rhea Mehta',
    email: 'rhea.mehta@northgate.com',
    roleId: 'role_yard',
    status: 'active',
    invitedAt: null,
  },
  {
    id: 'usr_tomas',
    name: 'Tomas Bergstrom',
    email: 'tomas.bergstrom@northgate.com',
    roleId: 'role_yard',
    status: 'invited',
    invitedAt: new Date().toISOString(),
  },
  {
    id: 'usr_joan',
    name: 'Joan Whitfield',
    email: 'joan.whitfield@northgate.com',
    roleId: 'role_installer',
    status: 'active',
    invitedAt: null,
  },
]

const DIRECTORY: Directory = {
  roles: [CONTROL_ROOM, YARD_TEAM, INSTALLER],
  people: PEOPLE,
}

const CAMERAS: Camera[] = [
  { id: 'cam_1', name: 'Main entrance', zone: 'Front of house', online: true, lastSeen: null },
  { id: 'cam_2', name: 'Loading bay', zone: 'Yard', online: true, lastSeen: null },
  { id: 'cam_3', name: 'Gate', zone: 'Yard', online: true, lastSeen: null },
]

const DEFAULTS: NotificationSettings = {
  routes: [],
  escalation: { enabled: false, afterMinutes: 15, roleIds: [] },
}

let alerts: Alert[]

beforeAll(async () => {
  const result = await listAlerts()
  if (!result.ok) throw new Error(result.code)
  alerts = result.alerts
})

function open(settings: NotificationSettings = DEFAULTS) {
  return renderPage(<OrgNotificationsPage />, {
    seed: (client) => {
      client.setQueryData(NOTIFICATIONS_KEY, settings)
      client.setQueryData(DIRECTORY_KEY, DIRECTORY)
      client.setQueryData(CAMERAS_KEY, CAMERAS)
      client.setQueryData(MODULES_KEY, {
        modules: MOCK_CATALOGUE,
        cameras: CAMERAS.map((camera) => ({ cameraId: camera.id, enabled: [] })),
      })
      client.setQueryData(ALERTS_KEY, alerts)
    },
  })
}

/** Opens one collapsed route row by its heading. */
function expand(view: ReturnType<typeof open>, name: string | RegExp) {
  fireEvent.click(view.getByRole('button', { name }))
}

describe('permissions', () => {
  it('shows the routing read-only to somebody without the grant', () => {
    // `org:settings` — the key that already gates this area, and whose own
    // description names notification routes. No new key.
    signIn(NO_GRANTS)
    const view = open()

    expect(view.text()).toContain("You don't have permission to change notification settings")
    expect(view.queryByRole('button', { name: 'Review the change' })).toBeNull()
  })

  it('offers the controls to an administrator', () => {
    signIn(ORG_ADMIN)
    expect(open().getByRole('button', { name: 'Review the change' })).toBeTruthy()
  })
})

describe('what the page says about itself', () => {
  it('leads with the fact that nothing is delivered yet', () => {
    // Above the controls, not in a footnote: an administrator who narrows a
    // route and walks away believing somebody is being paged has been misled.
    signIn(ORG_ADMIN)
    expect(open().text()).toContain('Detecto does not send these notifications yet')
  })

  it('says routing is stored and will be honoured', () => {
    signIn(ORG_ADMIN)
    expect(open().text()).toContain('who would be told, and when')
  })
})

describe('routing by zone', () => {
  it('lists the zones the cameras actually report', () => {
    signIn(ORG_ADMIN)
    const out = open().text()

    expect(out).toContain('Front of house')
    expect(out).toContain('Yard')
    expect(out).toContain('2 cameras')
  })

  it('names the people a zone reaches by default, without any setup', () => {
    signIn(ORG_ADMIN)
    const out = open().text()

    // Control room reaches everything; the yard team only the yard.
    expect(out).toContain('Ade Okafor')
    expect(out).toContain('Rhea Mehta')
  })

  it('leaves out somebody whose invitation is unanswered', () => {
    signIn(ORG_ADMIN)
    const view = open()
    expand(view, /Yard/)

    // Two people hold the yard role; one has never accepted. Counting them
    // would tell an administrator three people are watching the yard when two
    // are.
    expect(view.text()).toContain('has not accepted an invitation')
    expect(view.text()).toContain('2 people would be notified')
  })

  it('offers no role that cannot see alerts', () => {
    // Routing to a role holding neither alerts grant would store a decision the
    // claims system contradicts.
    signIn(ORG_ADMIN)
    const view = open()
    expand(view, /Front of house/)

    fireEvent.click(view.getByRole('radio', { name: /Only these roles/ }))
    expect(view.text()).toContain('Control room')
    expect(view.text()).not.toContain('Installer')
  })

  it('refuses to save a route that would tell nobody', () => {
    signIn(ORG_ADMIN)
    const view = open()
    expand(view, /Front of house/)

    fireEvent.click(view.getByRole('radio', { name: /Only these roles/ }))
    for (const box of view.getAllByRole('checkbox')) {
      if ((box as HTMLInputElement).checked) fireEvent.click(box)
    }

    expect(view.text()).toContain('Nobody would be told about Front of house')
    expect((view.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('offers Save only once something has actually changed', () => {
    // Persisting is exercised against the store in `lib/notifications/api.test.ts`.
    // Completing a mutation here would invalidate the seeded directory and
    // refetch the dev mock over this fixture, which tests the harness rather
    // than the page — the same reason the module-flags suite stops at the
    // confirm step.
    signIn(ORG_ADMIN)
    const view = open()
    expand(view, /Yard/)

    const save = () => view.getByRole('button', { name: 'Save' }) as HTMLButtonElement
    expect(save().disabled).toBe(true)

    fireEvent.click(view.getByRole('radio', { name: /Only these roles/ }))
    fireEvent.click(view.getByRole('checkbox', { name: /Control room/ }))
    expect(save().disabled).toBe(false)
  })

  it('marks a route that has been narrowed', () => {
    signIn(ORG_ADMIN)
    const view = open({
      ...DEFAULTS,
      routes: [{ kind: 'zone', target: 'Yard', roleIds: ['role_yard'] }],
    })

    expect(view.text()).toContain('Narrowed')
  })
})

describe('routing by detection type', () => {
  it('lists the live modules and nothing that cannot be raised', () => {
    signIn(ORG_ADMIN)
    const out = open().text()

    expect(out).toContain('Weapon detection')
    expect(out).toContain('Violence detection')
    // Coming-soon modules raise nothing, so routing them would configure for
    // something that cannot happen.
    expect(out).not.toContain('Forced movement')
  })

  it('says a detection type is not narrowed to a place', () => {
    signIn(ORG_ADMIN)
    expect(open().text()).toContain('A detection type is not a place')
  })

  it('does not credit a zone-scoped person with detections site-wide', () => {
    // Rhea's role reaches the yard only. The detection-type routes name every
    // alerts role by default, and her access still decides what reaches her —
    // so this column must not read as "every weapon detection, everywhere".
    signIn(ORG_ADMIN)
    const out = open().text()

    expect(out).toContain('Rhea Mehtarhea.mehta@northgate.comYard teamYard ·')
    expect(out).toContain('Ade Okaforadmin@northgate.comControl roomAll 2 zones')
  })
})

describe('when both routes apply', () => {
  it('states plainly that it is a union, and why', () => {
    signIn(ORG_ADMIN)
    const out = open().text()

    expect(out).toContain('Everybody named by either is told')
    expect(out).toContain('an alert nobody hears about')
  })

  it('says routing cannot widen anybody’s access', () => {
    signIn(ORG_ADMIN)
    const out = open().text()

    expect(out).toContain("What routing cannot do is widen somebody's access")
    expect(out).toContain('being told about an alert you are not allowed to open')
  })
})

describe('channels', () => {
  it('says push is the only channel, on every row', () => {
    signIn(ORG_ADMIN)
    const out = open().text()

    expect(out).toContain('Push, in the app')
    expect(out).toContain('a push notification in the Detecto app')
  })

  it('flags the missing field rather than drawing a control for it', () => {
    signIn(ORG_ADMIN)
    const view = open()

    expect(view.text()).toContain('No channel preferences, and no way to add one yet')
    expect(view.text()).toContain('no telephone number at all')
    // No switches or checkboxes offering email or SMS anywhere on the page.
    for (const invented of [/email/i, /sms/i, /text message/i]) {
      expect(view.queryAllByRole('checkbox', { name: invented })).toHaveLength(0)
      expect(view.queryAllByRole('switch', { name: invented })).toHaveLength(0)
    }
  })

  it('leaves out somebody who could never receive an alert', () => {
    signIn(ORG_ADMIN)
    // Joan holds `cameras:view` only — not a recipient with nothing selected,
    // simply not a recipient.
    expect(open().text()).not.toContain('Joan Whitfield')
  })

  it('shows when every route has been narrowed past somebody', () => {
    signIn(ORG_ADMIN)
    const view = open({
      ...DEFAULTS,
      routes: [
        { kind: 'zone', target: 'Yard', roleIds: ['role_control'] },
        { kind: 'zone', target: 'Front of house', roleIds: ['role_control'] },
        { kind: 'module', target: 'weapon', roleIds: ['role_control'] },
        { kind: 'module', target: 'violence', roleIds: ['role_control'] },
      ],
    })

    expect(view.text()).toContain('Nothing — every route has been narrowed past them')
  })
})

describe('escalation', () => {
  it('is off until somebody turns it on', () => {
    signIn(ORG_ADMIN)
    const view = open()

    expect(view.text()).toContain('Nothing escalates until you turn this on')
    expect(
      (view.getByRole('switch', { name: /Notify somebody else/ }) as HTMLInputElement).checked,
    ).toBe(false)
  })

  it('says on the panel that it never contacts an authority', () => {
    signIn(ORG_ADMIN)
    const out = open().text()

    expect(out).toContain('This only ever notifies people in your organisation')
    expect(out).toContain('It does not contact the police, a guard company, or any emergency service')
  })

  it('offers three thresholds and no freeform timer', () => {
    signIn(ORG_ADMIN)
    const view = open()
    fireEvent.click(view.getByRole('switch', { name: /Notify somebody else/ }))

    for (const minutes of [5, 15, 30]) {
      expect(view.getByRole('radio', { name: `${minutes} minutes` })).toBeTruthy()
    }
    expect(view.queryAllByRole('spinbutton')).toHaveLength(0)
  })

  it('shows what the threshold would have caught in the real queue', () => {
    signIn(ORG_ADMIN)
    const view = open()
    fireEvent.click(view.getByRole('switch', { name: /Notify somebody else/ }))

    const waiting = alerts.filter((alert) => alert.status === 'unconfirmed')
    const over = waiting.filter(
      (alert) => Date.now() - Date.parse(alert.detectedAt) > 15 * 60_000,
    )

    expect(over.length).toBeGreaterThan(0)
    expect(view.text()).toContain(
      `${over.length} of ${waiting.length} waiting now would have escalated`,
    )
  })

  it('does not save on the first click', () => {
    // A plain confirm step, because this changes who gets woken up. Opening it
    // must not be the same as agreeing to it.
    signIn(ORG_ADMIN)
    const view = open()

    fireEvent.click(view.getByRole('switch', { name: /Notify somebody else/ }))
    fireEvent.click(view.getByRole('checkbox', { name: /Control room/ }))
    fireEvent.click(view.getByRole('button', { name: 'Review the change' }))

    expect(view.text()).toContain('Turn escalation on?')
    expect(view.text()).not.toContain('Saving…')
  })

  it('states exactly what the setting will do, with names', () => {
    signIn(ORG_ADMIN)
    const view = open()

    fireEvent.click(view.getByRole('switch', { name: /Notify somebody else/ }))
    fireEvent.click(view.getByRole('radio', { name: '15 minutes' }))
    fireEvent.click(view.getByRole('checkbox', { name: /Control room/ }))
    fireEvent.click(view.getByRole('button', { name: 'Review the change' }))

    expect(view.text()).toContain(
      'If an alert is still unreviewed after 15 minutes, this also notifies Control room',
    )
    expect(view.text()).toContain('Ade Okafor')
  })

  it('repeats the authority line at the point of agreeing', () => {
    // Restated at the decision, not only at the top of the panel: this is the
    // setting that runs with nobody present.
    signIn(ORG_ADMIN)
    const view = open()

    fireEvent.click(view.getByRole('switch', { name: /Notify somebody else/ }))
    fireEvent.click(view.getByRole('checkbox', { name: /Control room/ }))
    fireEvent.click(view.getByRole('button', { name: 'Review the change' }))

    expect(view.text()).toContain('Nobody outside your organisation is contacted')
    expect(view.text()).toContain('after confirming the detection themselves')
  })

  it('says escalation widens the list rather than handing the alert over', () => {
    signIn(ORG_ADMIN)
    const view = open()

    fireEvent.click(view.getByRole('switch', { name: /Notify somebody else/ }))
    fireEvent.click(view.getByRole('checkbox', { name: /Yard team/ }))
    fireEvent.click(view.getByRole('button', { name: 'Review the change' }))

    expect(view.text()).toContain('Everyone already notified when the alert was raised stays notified')
  })

  it('warns when escalating to people who were already told', () => {
    signIn(ORG_ADMIN)
    const view = open()

    fireEvent.click(view.getByRole('switch', { name: /Notify somebody else/ }))
    fireEvent.click(view.getByRole('checkbox', { name: /Control room/ }))
    fireEvent.click(view.getByRole('button', { name: 'Review the change' }))

    expect(view.text()).toContain('tells the same people twice')
  })

  it('can be backed out of', () => {
    signIn(ORG_ADMIN)
    const view = open()

    fireEvent.click(view.getByRole('switch', { name: /Notify somebody else/ }))
    fireEvent.click(view.getByRole('checkbox', { name: /Control room/ }))
    fireEvent.click(view.getByRole('button', { name: 'Review the change' }))
    fireEvent.click(view.getByRole('button', { name: 'Back' }))

    expect(view.text()).not.toContain('Turn escalation on?')
  })

  it('will not offer to save an escalation that reaches nobody', () => {
    signIn(ORG_ADMIN)
    const view = open()
    fireEvent.click(view.getByRole('switch', { name: /Notify somebody else/ }))

    expect(view.text()).toContain('Nobody is selected, so nothing would happen')
    expect(
      (view.getByRole('button', { name: 'Review the change' }) as HTMLButtonElement).disabled,
    ).toBe(true)
  })

  it('agrees on one plain click, not a press-and-hold', async () => {
    // Press-and-hold is reserved for a person putting their name against a
    // detection. Spending it on a settings save would cheapen the one
    // interaction in the product that is allowed to feel heavy.
    signIn(ORG_ADMIN)
    const view = open()

    fireEvent.click(view.getByRole('switch', { name: /Notify somebody else/ }))
    fireEvent.click(view.getByRole('checkbox', { name: /Control room/ }))
    fireEvent.click(view.getByRole('button', { name: 'Review the change' }))

    const agree = view.getByRole('button', { name: /Escalate after 15 minutes/ })
    fireEvent.click(agree)

    // One click is the whole interaction — it dispatches on `click`, with no
    // pointer-down timer to satisfy first.
    await waitFor(() => {
      expect((agree as HTMLButtonElement).disabled).toBe(true)
    })
    expect(view.text()).toContain('Saving…')
  })
})

describe('the gaps this page is honest about', () => {
  it('lists what is not built, and why', () => {
    signIn(ORG_ADMIN)
    const out = open().text()

    expect(out).toContain('Nothing is delivered yet')
    expect(out).toContain('No per-person channel choice')
    expect(out).toContain('No quiet hours, and no per-person schedule')
  })

  it('keeps transport detail off the page, and says so', () => {
    signIn(ORG_ADMIN)
    const view = open()

    expect(view.text()).toContain('backend infrastructure and would not be decided here')
    // Not one freeform field anywhere: no sender to type in, no address, no
    // number. Every control on this page picks from people who already exist.
    expect(view.queryAllByRole('textbox')).toHaveLength(0)
    expect(view.queryAllByRole('spinbutton')).toHaveLength(0)
  })

  it('closes on the promise the alert screen makes', () => {
    signIn(ORG_ADMIN)
    expect(open().text()).toContain(
      'Detecto does not contact the police, a guard company or any emergency service',
    )
  })
})

describe('an organisation with nothing set up yet', () => {
  it('says there is nothing to route by place, without breaking', () => {
    signIn(ORG_ADMIN)
    const view = renderPage(<OrgNotificationsPage />, {
      seed: (client) => {
        client.setQueryData(NOTIFICATIONS_KEY, DEFAULTS)
        client.setQueryData(DIRECTORY_KEY, DIRECTORY)
        client.setQueryData(CAMERAS_KEY, [])
        client.setQueryData(MODULES_KEY, { modules: MOCK_CATALOGUE, cameras: [] })
        client.setQueryData(ALERTS_KEY, alerts)
      },
    })

    expect(view.text()).toContain('Your cameras have no zones yet')
    // Detection types still route: they do not depend on a camera existing.
    expect(view.text()).toContain('Weapon detection')
  })
})
