import { useId, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Panel, PanelBody } from '@/components/ui/panel'
import { StatusWord } from '@/components/ui/status-word'
import type { TenantDetail } from '@/lib/tenants/api'
import { useSetTenantStatus } from '@/lib/tenants/queries'
import { formatTimestamp } from '@/lib/time'

/**
 * Cutting an account off, and letting it back on.
 *
 * The confirm step spells out what suspension actually does, because "suspend"
 * is a word that sounds administrative and is not. It stops a customer's
 * cameras being watched. Somebody clicking this at four in the afternoon should
 * not have to already know that; it should be on the screen in front of them.
 *
 * The list is deliberately specific about what suspension does *not* do as
 * well. Support engineers hesitate over this button because they are not sure
 * whether it deletes anything — it does not, and saying so is what makes the
 * decision quick when it needs to be quick.
 */

const SUSPENSION_DOES = [
  'Their Detecto Boxes stop syncing. The cameras carry on doing whatever they already do locally, but nothing reaches Detecto and nothing is analysed.',
  'No detections are raised, on any camera on the account. Weapon and violence detection stops.',
  'Everyone on the account is signed out, and cannot sign back in.',
]

const SUSPENSION_DOES_NOT = [
  'Nothing is deleted. Their history stays for whatever retention their plan gives, and is there when they come back.',
  'Billing does not change. This is an access decision, not a cancellation — if the account should stop being charged, that is a separate change on the billing side.',
]

export function AccountAccess({ tenant }: { tenant: TenantDetail }) {
  const panelId = useId()
  const [open, setOpen] = useState(false)
  const mutation = useSetTenantStatus(tenant.id)

  const suspended = tenant.status === 'suspended'

  return (
    <Panel
      label="Account access"
      tone={suspended ? 'signal' : 'neutral'}
      className="mb-6"
    >
      <PanelBody>
        {suspended ? (
          <>
            <StatusWord tone="signal" className="text-body">
              Suspended
            </StatusWord>
            <p className="mt-3 max-w-2xl text-meta text-neutral-600">
              Nobody on this account can sign in, their boxes are not syncing,
              and none of their cameras are being watched.
              {tenant.suspendedAt && (
                <>
                  {' '}
                  Suspended{' '}
                  <time dateTime={tenant.suspendedAt} className="font-mono text-data">
                    {formatTimestamp(tenant.suspendedAt)}
                  </time>
                  .
                </>
              )}
            </p>
          </>
        ) : (
          <>
            <StatusWord tone="confirm" className="text-body">
              Access is on
            </StatusWord>
            <p className="mt-3 max-w-2xl text-meta text-neutral-600">
              People on this account can sign in, and their cameras are being
              watched.
            </p>
          </>
        )}

        {mutation.isError && (
          <p role="alert" className="mt-4 max-w-2xl text-meta text-signal-700">
            Nothing changed — the request didn't reach Detecto. The account is
            exactly as it was. Try again.
          </p>
        )}

        <Button
          type="button"
          variant={suspended ? 'default' : 'outline'}
          className="mt-5"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((current) => !current)}
        >
          {suspended ? 'Restore access' : 'Suspend this account'}
        </Button>
      </PanelBody>

      {open &&
        (suspended ? (
          <Reactivate
            id={panelId}
            tenant={tenant}
            mutation={mutation}
            onClose={() => setOpen(false)}
          />
        ) : (
          <Suspend
            id={panelId}
            tenant={tenant}
            mutation={mutation}
            onClose={() => setOpen(false)}
          />
        ))}
    </Panel>
  )
}

type Mutation = ReturnType<typeof useSetTenantStatus>

