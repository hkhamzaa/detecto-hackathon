import { useId, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Panel, PanelBody } from '@/components/ui/panel'
import { StatusWord } from '@/components/ui/status-word'
import { formatPrice, planById, plansFor, type Plan } from '@/lib/plans'
import type { Subscription } from '@/lib/subscription/api'
import {
  useRequestPlanChange,
  useWithdrawPlanChange,
} from '@/lib/subscription/queries'
import { formatDate } from '@/lib/time'
import { cn } from '@/lib/utils'

/**
 * Moving between plans — as a request, because that is all it can be.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS IS NOT A CHECKOUT, AND IT DOES NOT PRETEND TO BE
 *
 * No payment processor is connected to this build. Signup collects card details
 * into a browser store and charges nothing; the product has never taken a
 * payment. So there is no "Upgrade now", no card step, and nothing that reports
 * a plan as changed — pressing the button here records that the organisation
 * asked, and somebody at Detecto follows it up.
 *
 * The alternative was a working-looking upgrade that silently changed a plan id
 * with no money moving, which would be worse than a placeholder: a customer
 * would believe they were on a bigger plan, connect cameras against limits they
 * had not bought, and find out from an invoice that never arrived. It is the
 * same decision the platform billing page made about the retry button it does
 * not have.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * A plain confirm step before submitting, because a request to change what a
 * customer pays deserves a sentence saying what it will and will not do. Not
 * press-and-hold — that stays with the one action in the product where a person
 * puts their name against a detection.
 */
