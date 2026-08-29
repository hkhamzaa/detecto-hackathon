import { useId, useState, type FormEvent } from 'react'

import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { NativeSelect } from '@/components/ui/native-select'
import { Panel, PanelBody } from '@/components/ui/panel'
import { StatusWord } from '@/components/ui/status-word'
import { isEmail } from '@/lib/forms'
import type { Person, Role } from '@/lib/roles/api'
import {
  useInvitePerson,
  useSetPersonRole,
  useSetPersonStatus,
} from '@/lib/roles/queries'
import { formatRelative } from '@/lib/time'
import { useAuthStore } from '@/store/auth-store'

/** An invite nobody has answered in this long has stopped being in progress. */
const STALE_INVITE_DAYS = 7
const DAY = 86_400_000

function daysSince(iso: string | null) {
  if (!iso) return 0
  const then = Date.parse(iso)
  return Number.isNaN(then) ? 0 : Math.floor((Date.now() - then) / DAY)
}

export function PeopleList({
  people,
  roles,
  canManage,
}: {
  people: Person[]
  roles: Role[]
  canManage: boolean
}) {
  const [inviting, setInviting] = useState(false)
  const inviteId = useId()

  const active = people.filter((person) => person.status === 'active').length

  return (
    <Panel
      label="People"
      action={
        <div className="flex items-center gap-3">
          <span className="label-micro text-neutral-500">
            {active} of {people.length} active
          </span>
          {canManage && roles.length > 0 && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              aria-expanded={inviting}
              aria-controls={inviteId}
              onClick={() => setInviting((open) => !open)}
            >
              Invite person
            </Button>
          )}
        </div>
      }
    >
      {canManage && inviting && (
        <InviteForm id={inviteId} roles={roles} onClose={() => setInviting(false)} />
      )}

      {people.length === 0 ? (
        <PanelBody>
          <p className="max-w-2xl text-meta text-neutral-600">
            Nobody here yet.
          </p>
        </PanelBody>
      ) : (
        <ul className="divide-y divide-neutral-200">
          {people.map((person) => (
            <PersonRow
              key={person.id}
              person={person}
              roles={roles}
              canManage={canManage}
            />
          ))}
        </ul>
      )}
    </Panel>
  )
}

/* -------------------------------------------------------------------------- */

function PersonRow({
  person,
  roles,
  canManage,
}: {
  person: Person
  roles: Role[]
  canManage: boolean
}) {
  const claims = useAuthStore((s) => s.claims)
  const isYou = claims?.email === person.email

  const [confirming, setConfirming] = useState(false)
  const confirmId = useId()

  const roleMutation = useSetPersonRole()
  const statusMutation = useSetPersonStatus()

  const deactivated = person.status === 'deactivated'

  return (
    <li>
      <div className="flex flex-wrap items-start justify-between gap-4 px-5 py-5 sm:px-6">
        <div className="min-w-0">
          <p className="text-body font-medium text-ink">
            {person.name}
            {isYou && <span className="text-neutral-500"> · you</span>}
          </p>
          <p className="mt-0.5 break-all font-mono text-data text-neutral-600">
            {person.email}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
            <PersonStatus person={person} />
            {person.status === 'invited' && person.invitedAt && (
              <span className="text-meta text-neutral-500">
                Sent {formatRelative(person.invitedAt).toLowerCase()}
              </span>
            )}
          </div>

          {roleMutation.isError && (
            <p role="alert" className="mt-2 text-meta text-signal-700">
              Their role didn't change — the request didn't reach Detecto. They
              still hold the one shown.
            </p>
          )}
        </div>

        {canManage && (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <NativeSelect
              aria-label={`Role for ${person.name}`}
              value={person.roleId ?? ''}
              disabled={roleMutation.isPending}
              onChange={(event) =>
                roleMutation.mutate({
                  id: person.id,
                  roleId: event.target.value || null,
                })
              }
              className="sm:w-48"
            >
              <option value="">No role</option>
              {roles.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.name}
                </option>
              ))}
            </NativeSelect>

            {deactivated ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={statusMutation.isPending}
                onClick={() =>
                  statusMutation.mutate({ id: person.id, status: 'active' })
                }
              >
                {statusMutation.isPending ? 'Restoring…' : 'Restore access'}
              </Button>
            ) : (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                aria-expanded={confirming}
                aria-controls={confirmId}
                onClick={() => setConfirming((open) => !open)}
              >
                Deactivate
              </Button>
            )}
          </div>
        )}
      </div>

      {confirming && (
        <Deactivate
          id={confirmId}
          person={person}
          isYou={isYou}
          onClose={() => setConfirming(false)}
        />
      )}
    </li>
  )
}

/**
 * Colour only where somebody needs to act. Active, invited and deactivated are
 * all just facts; an invite nobody answered for a week and a half is the one
 * that wants attention.
 */
function PersonStatus({ person }: { person: Person }) {
  if (person.status === 'active') {
    return (
      <StatusWord tone="confirm" className="text-meta">
        Active
      </StatusWord>
    )
  }

  if (person.status === 'deactivated') {
    return (
      <StatusWord tone="neutral" className="text-meta">
        Deactivated
      </StatusWord>
    )
  }

  const stale = daysSince(person.invitedAt) >= STALE_INVITE_DAYS
  return (
    <StatusWord tone={stale ? 'signal' : 'neutral'} className="text-meta">
      {stale ? 'Invite unanswered' : 'Invited'}
    </StatusWord>
  )
}