function Suspend({
  id,
  tenant,
  mutation,
  onClose,
}: {
  id: string
  tenant: TenantDetail
  mutation: Mutation
  onClose: () => void
}) {
  const cameras =
    tenant.cameraCount === 1 ? '1 camera' : `${tenant.cameraCount} cameras`

  return (
    <div id={id} className="border-t border-neutral-200 bg-paper-sunken px-5 py-6 sm:px-6">
      <h3 className="text-title font-medium text-ink">
        Suspend {tenant.name}?
      </h3>
      <p className="mt-2 max-w-prose text-meta text-neutral-600">
        This takes effect immediately, across {cameras} and{' '}
        {tenant.userCount === 1 ? '1 person' : `${tenant.userCount} people`}.
      </p>

      <h4 className="label-micro mt-6 text-neutral-500">What this does</h4>
      <ul className="mt-3 max-w-prose space-y-2.5">
        {SUSPENSION_DOES.map((line) => (
          <li key={line} className="flex gap-3 text-meta text-neutral-700">
            <span aria-hidden="true" className="mt-2 size-1 shrink-0 bg-signal-500" />
            <span>{line}</span>
          </li>
        ))}
      </ul>

      <h4 className="label-micro mt-6 text-neutral-500">What it does not do</h4>
      <ul className="mt-3 max-w-prose space-y-2.5">
        {SUSPENSION_DOES_NOT.map((line) => (
          <li key={line} className="flex gap-3 text-meta text-neutral-600">
            <span aria-hidden="true" className="mt-2 size-1 shrink-0 bg-neutral-400" />
            <span>{line}</span>
          </li>
        ))}
      </ul>

      <p className="mt-6 max-w-prose border-t border-neutral-200 pt-4 text-meta text-neutral-600">
        Detecto does not tell them this happened. If somebody should hear from
        us before their cameras stop being watched, send that first.
      </p>

      <div className="mt-6 flex flex-wrap gap-2">
        <Button
          type="button"
          variant="destructive"
          disabled={mutation.isPending}
          onClick={() => mutation.mutate('suspended', { onSuccess: onClose })}
        >
          {mutation.isPending ? 'Suspending…' : `Suspend ${tenant.name}`}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={onClose}
          disabled={mutation.isPending}
        >
          Leave it running
        </Button>
      </div>
    </div>
  )
}

function Reactivate({
  id,
  tenant,
  mutation,
  onClose,
}: {
  id: string
  tenant: TenantDetail
  mutation: Mutation
  onClose: () => void
}) {
  return (
    <div id={id} className="border-t border-neutral-200 bg-paper-sunken px-5 py-6 sm:px-6">
      <h3 className="text-title font-medium text-ink">
        Restore access for {tenant.name}?
      </h3>

      <ul className="mt-4 max-w-prose space-y-2.5">
        <li className="flex gap-3 text-meta text-neutral-700">
          <span aria-hidden="true" className="mt-2 size-1 shrink-0 bg-confirm-500" />
          <span>
            Their boxes start syncing again at the next check-in, usually within
            a few minutes, and detection resumes on every camera that was running
            before.
          </span>
        </li>
        <li className="flex gap-3 text-meta text-neutral-700">
          <span aria-hidden="true" className="mt-2 size-1 shrink-0 bg-confirm-500" />
          <span>Everyone on the account can sign in again straight away.</span>
        </li>
      </ul>

      {/*
        The one thing a support engineer must not assume. Nothing was watched
        while the account was off, so there is no queue waiting on the other
        side of this button — and a customer who thinks otherwise will ask.
      */}
      <p className="mt-5 max-w-prose text-meta text-signal-700">
        Nothing was recorded by Detecto while the account was suspended. There is
        no backlog to work through and nothing to catch up on — that period is
        simply not covered, and the customer should be told so.
      </p>

      <div className="mt-6 flex flex-wrap gap-2">
        <Button
          type="button"
          disabled={mutation.isPending}
          onClick={() => mutation.mutate('active', { onSuccess: onClose })}
        >
          {mutation.isPending ? 'Restoring…' : 'Restore access'}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={onClose}
          disabled={mutation.isPending}
        >
          Leave it suspended
        </Button>
      </div>
    </div>
  )
}
