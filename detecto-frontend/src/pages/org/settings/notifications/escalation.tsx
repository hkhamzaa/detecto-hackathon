import { useId, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Panel, PanelBody } from '@/components/ui/panel'
import { StatusWord } from '@/components/ui/status-word'
import { Switch } from '@/components/ui/switch'
import type { Alert } from '@/lib/alerts/api'
import {
  ESCALATION_DELAYS,
  type EscalationDelay,
  type EscalationPolicy,
} from '@/lib/notifications/api'
import { useSetEscalation } from '@/lib/notifications/queries'
import {
  countPeople,
  hearsAlerts,
  peopleIn,
  summariseNames,
  summariseRoles,
} from '@/lib/notifications/routing'
import type { Person, Role } from '@/lib/roles/api'
import { cn } from '@/lib/utils'

/**
 * What happens when an alert sits and nobody looks at it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ESCALATION HERE MEANS TELLING ANOTHER PERSON. IT MEANS NOTHING ELSE.
 *
 * This is the one page in the product where automation could plausibly be read
 * as creeping toward contacting an emergency service, so the wording is exact
 * and it is repeated at the point of decision rather than stated once at the
 * top. Detecto notifies a second colleague. It does not call the police, a
 * guard company, a monitoring centre or anybody outside the organisation, and
 * there is no field in `lib/notifications/api.ts` that could hold one.
 *
 * That is the same promise the confirmed-alert screen makes — "Detecto has not
 * contacted anyone" — and it holds harder here, because this setting runs
 * without a person present. An unreviewed alert reaching a second colleague is
 * a rota problem being solved. An unreviewed alert reaching an authority would
 * be a machine deciding a threat is real, which is precisely what the whole
 * confirmation interaction exists to prevent.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Saving goes through a plain confirm step: a sentence saying what the setting
 * will do, and a button agreeing to it. Not press-and-hold — that control is
 * reserved for the one action in the product where a person puts their name
 * against a detection, and spending it on a settings save would cheapen it.
 */
