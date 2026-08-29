import { Panel, PanelBody } from '@/components/ui/panel'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { Route } from '@/lib/notifications/routing'
import { coverageFor, hearsAlerts, peopleIn } from '@/lib/notifications/routing'
import type { Person, Role } from '@/lib/roles/api'
import { cn } from '@/lib/utils'

/**
 * Who is reached, and how.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THERE IS NO CHANNEL PREFERENCE TO EDIT, SO THERE IS NO CONTROL FOR ONE
 *
 * `Person` in `lib/roles/api.ts` carries an id, a name, an email address, a
 * role and a status. It has no channel preference, no notification setting, no
 * record of consent, and no telephone number — that last one is decisive. A
 * per-person channel matrix would mean inventing the preference field, the
 * consent record *and* the number to send to, and then drawing switches that
 * write to none of them.
 *
 * The product's given is a push notification in the app: that is what "alerts
 * on your phone" in the plan catalogue means, and it is the same for everybody.
 * Email and SMS were raised in planning as options. Neither has a field, and
 * SMS has no address of any kind. So the column below is honest and identical
 * on every row, and the gap is stated rather than papered over with a control.
 *
 * This is the same refusal as coupons on platform billing, staged rollout on
 * module flags, and `cameras:manage` in the role builder. Transport detail —
 * which sender, which SMS provider, which retry policy — is backend
 * infrastructure and would not belong on this page even once it exists.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * What the table *does* earn its place doing is the inverse of the routing
 * lists above: reading down the routes, it is possible to narrow three of them
 * and not notice that one person now hears about nothing. Here that is a row
 * with an empty middle column, in Signal, impossible to miss.
 */
export function ChannelsSection({
  routes,
  roles,
  people,
  zones,
  modules,
}: {
  routes: Route[]
  roles: Role[]
  people: Person[]
  zones: string[]
  /** Live detection modules — id and name, for the coverage column. */
  modules: { id: string; name: string }[]
}) {
  // Only people who can actually receive something. Somebody whose role holds
  // no alerts grant is not a notification recipient with nothing selected — they
  // are not a recipient at all, and listing them here would suggest otherwise.
  const recipients = peopleIn(roles.filter(hearsAlerts), people)

  return (
    <Panel label="Who is reached, and how" className="mb-6">
      <PanelBody className="border-b border-neutral-200 py-4">
        <p className="max-w-2xl text-meta text-neutral-600">
          Everyone below is reached the same way, because there is only one way:
          a push notification in the Detecto app. There is no per-person channel
          setting to make — see the note under the table.
        </p>
      </PanelBody>

      {recipients.length === 0 ? (
        <PanelBody>
          <p className="max-w-2xl text-body text-neutral-700">
            Nobody in your organisation can receive an alert notification. That
            needs a role holding{' '}
            <span className="font-medium text-ink">See the alert queue</span> or{' '}
            <span className="font-medium text-ink">Confirm and dismiss alerts</span>
            , and somebody active on it. Both are set on the People page.
          </p>
        </PanelBody>
      ) : (
        <PanelBody className="py-2 sm:py-3">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Person</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Told about</TableHead>
                <TableHead>Reached by</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recipients.map((person) => (
                <PersonRow
                  key={person.id}
                  person={person}
                  role={roles.find((item) => item.id === person.roleId)}
                  routes={routes}
                  roles={roles}
                  zones={zones}
                  modules={modules}
                />
              ))}
            </TableBody>
          </Table>
        </PanelBody>
      )}

      <PanelBody className="border-t border-neutral-200 py-4">
        <h3 className="text-meta font-medium text-ink">
          No channel preferences, and no way to add one yet
        </h3>
        <p className="mt-1 max-w-2xl text-meta text-neutral-600">
          A person in Detecto has a name, an email address and a role. There is
          no field anywhere holding which channel they want alerts on, no record
          of them consenting to one, and no telephone number at all. Email and
          SMS were both raised while this was being planned; neither has anywhere
          to be stored, and SMS has no number to send to. Rather than draw
          switches that write to nothing, this page offers none — the same
          reason there is no coupons section on platform billing and no staged
          rollout on module flags.
        </p>
      </PanelBody>
    </Panel>
  )
}

function PersonRow({
  person,
  role,
  routes,
  roles,
  zones,
  modules,
}: {
  person: Person
  role: Role | undefined
  routes: Route[]
  roles: Role[]
  zones: string[]
  modules: { id: string; name: string }[]
}) {
  const coverage = coverageFor(
    person,
    routes,
    roles,
    zones,
    modules.map((module) => module.id),
  )

  const zoneWord =
    coverage.zones.length === 0
      ? null
      : coverage.zones.length === zones.length && zones.length > 0
        ? `All ${zones.length === 1 ? 'zone' : `${zones.length} zones`}`
        : coverage.zones.join(', ')

  const moduleWord =
    coverage.modules.length === 0
      ? null
      : coverage.modules
          .map((id) => modules.find((module) => module.id === id)?.name)
          .filter((name): name is string => Boolean(name))
          .join(', ')

  const told = [zoneWord, moduleWord].filter(Boolean) as string[]

  return (
    <TableRow>
      <TableCell>
        <span className="font-medium text-ink">{person.name}</span>
        <span className="block truncate font-mono text-data text-neutral-500">
          {person.email}
        </span>
      </TableCell>
      <TableCell className="text-neutral-700">{role?.name ?? 'No role'}</TableCell>
      <TableCell className={cn(told.length === 0 && 'text-signal-700')}>
        {told.length === 0 ? 'Nothing — every route has been narrowed past them' : told.join(' · ')}
      </TableCell>
      <TableCell className="whitespace-nowrap text-neutral-700">
        Push, in the app
      </TableCell>
    </TableRow>
  )
}
