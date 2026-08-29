import { useId, useState } from 'react'
import { Link } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { NativeSelect } from '@/components/ui/native-select'
import { Panel, PanelBody } from '@/components/ui/panel'
import type { Person, Role } from '@/lib/roles/api'
import {
  notesFor,
  summarisePermissions,
  summariseScope,
} from '@/lib/roles/permissions'
import { useDeleteRole } from '@/lib/roles/queries'
import { cn } from '@/lib/utils'

function holdersOf(role: Role, people: Person[]) {
  return people.filter((person) => person.roleId === role.id).length
}

export function RoleList({
  roles,
  people,
  canManage,
}: {
  roles: Role[]
  people: Person[]
  canManage: boolean
}) {
  return (
    <Panel
      label="Roles"
      action={
        canManage && (
          <Button asChild size="sm" variant="outline">
            <Link to="/org/users/roles/new">Create role</Link>
          </Button>
        )
      }
    >
      {roles.length === 0 ? (
        <PanelBody>
          <p className="max-w-2xl text-body text-neutral-700">
            No roles yet. A role is a set of things somebody can do — you build
            it from a list rather than picking a tier, because what your team
            looks like is not something Detecto can guess.
          </p>
          {canManage && (
            <Button asChild className="mt-5">
              <Link to="/org/users/roles/new">Create the first role</Link>
            </Button>
          )}
        </PanelBody>
      ) : (
        <ul className="divide-y divide-neutral-200">
          {roles.map((role) => (
            <RoleRow
              key={role.id}
              role={role}
              holders={holdersOf(role, people)}
              otherRoles={roles.filter((other) => other.id !== role.id)}
              canManage={canManage}
            />
          ))}
        </ul>
      )}
    </Panel>
  )
}

/* -------------------------------------------------------------------------- */

function RoleRow({
  role,
  holders,
  otherRoles,
  canManage,
}: {
  role: Role
  holders: number
  otherRoles: Role[]
  canManage: boolean
}) {
  const [deleting, setDeleting] = useState(false)
  const deleteId = useId()
  const notes = notesFor(role.permissions)

  return (
    <li>
      <div className="flex flex-wrap items-start justify-between gap-4 px-5 py-5 sm:px-6">
        <div className="min-w-0">
          <h3 className="text-body font-medium text-ink">{role.name}</h3>

          <p className="mt-1 max-w-prose text-meta text-neutral-600">
            {summarisePermissions(role.permissions)}
          </p>

          <p className="mt-1.5 text-meta text-neutral-500">
            {summariseScope(role.zones)} ·{' '}
            {holders === 0
              ? 'nobody holds it'
              : holders === 1
                ? '1 person holds it'
                : `${holders} people hold it`}
          </p>

          {/* The two grants that hand over more than a screen say so here,
              rather than hiding inside a checklist somebody has to reopen. */}
          {notes.map((note) => (
            <p
              key={note}
              className="mt-2 flex max-w-prose gap-2.5 text-meta text-neutral-600"
            >
              <span aria-hidden="true" className="mt-1.5 size-1 shrink-0 bg-neutral-400" />
              <span>{note}</span>
            </p>
          ))}
        </div>

        {canManage && (
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button asChild size="sm" variant="outline">
              <Link to={`/org/users/roles/${role.id}`}>Edit</Link>
            </Button>
            {!role.isDefault && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                aria-expanded={deleting}
                aria-controls={deleteId}
                onClick={() => setDeleting((open) => !open)}
              >
                Delete
              </Button>
            )}
          </div>
        )}
      </div>

      {role.isDefault && canManage && (
        <p className="px-5 pb-5 text-meta text-neutral-500 sm:px-6">
          This is the role your account holds. It cannot be deleted — an
          organisation that removes the role granting people management has no
          way back into its own account.
        </p>
      )}

      {deleting && (
        <DeleteRole
          id={deleteId}
          role={role}
          holders={holders}
          otherRoles={otherRoles}
          onClose={() => setDeleting(false)}
        />
      )}
    </li>
  )
}

/* -------------------------------------------------------------------------- */

/**
 * Deleting a role somebody holds is two decisions, not one: remove the role,
 * and settle what happens to the people who had it. A silent cascade would
 * answer the second question on their behalf, so it is asked out loud.
 */