export function EscalationSection({
  policy,
  roles,
  people,
  alerts,
  now,
  canManage,
}: {
  policy: EscalationPolicy
  roles: Role[]
  people: Person[]
  /** The live queue, for showing what the threshold would have caught. Null when unreachable. */
  alerts: Alert[] | null
  /**
   * When the queue was read, not when this rendered — the same clock the system
   * health page uses, and for the same reason: a figure that moves under the
   * page every re-render is one nobody can check against the queue itself.
   */
  now: number
  canManage: boolean
}) {
  const switchId = useId()
  const groupName = useId()
  const mutation = useSetEscalation()

  const [enabled, setEnabled] = useState(policy.enabled)
  const [after, setAfter] = useState<EscalationDelay>(policy.afterMinutes)
  const [picked, setPicked] = useState<string[]>(policy.roleIds)
  const [confirming, setConfirming] = useState(false)

  const eligible = roles.filter(hearsAlerts)
  const chosen = roles.filter((role) => picked.includes(role.id))
  const recipients = peopleIn(chosen, people)

  const saved = roles.filter((role) => policy.roleIds.includes(role.id))
  const savedRecipients = peopleIn(saved, people)

  const dirty =
    enabled !== policy.enabled ||
    after !== policy.afterMinutes ||
    picked.join() !== policy.roleIds.join()

  // Turning it off needs no recipients; turning it on is meaningless without.
  const valid = !enabled || recipients.length > 0

  return (
    <Panel
      label="If nobody reviews an alert"
      tone={policy.enabled ? 'confirm' : 'neutral'}
      className="mb-6"
      action={
        <span className="label-micro text-neutral-500">
          {policy.enabled
            ? `After ${policy.afterMinutes} min`
            : 'Off'}
        </span>
      }
    >
      <PanelBody className="border-b border-neutral-200 py-4">
        <p className="max-w-2xl text-meta text-neutral-600">
          An alert waits in the queue until a person confirms it or marks it a
          false positive. If nobody does, Detecto can tell somebody else — one
          more person on your team, in addition to whoever was already notified.
        </p>
        <p className="mt-3 max-w-2xl text-meta text-neutral-600">
          <strong className="font-medium text-ink">
            This only ever notifies people in your organisation.
          </strong>{' '}
          It does not contact the police, a guard company, or any emergency
          service, and Detecto has no way to. Reaching an authority is something
          a person does, after they have confirmed the detection themselves —
          the same rule the alert screen states, and it does not change because
          time has passed.
        </p>
      </PanelBody>

      {confirming ? (
        <Confirm
          enabled={enabled}
          after={after}
          roles={chosen}
          recipients={recipients}
          alreadyNotified={chosen.length > 0 && chosen.every(hearsAlerts)}
          pending={mutation.isPending}
          failed={mutation.isError}
          onAgree={() =>
            mutation.mutate(
              { enabled, afterMinutes: after, roleIds: picked },
              { onSuccess: () => setConfirming(false) },
            )
          }
          onBack={() => setConfirming(false)}
        />
      ) : (
        <PanelBody>
          {mutation.isSuccess && !dirty && (
            <p role="status" className="mb-5 max-w-prose text-body text-ink">
              {policy.enabled
                ? `Saved. An alert left unreviewed for ${policy.afterMinutes} minutes also notifies ${summariseRoles(saved)} — ${countPeople(savedRecipients)}.`
                : 'Saved. Nothing escalates: an unreviewed alert waits in the queue until somebody opens it.'}
            </p>
          )}

          <div className="flex items-start gap-3">
            <Switch
              id={switchId}
              checked={enabled}
              disabled={!canManage}
              onChange={(event) => setEnabled(event.target.checked)}
            />
            <label htmlFor={switchId} className="cursor-pointer text-meta">
              <span className="block font-medium text-ink">
                Notify somebody else if an alert is not reviewed
              </span>
              <span className="mt-0.5 block text-neutral-600">
                Off by default. Nothing escalates until you turn this on.
              </span>
            </label>
          </div>

          {enabled && (
            <>
              <fieldset className="mt-7">
                <legend className="text-meta font-medium text-ink">
                  How long to wait
                </legend>
                <p className="mt-1 max-w-prose text-meta text-neutral-600">
                  Counted from the moment the detection was raised.
                </p>

                <div className="mt-3 flex flex-wrap gap-2">
                  {ESCALATION_DELAYS.map((minutes) => (
                    <label key={minutes} className="cursor-pointer">
                      <input
                        type="radio"
                        name={`${groupName}-delay`}
                        checked={after === minutes}
                        disabled={!canManage}
                        onChange={() => setAfter(minutes)}
                        className="peer sr-only"
                      />
                      <span
                        className={cn(
                          'block rounded-md border border-neutral-300 bg-paper-raised px-4 py-2 text-meta text-neutral-700',
                          'transition-colors duration-150 hover:border-neutral-400',
                          'peer-checked:border-ink peer-checked:bg-ink peer-checked:text-paper',
                          'peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring',
                        )}
                      >
                        {minutes} minutes
                      </span>
                    </label>
                  ))}
                </div>

                <Waiting alerts={alerts} after={after} now={now} />
              </fieldset>

              <fieldset className="mt-7">
                <legend className="text-meta font-medium text-ink">
                  Who to tell
                </legend>

                {eligible.length === 0 ? (
                  <p className="mt-2 max-w-prose text-meta text-signal-700">
                    No role in your organisation can see alerts, so there is
                    nobody to escalate to. Give a role the alert permissions on
                    the People page first.
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

                {enabled && recipients.length === 0 && eligible.length > 0 && (
                  <p className="mt-4 max-w-prose text-meta text-signal-700">
                    Nobody is selected, so nothing would happen when an alert
                    goes unreviewed. Pick at least one role with somebody active
                    on it, or turn escalation off.
                  </p>
                )}
              </fieldset>
            </>
          )}

          {canManage && (
            <div className="mt-7 flex flex-wrap gap-2">
              <Button
                type="button"
                disabled={!dirty || !valid}
                onClick={() => setConfirming(true)}
              >
                Review the change
              </Button>
              {dirty && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setEnabled(policy.enabled)
                    setAfter(policy.afterMinutes)
                    setPicked(policy.roleIds)
                  }}
                >
                  Discard
                </Button>
              )}
            </div>
          )}
        </PanelBody>
      )}
    </Panel>
  )
}

/* -------------------------------------------------------------------------- */
/* What the threshold would catch                                             */
/* -------------------------------------------------------------------------- */

/**
 * The setting, against the real queue.
 *
 * Five, fifteen and thirty minutes are abstractions until somebody sees what
 * they would have done. This counts the alerts waiting right now that are
 * already older than the threshold — the ones that would have escalated — so
 * the choice is made against the organisation's own traffic rather than a
 * guess about it.
 */
