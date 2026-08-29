import { useId, useState } from 'react'
import { ChevronRight } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { StatusWord } from '@/components/ui/status-word'
import type { NotificationRoute } from '@/lib/notifications/api'
import { useSetRoute } from '@/lib/notifications/queries'
import {
  countPeople,
  hearsAlerts,
  pendingIn,
  peopleIn,
  reaches,
  rolesFor,
  summariseNames,
  type RouteKind,
} from '@/lib/notifications/routing'
import type { Person, Role } from '@/lib/roles/api'
import { cn } from '@/lib/utils'

/**
 * One zone or one detection type, and who hears about it.
 *
 * Opening the row shows the two states this setting has: the default, which is
 * everyone whose role can see alerts, and a narrower list the organisation
 * chose. There is no third state — a route is never "off", because a detection
 * nobody is told about is a detection that did not need to be raised.
 *
 * The recipient count is resolved and shown before anything is saved. Narrowing
 * routing is the kind of change whose consequence is invisible until the night
 * it matters, so the consequence is put on screen first: these people, by name.
 */
export function RouteRow({
  kind,
  target,
  label,
  detail,
  route,
  roles,
  people,
  canManage,
}: {
  kind: RouteKind
  /** The zone name or module id this route is keyed on. */
  target: string
  /** What it is called on screen. */
  label: string
  /** The line under the name — camera count, or what the module looks for. */
  detail: string
  route: NotificationRoute | undefined
  roles: Role[]
  people: Person[]
  canManage: boolean
}) {
  const panelId = useId()
  const [open, setOpen] = useState(false)

  const override = route?.roleIds ?? null
  const current = rolesFor(kind, target, override, roles)
  const recipients = peopleIn(current, people)

  return (
    <li>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          'flex w-full items-start gap-3 px-5 py-4 text-left sm:px-6',
          'transition-colors duration-150 hover:bg-paper-sunken',
          'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring',
        )}
      >
        <ChevronRight
          aria-hidden="true"
          className={cn(
            'mt-1 size-4 shrink-0 text-neutral-400 transition-transform duration-150',
            open && 'rotate-90',
          )}
        />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="truncate text-body font-medium text-ink">{label}</span>
            {override !== null && (
              <span className="label-micro text-neutral-500">Narrowed</span>
            )}
          </span>
          <span className="mt-1 block text-meta text-neutral-500">{detail}</span>
          <span className="mt-2 block">
            {/* Nobody is the one state that needs a person. Everything else is
                a setting working as intended, however few people it names. */}
            <StatusWord
              tone={recipients.length === 0 ? 'signal' : 'confirm'}
              className="text-meta"
            >
              {recipients.length === 0
                ? 'Nobody would be told'
                : `${countPeople(recipients)} — ${summariseNames(recipients)}`}
            </StatusWord>
          </span>
        </span>
      </button>

      {open && (
        <div
          id={panelId}
          className="border-t border-neutral-200 bg-paper-sunken px-5 py-6 sm:px-6"
        >
          <Editor
            kind={kind}
            target={target}
            label={label}
            override={override}
            roles={roles}
            people={people}
            canManage={canManage}
            onDone={() => setOpen(false)}
          />
        </div>
      )}
    </li>
  )
}

/* -------------------------------------------------------------------------- */
/* The editor                                                                 */
/* -------------------------------------------------------------------------- */

