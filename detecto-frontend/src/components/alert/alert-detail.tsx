import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'

import { AlertStatus } from '@/components/alert/alert-status'
import { EvidenceFrame } from '@/components/alert/evidence-frame'
import { HoldToConfirm } from '@/components/alert/hold-to-confirm'
import { PageHeader } from '@/components/app-shell/page-header'
import { Button } from '@/components/ui/button'
import { Panel, PanelBody } from '@/components/ui/panel'
import type { Alert } from '@/lib/alerts/api'
import {
  confidenceLabel,
  detectionHeadline,
  detectionLabel,
} from '@/lib/alerts/labels'
import { useAlert, useDecision } from '@/lib/alerts/queries'
import { can } from '@/lib/auth/claims'
import { formatShort, formatTimestamp } from '@/lib/time'
import { useAuthStore } from '@/store/auth-store'

const NO_PERMISSION =
  "You don't have permission to confirm or dismiss alerts. An administrator in your organisation can change that."

const CARD_HEADER = {
  unconfirmed: { dot: 'bg-signal-500', text: 'text-signal-300', label: 'Unconfirmed detection' },
  confirmed: { dot: 'bg-confirm-500', text: 'text-confirm-300', label: 'Confirmed by a person' },
  dismissed: { dot: 'bg-neutral-500', text: 'text-neutral-400', label: 'Marked as a false positive' },
}

/**
 * One alert, and the decision it is waiting for.
 *
 * The card is Ink inside a Paper page on purpose: the style guide designs this
 * surface as control-room chrome, and the change of ground is what separates
 * the one moment on this page that carries responsibility from the list that
 * led here.
 */
export function AlertDetail({
  eyebrow,
  basePath,
}: {
  eyebrow: string
  basePath: string
}) {
  const { id = '' } = useParams()
  const { data: alert, isPending, isError, error } = useAlert(id)

  const notFound = isError && error instanceof Error && error.message === 'not_found'

  return (
    <>
      <p className="mb-6">
        <Link
          to={basePath}
          className="inline-flex items-center gap-2 text-meta text-neutral-600 underline decoration-neutral-300 underline-offset-4 transition-colors hover:text-ink hover:decoration-current focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <ArrowLeft aria-hidden="true" className="size-3.5" />
          Back to the queue
        </Link>
      </p>

      <PageHeader
        eyebrow={eyebrow}
        title={alert ? detectionHeadline(alert) : 'Alert'}
      />

      {isPending ? (
        <Panel label="Alert">
          <PanelBody>
            <p role="status" aria-live="polite" className="text-meta text-neutral-500">
              Loading this alert…
            </p>
          </PanelBody>
        </Panel>
      ) : isError ? (
        <Panel label={notFound ? 'No such alert' : "Can't load this alert"} tone="signal">
          <PanelBody>
            <p className="max-w-2xl text-meta text-neutral-600">
              {notFound
                ? `Nothing in your queue has the reference ${id}. It may belong to another organisation, or the link may have been mistyped.`
                : "Detecto couldn't reach the service that holds this alert. Nothing has been confirmed or dismissed while it has been down."}
            </p>
            <Button asChild variant="outline" className="mt-5">
              <Link to={basePath}>Back to the queue</Link>
            </Button>
          </PanelBody>
        </Panel>
      ) : (
        <ConfirmationCard alert={alert} />
      )}
    </>
  )
}

/* -------------------------------------------------------------------------- */