export function ChangePlan({
  subscription,
  cameras,
  canManage,
}: {
  subscription: Subscription
  /** Connected today, so a smaller plan can say whether they would still fit. */
  cameras: number
  canManage: boolean
}) {
  const groupName = useId()
  const request = useRequestPlanChange()
  const withdraw = useWithdrawPlanChange()

  const current = planById(subscription.planId)
  const options = plansFor(subscription.accountType).filter(
    (plan) => plan.id !== subscription.planId,
  )

  const [picked, setPicked] = useState<string>('')
  const [confirming, setConfirming] = useState(false)

  const chosen = options.find((plan) => plan.id === picked)

  if (subscription.pendingChange) {
    return (
      <Pending
        subscription={subscription}
        canManage={canManage}
        pending={withdraw.isPending}
        failed={withdraw.isError}
        onWithdraw={() => withdraw.mutate()}
      />
    )
  }

  if (options.length === 0) {
    return (
      <Panel label="Change plan" className="mb-6">
        <PanelBody>
          <p className="max-w-2xl text-body text-neutral-700">
            There is no other plan for this kind of account. If what you need
            does not fit {current?.name ?? 'your plan'}, talk to us — the plans
            are a starting point, not the limit of what Detecto can do.
          </p>
        </PanelBody>
      </Panel>
    )
  }

  return (
    <Panel label="Change plan" className="mb-6">
      <PanelBody className="border-b border-neutral-200 py-4">
        <p className="max-w-2xl text-meta text-neutral-600">
          Ask to move to another plan. Nothing is charged and nothing changes
          when you send this — Detecto has no payment processing connected yet,
          so a request goes to a person, who will confirm the price and the date
          with you before anything happens to your bill.
        </p>
      </PanelBody>

      {request.isSuccess ? null : confirming && chosen ? (
        <Confirm
          from={current}
          to={chosen}
          cameras={cameras}
          pending={request.isPending}
          failed={request.isError}
          onAgree={() => request.mutate(chosen.id)}
          onBack={() => setConfirming(false)}
        />
      ) : (
        <PanelBody>
          <fieldset disabled={!canManage}>
            <legend className="text-meta font-medium text-ink">
              Move to another plan
            </legend>

            <ul className="mt-4 grid gap-3">
              {options.map((plan) => (
                <li key={plan.id}>
                  <label
                    className={cn(
                      'flex gap-3',
                      canManage ? 'cursor-pointer' : 'cursor-not-allowed',
                    )}
                  >
                    <input
                      type="radio"
                      name={groupName}
                      checked={picked === plan.id}
                      onChange={() => setPicked(plan.id)}
                      className={cn(
                        'mt-1 size-4 shrink-0 accent-ink',
                        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                      )}
                    />
                    <span className="min-w-0 text-meta">
                      <span className="block font-medium text-ink">
                        {plan.name}
                        <span className="font-normal text-neutral-500">
                          {' · '}
                          {formatPrice(plan.monthly)}/month
                        </span>
                        {current && (
                          <span className="ml-2 label-micro text-neutral-500">
                            {plan.monthly > current.monthly ? 'Larger' : 'Smaller'}
                          </span>
                        )}
                      </span>
                      <span className="mt-0.5 block text-neutral-600">
                        {plan.summary}
                      </span>
                      <span className="mt-0.5 block text-neutral-500">
                        Up to {plan.maxCameras} cameras · up to {plan.maxUsers}{' '}
                        {plan.maxUsers === 1 ? 'person' : 'people'}
                      </span>
                      {/* The one thing a customer must not discover after the
                          fact: a smaller plan they no longer fit inside. */}
                      {cameras > plan.maxCameras && (
                        <span className="mt-1 block text-signal-700">
                          You have {cameras} cameras connected. This plan covers{' '}
                          {plan.maxCameras}.
                        </span>
                      )}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>

          {canManage && (
            <Button
              type="button"
              className="mt-6"
              disabled={!chosen}
              onClick={() => setConfirming(true)}
            >
              Review the change
            </Button>
          )}

          {!canManage && (
            <p className="mt-5 max-w-2xl text-meta text-neutral-500">
              You don't have permission to change the plan for this
              organisation. An administrator can.
            </p>
          )}
        </PanelBody>
      )}
    </Panel>
  )
}

/* -------------------------------------------------------------------------- */
/* The confirm step                                                           */
/* -------------------------------------------------------------------------- */

function Confirm({
  from,
  to,
  cameras,
  pending,
  failed,
  onAgree,
  onBack,
}: {
  from: Plan | undefined
  to: Plan
  cameras: number
  pending: boolean
  failed: boolean
  onAgree: () => void
  onBack: () => void
}) {
  const bigger = from ? to.monthly > from.monthly : true
  const difference = from ? Math.abs(to.monthly - from.monthly) : to.monthly
  const wouldNotFit = cameras > to.maxCameras

  return (
    <PanelBody className="bg-paper-sunken">
      <h3 className="text-body font-medium text-ink">
        Ask to move to {to.name}?
      </h3>

      <p className="mt-2 max-w-prose text-body text-neutral-700">
        {from ? (
          <>
            {to.name} is {formatPrice(to.monthly)} a month against{' '}
            {from.name}'s {formatPrice(from.monthly)} —{' '}
            {bigger ? 'an increase' : 'a reduction'} of{' '}
            {formatPrice(difference)} a month, and it covers up to{' '}
            {to.maxCameras} cameras.
          </>
        ) : (
          <>
            {to.name} is {formatPrice(to.monthly)} a month and covers up to{' '}
            {to.maxCameras} cameras.
          </>
        )}
      </p>

      <p className="mt-3 max-w-prose text-meta text-neutral-600">
        <strong className="font-medium text-ink">
          This does not change your plan, and nothing is charged.
        </strong>{' '}
        It records that you asked. Detecto has no payment processing connected
        yet, so somebody will get in touch to confirm the price and the date the
        change would take effect. Your cameras carry on exactly as they are in
        the meantime, and you can take the request back at any point.
      </p>

      {wouldNotFit && (
        <p className="mt-3 max-w-prose text-meta text-signal-700">
          You have {cameras} cameras connected and {to.name} covers{' '}
          {to.maxCameras}. Nothing is switched off by asking, and nobody will
          disconnect a camera on your behalf — but this is worth settling before
          the change is made rather than after.
        </p>
      )}

      {failed && (
        <p role="alert" className="mt-4 max-w-prose text-meta text-signal-700">
          Nothing was sent — the request didn't reach Detecto. Your plan is
          exactly as it was. Try again.
        </p>
      )}

      <div className="mt-5 flex flex-wrap gap-2">
        <Button type="button" onClick={onAgree} disabled={pending}>
          {pending ? 'Sending…' : `Ask to move to ${to.name}`}
        </Button>
        <Button type="button" variant="ghost" onClick={onBack} disabled={pending}>
          Back
        </Button>
      </div>
    </PanelBody>
  )
}

/* -------------------------------------------------------------------------- */
/* An outstanding request                                                     */
/* -------------------------------------------------------------------------- */

/**
 * What a request looks like while nobody has done anything about it.
 *
 * Says plainly that the plan has not changed, because the gap between asking
 * and it happening is exactly where a customer would otherwise assume it had.
 */
function Pending({
  subscription,
  canManage,
  pending,
  failed,
  onWithdraw,
}: {
  subscription: Subscription
  canManage: boolean
  pending: boolean
  failed: boolean
  onWithdraw: () => void
}) {
  const change = subscription.pendingChange
  const wanted = change ? planById(change.planId) : undefined
  const current = planById(subscription.planId)

  return (
    <Panel
      label="Change plan"
      className="mb-6"
      action={
        <StatusWord tone="neutral" className="text-meta">
          Requested
        </StatusWord>
      }
    >
      <PanelBody>
        <p className="max-w-2xl text-body text-neutral-700">
          You asked to move to{' '}
          <span className="font-medium text-ink">
            {wanted?.name ?? change?.planId}
          </span>{' '}
          on{' '}
          <time dateTime={change?.requestedAt}>
            {change ? formatDate(change.requestedAt) : ''}
          </time>
          .
        </p>

        <p className="mt-3 max-w-2xl text-meta text-neutral-600">
          <strong className="font-medium text-ink">
            You are still on {current?.name ?? subscription.planId}, and nothing
            has been charged.
          </strong>{' '}
          The request is with Detecto. Somebody will confirm the price and the
          date with you before your plan or your bill changes — until then this
          account bills exactly as it did before you asked.
        </p>

        {failed && (
          <p role="alert" className="mt-4 max-w-prose text-meta text-signal-700">
            The request couldn't be withdrawn — that didn't reach Detecto. It is
            still outstanding. Try again.
          </p>
        )}

        {canManage && (
          <Button
            type="button"
            variant="outline"
            className="mt-5"
            onClick={onWithdraw}
            disabled={pending}
          >
            {pending ? 'Withdrawing…' : 'Withdraw the request'}
          </Button>
        )}
      </PanelBody>
    </Panel>
  )
}
