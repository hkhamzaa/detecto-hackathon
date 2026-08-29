import { useId, useState, type FormEvent } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { StatusWord } from '@/components/ui/status-word'
import { Switch } from '@/components/ui/switch'
import type { ModuleFlag } from '@/lib/module-flags/api'
import {
  useSetModulePlans,
  useSetModuleRate,
  useSetModuleStatus,
} from '@/lib/module-flags/queries'
import { PLANS } from '@/lib/plans'
import type { Tenant } from '@/lib/tenants/api'
import { formatDate } from '@/lib/time'
import { ReleaseConfirm } from '@/pages/admin/module-flags/release'

/**
 * One module in the registry: whether it exists, who is entitled to it, and
 * what the benchmark measured.
 *
 * Two different weights of control, on purpose. The plan switches take effect
 * the moment they move, which is what a `Switch` means everywhere else in the
 * product — and each one says out loud what it just did, so a change that costs
 * customers a capability is not silent. Releasing or withdrawing the module
 * goes behind a confirm instead: it is the change that decides whether the
 * thing exists at all, and it is not undone by clicking the same control again
 * without consequence.
 */

function planLabelsFor(planIds: string[]) {
  return PLANS.filter((plan) => planIds.includes(plan.id)).map((plan) => plan.name)
}

/** Organisations on these plans, split by whether they can act on it today. */
function reach(tenants: Tenant[], planIds: string[]) {
  const onPlan = tenants.filter((tenant) => planIds.includes(tenant.planId))
  const suspended = onPlan.filter((tenant) => tenant.status === 'suspended').length
  return { affected: onPlan.length - suspended, suspended }
}

export function ModuleRow({
  module,
  tenants,
}: {
  module: ModuleFlag
  /** The registry, for working out how many accounts a change reaches. */
  tenants: Tenant[]
}) {
  const confirmId = useId()
  const [confirming, setConfirming] = useState(false)

  const status = useSetModuleStatus(module.id)
  const live = module.status === 'live'

  const planNames = planLabelsFor(module.planIds)
  const { affected, suspended } = reach(tenants, module.planIds)

  return (
    <li>
      <div className="px-5 py-6 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <h3 className="text-title font-medium text-ink">{module.name}</h3>
              <StatusWord tone={live ? 'confirm' : 'neutral'} className="text-meta">
                {live ? 'Live' : 'Coming soon'}
              </StatusWord>
            </div>

            <p className="mt-1 max-w-prose text-meta text-neutral-600">
              {module.description}
            </p>

            <p className="mt-1.5 text-meta text-neutral-500">
              {live && module.liveSince ? (
                <>
                  Released{' '}
                  <time dateTime={module.liveSince} className="font-mono text-data">
                    {formatDate(module.liveSince)}
                  </time>
                  {' · '}
                </>
              ) : null}
              {planNames.length === 0
                ? 'On no plan yet'
                : `On ${planNames.join(', ')}`}
            </p>
          </div>

          <Button
            type="button"
            size="sm"
            variant={live ? 'ghost' : 'outline'}
            aria-expanded={confirming}
            aria-controls={confirmId}
            onClick={() => setConfirming((open) => !open)}
          >
            {live ? 'Withdraw' : 'Release'}
          </Button>
        </div>

        <PlanTiers module={module} tenants={tenants} />

        {live && <RateField module={module} />}

        {!live && (
          <p className="mt-5 max-w-prose border-t border-neutral-200 pt-4 text-meta text-neutral-500">
            Not built yet. Organisations see it on their modules page, switched
            off and marked coming soon, and it has no false positive rate until
            it has actually run — a plausible-looking one would be a fabrication.
          </p>
        )}
      </div>

      {confirming && (
        <ReleaseConfirm
          id={confirmId}
          module={module}
          planNames={planNames}
          affected={affected}
          suspended={suspended}
          mutation={status}
          onClose={() => setConfirming(false)}
        />
      )}
    </li>
  )
}

/* -------------------------------------------------------------------------- */
/* Plan tiers                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Which plans include this module.
 *
 * A switch per plan rather than a checklist with a save button, because each
 * one takes effect on its own — which is exactly the distinction `Switch`
 * carries everywhere else in the product.
 *
 * Every change announces its own consequence in a live region. Adding a plan to
 * a live module hands a capability to paying customers; removing one takes it
 * away. Neither should happen silently just because it took one click.
 */