function ConfirmationCard({ alert }: { alert: Alert }) {
  const claims = useAuthStore((s) => s.claims)
  const canDecide = can(claims, 'alerts:confirm')

  const decision = useDecision(alert.id)
  // The style guide's own reset: a decision that never reached the server has
  // to put the control back, or the screen keeps claiming something happened.
  const [resetKey, setResetKey] = useState(0)

  const waiting = alert.status === 'unconfirmed'
  const header = CARD_HEADER[alert.status]

  const decide = (choice: 'confirm' | 'dismiss') => {
    decision.mutate(choice, { onError: () => setResetKey((key) => key + 1) })
  }

  return (
    <>
      <div className="dark overflow-hidden rounded-md border border-ink-hairline bg-ink">
        <div className="flex items-center justify-between gap-4 border-b border-ink-hairline px-5 py-3">
          <div className="flex items-center gap-2.5">
            <span aria-hidden="true" className={`size-2 rounded-full ${header.dot}`} />
            <span className={`label-micro ${header.text}`}>{header.label}</span>
          </div>
          <span className="font-mono text-data text-neutral-500">{alert.id}</span>
        </div>

        <div className="grid gap-6 p-5 sm:grid-cols-[minmax(0,1fr)_16rem] sm:p-6">
          <div className="order-2 sm:order-1">
            <h2 className="font-display text-display-md font-medium text-paper">
              {detectionHeadline(alert)}
            </h2>
            {/* The camera's name is set as the customer wrote it, never
                case-folded into a sentence — "CAM-04" is not "cam-04". */}
            <p className="mt-2 max-w-md text-meta text-neutral-400">
              {detectionLabel(alert)} — matched on {alert.cameraName}
              {alert.zone ? `, ${alert.zone}` : ''}.{' '}
              {waiting
                ? 'No notification has left this system.'
                : "Nothing left this system on the model's word."}
            </p>

            <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-3 sm:max-w-sm">
              <Fact label="Camera" value={alert.cameraName} />
              <Fact label="Zone" value={alert.zone || 'Not set'} />
              <Fact label="Confidence" value={confidenceLabel(alert.confidence)} />
              <Fact
                label="Detected"
                value={formatShort(alert.detectedAt)}
                title={formatTimestamp(alert.detectedAt)}
              />
              <Fact label="Model" value={alert.model} />
            </dl>

            <div className="mt-7 max-w-md">
              {waiting ? (
                <>
                  <HoldToConfirm
                    key={resetKey}
                    disabled={!canDecide || decision.isPending}
                    disabledReason={!canDecide ? NO_PERMISSION : undefined}
                    onConfirm={() => decide('confirm')}
                  />

                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-neutral-300"
                      disabled={!canDecide || decision.isPending}
                      onClick={() => decide('dismiss')}
                    >
                      Dismiss as false positive
                    </Button>
                  </div>

                  {decision.isPending && (
                    <p
                      role="status"
                      aria-live="polite"
                      className="mt-4 text-meta text-neutral-400"
                    >
                      Recording your decision…
                    </p>
                  )}

                  {decision.isError && <DecisionFailed error={decision.error} />}
                </>
              ) : (
                <p className="text-meta text-neutral-400">
                  This one has been decided. The record is below.
                </p>
              )}
            </div>
          </div>

          <div className="order-1 sm:order-2">
            <EvidenceFrame
              caption={`${alert.cameraId} · ${formatShort(alert.detectedAt)}`}
            />
          </div>
        </div>
      </div>

      {!waiting && <Outcome alert={alert} />}
    </>
  )
}

function Fact({
  label,
  value,
  title,
}: {
  label: string
  value: string
  title?: string
}) {
  return (
    <div>
      <dt className="label-micro text-neutral-500">{label}</dt>
      <dd className="mt-1 truncate font-mono text-data text-paper" title={title ?? value}>
        {value}
      </dd>
    </div>
  )
}

function DecisionFailed({ error }: { error: unknown }) {
  const forbidden = error instanceof Error && error.message === 'forbidden'

  return (
    <div
      role="alert"
      className="mt-4 rounded-md border border-signal-500/40 bg-signal-950 px-4 py-3 text-meta text-signal-200"
    >
      {forbidden
        ? 'Detecto refused the decision: this account cannot confirm alerts. Nothing was recorded, and the alert is still waiting.'
        : "Your decision didn't reach Detecto, so nothing was recorded. The alert is still waiting — try again."}
    </div>
  )
}

/**
 * What the decision did, and — just as importantly — what it did not do. The
 * product's whole claim is that a confirmation unlocks an escalation rather
 * than performing one, so this is the sentence that has to be exact.
 */
function Outcome({ alert }: { alert: Alert }) {
  const claims = useAuthStore((s) => s.claims)
  const byYou = alert.decidedBy !== null && alert.decidedBy === claims?.email
  const who = byYou ? 'you' : (alert.decidedBy ?? 'someone on your team')
  const when = alert.decidedAt ? formatShort(alert.decidedAt) : 'an unknown time'

  const confirmed = alert.status === 'confirmed'

  return (
    <Panel
      className="mt-6"
      label={confirmed ? 'What happens next' : 'Outcome'}
      tone={confirmed ? 'confirm' : 'neutral'}
      action={<AlertStatus status={alert.status} className="text-meta" />}
    >
      <PanelBody>
        {/* Mounts the moment a decision lands, so the outcome is announced —
            dismissing has no control of its own to speak for it. */}
        <p role="status" className="max-w-2xl text-body text-neutral-700">
          {confirmed
            ? `Confirmed by ${who} at ${when}, and recorded against that account.`
            : `Marked as a false positive by ${who} at ${when}.`}
        </p>

        <p className="mt-4 max-w-2xl text-meta text-neutral-600">
          {confirmed ? (
            <>
              <strong className="font-medium text-ink">
                Detecto has not contacted anyone.
              </strong>{' '}
              Confirming records that a person took responsibility for this flag.
              Escalating it — telling a colleague, a guard, or an emergency
              service — is a separate action that a person still has to take, and
              it has not been taken. Nothing reaches authorities on the model's
              word, and nothing reaches them on a confirmation alone either.
            </>
          ) : (
            <>
              Nothing further happens. Nothing was sent anywhere, and the camera
              carries on watching exactly as it was.
            </>
          )}
        </p>
      </PanelBody>
    </Panel>
  )
}