function DeleteRole({
  id,
  role,
  holders,
  otherRoles,
  onClose,
}: {
  id: string
  role: Role
  holders: number
  otherRoles: Role[]
  onClose: () => void
}) {
  const mutation = useDeleteRole()
  const [moveTo, setMoveTo] = useState<string>(otherRoles[0]?.id ?? '')
  const [choice, setChoice] = useState<'reassign' | 'unassign'>(
    otherRoles.length > 0 ? 'reassign' : 'unassign',
  )

  const people = holders === 1 ? '1 person' : `${holders} people`
  const target = otherRoles.find((other) => other.id === moveTo)

  const submit = () => {
    mutation.mutate(
      {
        id: role.id,
        disposition:
          choice === 'reassign' && moveTo
            ? { kind: 'reassign', roleId: moveTo }
            : { kind: 'unassign' },
      },
      { onSuccess: onClose },
    )
  }

  return (
    <div id={id} className="border-t border-neutral-200 bg-paper-sunken px-5 py-5 sm:px-6">
      {holders === 0 ? (
        <p className="max-w-prose text-body text-ink">
          Deleting {role.name} changes nothing for anyone — nobody holds it.
        </p>
      ) : (
        <>
          <h4 className="text-body font-medium text-ink">
            {people} {holders === 1 ? 'holds' : 'hold'} {role.name}. What happens
            to {holders === 1 ? 'them' : 'them'}?
          </h4>
          <p className="mt-2 max-w-prose text-meta text-neutral-600">
            Deleting the role takes this access away from{' '}
            {holders === 1 ? 'them' : 'all of them'} the moment it is done.
          </p>

          <fieldset className="mt-5" disabled={mutation.isPending}>
            <legend className="sr-only">What happens to them</legend>
            <div className="grid gap-3">
              {otherRoles.length > 0 && (
                <label className="flex cursor-pointer items-start gap-3">
                  <input
                    type="radio"
                    name={`${id}-choice`}
                    checked={choice === 'reassign'}
                    onChange={() => setChoice('reassign')}
                    className="mt-1 size-4 accent-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  />
                  <span>
                    <span className="block text-meta font-medium text-ink">
                      Move them to another role
                    </span>
                    <span className="block text-meta text-neutral-600">
                      {target
                        ? `They get everything ${target.name} allows, and nothing else.`
                        : 'Pick the role they should hold instead.'}
                    </span>
                  </span>
                </label>
              )}

              {choice === 'reassign' && otherRoles.length > 0 && (
                <NativeSelect
                  aria-label="Role to move them to"
                  value={moveTo}
                  onChange={(event) => setMoveTo(event.target.value)}
                  className="sm:max-w-xs sm:ml-7"
                >
                  {otherRoles.map((other) => (
                    <option key={other.id} value={other.id}>
                      {other.name}
                    </option>
                  ))}
                </NativeSelect>
              )}

              <label className="flex cursor-pointer items-start gap-3">
                <input
                  type="radio"
                  name={`${id}-choice`}
                  checked={choice === 'unassign'}
                  onChange={() => setChoice('unassign')}
                  className="mt-1 size-4 accent-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                />
                <span>
                  <span className="block text-meta font-medium text-ink">
                    Leave them without a role
                  </span>
                  <span className="block max-w-prose text-meta text-neutral-600">
                    They keep their account and everything they have ever
                    confirmed. They will not be able to see anything until
                    somebody gives them a role.
                  </span>
                </span>
              </label>
            </div>
          </fieldset>
        </>
      )}

      {mutation.isError && (
        <p role="alert" className="mt-4 max-w-prose text-meta text-signal-700">
          {mutation.error instanceof Error &&
          mutation.error.message === 'protected_role'
            ? 'This role cannot be deleted — it is the one that keeps your organisation reachable.'
            : "Nothing was deleted — the request didn't reach Detecto. The role and everyone holding it are exactly as they were."}
        </p>
      )}

      <div className={cn('flex flex-wrap gap-2', holders === 0 ? 'mt-5' : 'mt-6')}>
        <Button
          type="button"
          variant="destructive"
          onClick={submit}
          disabled={mutation.isPending}
        >
          {mutation.isPending
            ? 'Deleting…'
            : holders === 0
              ? `Delete ${role.name}`
              : choice === 'reassign' && target
                ? `Delete and move ${people} to ${target.name}`
                : `Delete and leave ${people} without a role`}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={onClose}
          disabled={mutation.isPending}
        >
          Keep it
        </Button>
      </div>
    </div>
  )
}