function Editor({
  kind,
  target,
  label,
  override,
  roles,
  people,
  canManage,
  onDone,
}: {
  kind: RouteKind
  target: string
  label: string
  override: string[] | null
  roles: Role[]
  people: Person[]
  canManage: boolean
  onDone: () => void
}) {
  const groupName = useId()
  const mutation = useSetRoute()

  const [narrowed, setNarrowed] = useState(override !== null)
  const [picked, setPicked] = useState<string[]>(
    override ?? rolesFor(kind, target, null, roles).map((role) => role.id),
  )

  const intended = narrowed ? picked : null
  const resolved = rolesFor(kind, target, intended, roles)
  const recipients = peopleIn(resolved, people)
  const pending = pendingIn(resolved, people)

  // Only roles that can see alerts at all are offerable. Routing a detection to
  // a role holding neither alerts grant would store a decision the claims
  // system contradicts — they would be "notified" about a queue they cannot
  // open. The role builder is where that is fixed, not here.
  //
  // A zone also drops roles whose access does not reach it, for the same
  // reason: ticking one would be a control that visibly does nothing, because
  // scope is applied whatever the routing says.
  const eligible = roles.filter(
    (role) => hearsAlerts(role) && (kind === 'module' || reaches(role, target)),
  )
  const dirty =
    (intended === null) !== (override === null) ||
    (intended !== null && override !== null && !sameIds(intended, override))

  if (mutation.isSuccess) {
    return (
      <div>
        <p role="status" className="max-w-prose text-body text-ink">
          Saved. {label} now notifies{' '}
          {recipients.length === 0 ? 'nobody' : summariseNames(recipients)}.
        </p>
        <Button type="button" variant="outline" className="mt-4" onClick={onDone}>
          Done
        </Button>
      </div>
    )
  }

  return (
    <div>
      <fieldset>
        <legend className="text-meta font-medium text-ink">
          Who is notified about {label}
        </legend>

        <div className="mt-4 grid gap-3">
          <Choice
            name={groupName}
            checked={!narrowed}
            disabled={!canManage}
            onSelect={() => setNarrowed(false)}
            title="Everyone who can see alerts"
            description={
              kind === 'zone'
                ? 'Anyone whose role can see or confirm alerts, and whose access reaches this zone. This is the default, and it needs no setting up.'
                : 'Anyone whose role can see or confirm alerts. Their own zone access still decides which of these detections reach them.'
            }
          />
          <Choice
            name={groupName}
            checked={narrowed}
            disabled={!canManage}
            onSelect={() => setNarrowed(true)}
            title="Only these roles"
            description="For a team that should hear about one place, or one kind of detection, and not the rest."
          />
        </div>
      </fieldset>

      {narrowed && (
        <fieldset className="mt-6">
          <legend className="text-meta font-medium text-ink">Roles</legend>

          {eligible.length === 0 ? (
            <p className="mt-2 max-w-prose text-meta text-signal-700">
              No role in your organisation can see alerts, so there is nobody to
              narrow this to. Give a role the alert permissions on the People
              page first.
            </p>
          ) : (
            <ul className="mt-3 grid gap-3">
              {eligible.map((role) => (
                <li key={role.id} className="flex items-start gap-3">
                  <Checkbox
                    id={`${groupName}-${role.id}`}
                    checked={picked.includes(role.id)}
                    disabled={!canManage}
                    onChange={(event) =>
                      setPicked((current) =>
                        event.target.checked
                          ? [...current, role.id]
                          : current.filter((id) => id !== role.id),
                      )
                    }
                  />
                  <label
                    htmlFor={`${groupName}-${role.id}`}
                    className="cursor-pointer text-meta text-neutral-700"
                  >
                    <span className="font-medium text-ink">{role.name}</span>
                    <span className="block text-neutral-500">
                      {countPeople(peopleIn([role], people))} on this role
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </fieldset>
      )}

      {/* The consequence, resolved, before anything is written. */}
      <div className="mt-6 border-t border-neutral-200 pt-4">
        {recipients.length === 0 ? (
          <p className="max-w-prose text-meta text-signal-700">
            Nobody would be told about {label}. A detection would be raised, sit
            in the queue, and reach no one — so this cannot be saved. Pick at
            least one role with somebody active on it.
          </p>
        ) : (
          <p className="max-w-prose text-meta text-neutral-600">
            {countPeople(recipients)} would be notified: {summariseNames(recipients, 6)}.
            {pending.length > 0 && (
              <span className="text-neutral-500">
                {' '}
                {countPeople(pending)} on these roles{' '}
                {pending.length === 1 ? 'has' : 'have'} not accepted an
                invitation or {pending.length === 1 ? 'is' : 'are'} deactivated,
                and would not be reached.
              </span>
            )}
          </p>
        )}
      </div>

      {mutation.isError && (
        <p role="alert" className="mt-4 max-w-prose text-meta text-signal-700">
          Nothing was saved — the change didn't reach Detecto. {label} is routed
          exactly as it was. Try again.
        </p>
      )}

      {canManage && (
        <div className="mt-5 flex flex-wrap gap-2">
          <Button
            type="button"
            disabled={!dirty || recipients.length === 0 || mutation.isPending}
            onClick={() =>
              mutation.mutate({ kind, target, roleIds: narrowed ? picked : null })
            }
          >
            {mutation.isPending ? 'Saving…' : 'Save'}
          </Button>
          <Button type="button" variant="ghost" onClick={onDone}>
            Cancel
          </Button>
        </div>
      )}
    </div>
  )
}

function Choice({
  name,
  checked,
  disabled,
  onSelect,
  title,
  description,
}: {
  name: string
  checked: boolean
  disabled: boolean
  onSelect: () => void
  title: string
  description: string
}) {
  return (
    <label className={cn('flex gap-3', disabled ? 'cursor-not-allowed' : 'cursor-pointer')}>
      <input
        type="radio"
        name={name}
        checked={checked}
        disabled={disabled}
        onChange={onSelect}
        className={cn(
          'mt-1 size-4 shrink-0 appearance-none rounded-full border border-neutral-400 bg-paper-raised',
          'checked:border-[5px] checked:border-ink',
          'outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
          'disabled:opacity-50',
        )}
      />
      <span className="text-meta">
        <span className="block font-medium text-ink">{title}</span>
        <span className="mt-0.5 block text-neutral-600">{description}</span>
      </span>
    </label>
  )
}

/** Order-insensitive, because a checkbox list has no meaningful order. */
function sameIds(a: string[], b: string[]) {
  return a.length === b.length && [...a].sort().join() === [...b].sort().join()
}