function PlanTiers({ module, tenants }: { module: ModuleFlag; tenants: Tenant[] }) {
  const mutation = useSetModulePlans(module.id)
  const [said, setSaid] = useState<string | null>(null)

  const change = (planId: string, include: boolean) => {
    const next = include
      ? [...module.planIds, planId]
      : module.planIds.filter((id) => id !== planId)

    const plan = PLANS.find((item) => item.id === planId)
    const count = tenants.filter(
      (tenant) => tenant.planId === planId && tenant.status !== 'suspended',
    ).length

    mutation.mutate(next, {
      onSuccess: () => {
        // Only a live module changes anything for anybody today.
        if (module.status !== 'live') {
          setSaid(
            `${plan?.name} ${include ? 'added' : 'removed'}. Nothing changes for anyone until the module is released.`,
          )
          return
        }
        const who = count === 1 ? '1 organisation' : `${count} organisations`
        setSaid(
          include
            ? `${plan?.name} added — ${who} can now enable this.`
            : `${plan?.name} removed — ${who} lose it.`,
        )
      },
    })
  }

  return (
    <fieldset className="mt-6 border-t border-neutral-200 pt-5" disabled={mutation.isPending}>
      <legend className="label-micro text-neutral-500">Included in</legend>

      <ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {PLANS.map((plan) => (
          <PlanSwitch
            key={plan.id}
            planId={plan.id}
            name={plan.name}
            audience={plan.audience === 'home' ? 'Household' : 'Organisation'}
            included={module.planIds.includes(plan.id)}
            onChange={(include) => change(plan.id, include)}
          />
        ))}
      </ul>

      <p role="status" aria-live="polite" className="mt-3 text-meta text-neutral-600">
        {mutation.isPending ? 'Saving…' : (said ?? '')}
      </p>

      {mutation.isError && (
        <p role="alert" className="mt-1 text-meta text-signal-700">
          That didn't save. The plans are back where they were — try again.
        </p>
      )}
    </fieldset>
  )
}

function PlanSwitch({
  planId,
  name,
  audience,
  included,
  onChange,
}: {
  planId: string
  name: string
  audience: string
  included: boolean
  onChange: (include: boolean) => void
}) {
  const id = useId()

  return (
    <li className="flex items-start gap-3">
      <Switch
        id={id}
        checked={included}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5"
      />
      <span className="min-w-0">
        <Label htmlFor={id} className="text-meta text-ink">
          {name}
        </Label>
        <span className="block text-meta text-neutral-500">{audience}</span>
        <span className="sr-only">{planId}</span>
      </span>
    </li>
  )
}

/* -------------------------------------------------------------------------- */
/* Measured rate                                                              */
/* -------------------------------------------------------------------------- */

/**
 * The published false-positive rate, edited here and read-only everywhere else.
 *
 * Typed as a percentage because that is how anybody reading a benchmark report
 * says it, and stored as 0–1 because that is what the contract carries. The
 * hint is doing real work: this is a measurement, and a number a person can
 * type is a number a person can wish for.
 */
function RateField({ module }: { module: ModuleFlag }) {
  const fieldId = useId()
  const hintId = `${fieldId}-hint`
  const mutation = useSetModuleRate(module.id)

  const stored =
    module.falsePositiveRate === null
      ? ''
      : String(Math.round(module.falsePositiveRate * 1000) / 10)
  const [draft, setDraft] = useState(stored)

  // Adjusted during render rather than in an effect, so the field never paints
  // a stale value and then corrects it.
  const [seeded, setSeeded] = useState(stored)
  if (seeded !== stored) {
    setSeeded(stored)
    setDraft(stored)
  }

  const parsed = draft.trim() === '' ? null : Number(draft)
  const invalid =
    parsed !== null && (!Number.isFinite(parsed) || parsed < 0 || parsed > 100)
  const dirty = draft !== stored

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (invalid || !dirty || mutation.isPending) return
    mutation.mutate(parsed === null ? null : parsed / 100)
  }

  return (
    <form onSubmit={submit} noValidate className="mt-6 border-t border-neutral-200 pt-5">
      <div className="grid gap-2 sm:max-w-xs">
        <Label htmlFor={fieldId}>Measured false positive rate</Label>
        <div className="flex items-center gap-2">
          <Input
            id={fieldId}
            type="number"
            inputMode="decimal"
            min={0}
            max={100}
            step={0.1}
            value={draft}
            aria-describedby={hintId}
            aria-invalid={invalid ? true : undefined}
            disabled={mutation.isPending}
            onChange={(event) => setDraft(event.target.value)}
            className="w-28"
          />
          <span className="text-body text-neutral-600">%</span>

          <Button type="submit" size="sm" disabled={!dirty || invalid || mutation.isPending}>
            {mutation.isPending ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>

      <p id={hintId} className="mt-2 max-w-prose text-meta text-neutral-500">
        What the benchmark reported for this model build. It is a measurement,
        not a target — every organisation sees it on their modules page, and
        their own analytics compares it against what their team actually
        dismissed.
      </p>

      {invalid && (
        <p role="alert" className="mt-2 text-meta text-signal-700">
          A rate is a percentage between 0 and 100.
        </p>
      )}

      {mutation.isError && (
        <p role="alert" className="mt-2 text-meta text-signal-700">
          That didn't save. The published rate is still the last one that did —
          try again.
        </p>
      )}
    </form>
  )
}