/* -------------------------------------------------------------------------- */

/**
 * Says exactly what deactivating does, and — because it is the thing people
 * assume — exactly what it does not. Nothing is erased. Their confirmations are
 * part of the organisation's record of who decided what, and that record is not
 * an administrator's to rewrite.
 */
function Deactivate({
  id,
  person,
  isYou,
  onClose,
}: {
  id: string
  person: Person
  isYou: boolean
  onClose: () => void
}) {
  const mutation = useSetPersonStatus()

  return (
    <div id={id} className="border-t border-neutral-200 bg-paper-sunken px-5 py-5 sm:px-6">
      <h4 className="text-body font-medium text-ink">
        {person.name} loses access straight away.
      </h4>
      <p className="mt-2 max-w-prose text-meta text-neutral-600">
        Their account stays, and so does everything they have ever confirmed or
        dismissed — deactivating removes access, it does not erase anything. You
        can restore it later and they pick up where they left off.
        {person.status === 'invited' && ' Their invite stops working.'}
      </p>

      {isYou && (
        <p className="mt-3 max-w-prose text-meta text-signal-700">
          This is your own account. Deactivating it signs you out of Detecto and
          somebody else will have to let you back in.
        </p>
      )}

      {mutation.isError && (
        <p role="alert" className="mt-3 max-w-prose text-meta text-signal-700">
          Nothing changed — the request didn't reach Detecto. {person.name} still
          has access.
        </p>
      )}

      <div className="mt-5 flex flex-wrap gap-2">
        <Button
          type="button"
          variant="destructive"
          disabled={mutation.isPending}
          onClick={() =>
            mutation.mutate(
              { id: person.id, status: 'deactivated' },
              { onSuccess: onClose },
            )
          }
        >
          {mutation.isPending ? 'Removing access…' : `Deactivate ${person.name}`}
        </Button>
        <Button type="button" variant="ghost" onClick={onClose} disabled={mutation.isPending}>
          Leave them as they are
        </Button>
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */

function InviteForm({
  id,
  roles,
  onClose,
}: {
  id: string
  roles: Role[]
  onClose: () => void
}) {
  const mutation = useInvitePerson()
  const [email, setEmail] = useState('')
  const [roleId, setRoleId] = useState(roles[0]?.id ?? '')
  const [error, setError] = useState<string>()

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    if (mutation.isPending) return

    const value = email.trim()
    if (!value) {
      setError('Enter the email address to invite.')
      return
    }
    if (!isEmail(value)) {
      setError('This needs an @ and a domain, like name@company.com.')
      return
    }

    setError(undefined)
    mutation.mutate({ email: value, roleId }, { onSuccess: () => setEmail('') })
  }

  const role = roles.find((item) => item.id === roleId)

  if (mutation.isSuccess) {
    return (
      <div id={id} className="border-b border-neutral-200 bg-paper-sunken px-5 py-5 sm:px-6">
        <p role="status" className="max-w-prose text-body text-ink">
          Invite sent to{' '}
          <span className="font-mono text-data">{mutation.data.email}</span>.
        </p>
        <p className="mt-2 max-w-prose text-meta text-neutral-600">
          They show as invited until they accept it. Nothing is visible to them
          before that, and the invite stops working if you deactivate them.
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => mutation.reset()}>
            Invite someone else
          </Button>
          <Button type="button" variant="ghost" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    )
  }

  return (
    <form
      id={id}
      onSubmit={onSubmit}
      noValidate
      aria-busy={mutation.isPending}
      className="border-b border-neutral-200 bg-paper-sunken px-5 py-5 sm:px-6"
    >
      <h3 className="text-body font-medium text-ink">Invite someone</h3>
      <p className="mt-2 max-w-prose text-meta text-neutral-600">
        They get an email with a link. What they can see is decided by the role
        you pick here, and you can change it afterwards.
      </p>

      <div className="mt-5 grid gap-5 sm:max-w-xl sm:grid-cols-2">
        <Field label="Email" error={error}>
          {(props) => (
            <Input
              {...props}
              type="email"
              inputMode="email"
              value={email}
              onChange={(event) => {
                setEmail(event.target.value)
                setError(undefined)
              }}
              placeholder="name@company.com"
              autoComplete="off"
            />
          )}
        </Field>

        <Field label="Role" hint={role ? summaryHint(role) : undefined}>
          {(props) => (
            <NativeSelect
              {...props}
              value={roleId}
              onChange={(event) => setRoleId(event.target.value)}
            >
              {roles.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </NativeSelect>
          )}
        </Field>
      </div>

      {mutation.isError && (
        <p role="alert" className="mt-4 max-w-prose text-meta text-signal-700">
          {mutation.error instanceof Error && mutation.error.message === 'already_here'
            ? `${email.trim()} is already in your organisation. Change their role from the list instead.`
            : "The invite wasn't sent — the request didn't reach Detecto. Nobody has been added. Try again."}
        </p>
      )}

      <div className="mt-5 flex flex-wrap gap-2">
        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? 'Sending…' : 'Send invite'}
        </Button>
        <Button type="button" variant="ghost" onClick={onClose} disabled={mutation.isPending}>
          Cancel
        </Button>
      </div>
    </form>
  )
}

/** Kept short — the full sentence lives in the roles list above. */
function summaryHint(role: Role) {
  return role.zones === null
    ? 'Reaches every camera.'
    : `Limited to ${role.zones.join(', ') || 'no zones'}.`
}