function Waiting({
  alerts,
  after,
  now,
}: {
  alerts: Alert[] | null
  after: EscalationDelay
  now: number
}) {
  if (!alerts) return null

  const waiting = alerts.filter((alert) => alert.status === 'unconfirmed')
  const over = waiting.filter(
    (alert) => now - Date.parse(alert.detectedAt) > after * 60_000,
  )

  if (waiting.length === 0) {
    return (
      <p className="mt-4 max-w-prose text-meta text-neutral-500">
        Nothing is waiting in your queue right now.
      </p>
    )
  }

  return (
    <p className="mt-4 max-w-prose text-meta text-neutral-600">
      <StatusWord tone={over.length > 0 ? 'signal' : 'confirm'} className="text-meta">
        {over.length === 0
          ? `Nothing in your queue has been waiting that long`
          : `${over.length} of ${waiting.length} waiting now would have escalated`}
      </StatusWord>
    </p>
  )
}

/* -------------------------------------------------------------------------- */
/* The confirm step                                                           */
/* -------------------------------------------------------------------------- */

/**
 * A sentence saying exactly what this does, and a button agreeing to it.
 *
 * The light confirm, as used for a zone-wide module change — not press-and-hold.
 * This changes who gets woken up, which deserves a moment's pause; it is not a
 * person taking responsibility for a detection, which is the only thing heavy
 * enough for the hold.
 */
function Confirm({
  enabled,
  after,
  roles,
  recipients,
  alreadyNotified,
  pending,
  failed,
  onAgree,
  onBack,
}: {
  enabled: boolean
  after: EscalationDelay
  roles: Role[]
  recipients: Person[]
  /** True when everybody being escalated to already hears about alerts anyway. */
  alreadyNotified: boolean
  pending: boolean
  failed: boolean
  onAgree: () => void
  onBack: () => void
}) {
  return (
    <PanelBody className="bg-paper-sunken">
      <h3 className="text-body font-medium text-ink">
        {enabled ? 'Turn escalation on?' : 'Turn escalation off?'}
      </h3>

      {enabled ? (
        <>
          <p className="mt-2 max-w-prose text-body text-neutral-700">
            If an alert is still unreviewed after {after} minutes, this also
            notifies {summariseRoles(roles)} — {countPeople(recipients)}:{' '}
            {summariseNames(recipients, 6)}.
          </p>
          <p className="mt-3 max-w-prose text-meta text-neutral-600">
            Everyone already notified when the alert was raised stays notified.
            Escalation adds people; it does not hand the alert over and stop
            telling the people who were watching for it.
          </p>
          <p className="mt-3 max-w-prose text-meta text-neutral-600">
            <strong className="font-medium text-ink">
              Nobody outside your organisation is contacted.
            </strong>{' '}
            This sends a notification to colleagues. It does not reach the
            police, a guard company or any emergency service — that is a call a
            person makes, after confirming the detection themselves.
          </p>

          {alreadyNotified && (
            <p className="mt-3 max-w-prose text-meta text-neutral-500">
              Everyone on{' '}
              {roles.length === 1 ? 'this role' : 'these roles'} can already see
              alerts, so most of them will have been told when the detection was
              raised. Escalating to a role that is already watching tells the
              same people twice — useful as a nudge, but it will not reach
              anybody new.
            </p>
          )}
        </>
      ) : (
        <p className="mt-2 max-w-prose text-body text-neutral-700">
          Nothing will escalate. An unreviewed alert will wait in the queue until
          somebody opens it, however long that takes, and nobody else will be
          told.
        </p>
      )}

      {failed && (
        <p role="alert" className="mt-4 max-w-prose text-meta text-signal-700">
          Nothing was saved — the change didn't reach Detecto. Escalation is
          exactly as it was. Try again.
        </p>
      )}

      <div className="mt-5 flex flex-wrap gap-2">
        <Button type="button" onClick={onAgree} disabled={pending}>
          {pending
            ? 'Saving…'
            : enabled
              ? `Escalate after ${after} minutes`
              : 'Turn escalation off'}
        </Button>
        <Button type="button" variant="ghost" onClick={onBack} disabled={pending}>
          Back
        </Button>
      </div>
    </PanelBody>
  )
}
