import { useMemo, useRef, useState, type FormEvent } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { StepActions, StepHeading } from '@/pages/signup/step-parts'
import {
  formatPrice,
  planById,
  plansFor,
  recommendPlan,
  type Plan,
} from '@/lib/plans'
import {
  digits,
  focusFirstInvalid,
  formatCardNumber,
  formatExpiry,
  isFutureExpiry,
  issueSummary,
  type Errors,
} from '@/lib/forms'
import { CAMERA_BUCKETS, useSignupStore } from '@/store/signup-store'
import { cn } from '@/lib/utils'

type PayField = 'cardName' | 'cardNumber' | 'expiry' | 'cvc' | 'postcode'

export function StepPlan() {
  const accountType = useSignupStore((s) => s.accountType)
  const homeCameras = useSignupStore((s) => s.home.cameras)
  const orgCameras = useSignupStore((s) => s.org.cameras)
  const orgUsers = useSignupStore((s) => s.org.users)
  const planId = useSignupStore((s) => s.planId)
  const selectPlan = useSignupStore((s) => s.selectPlan)
  const payment = useSignupStore((s) => s.payment)
  const patchPayment = useSignupStore((s) => s.patchPayment)
  const finish = useSignupStore((s) => s.finish)

  const [showOthers, setShowOthers] = useState(false)
  const [errors, setErrors] = useState<Errors<PayField>>({})
  const formRef = useRef<HTMLFormElement>(null)

  const audience = accountType ?? 'home'
  const bucket = CAMERA_BUCKETS.find((b) => b.value === homeCameras)

  const cameras = audience === 'org' ? orgCameras : (bucket?.estimate ?? 1)
  const users = audience === 'org' ? orgUsers : 1

  const recommendation = useMemo(
    () => recommendPlan(audience, cameras, users),
    [audience, cameras, users],
  )

  const selected = (planId ? planById(planId) : null) ?? recommendation.plan
  const others = plansFor(audience).filter((p) => p.id !== recommendation.plan.id)
  const offRecommendation = selected.id !== recommendation.plan.id

  const basis =
    audience === 'org'
      ? `${cameras} ${cameras === 1 ? 'camera' : 'cameras'} and ${users} ${users === 1 ? 'person' : 'people'}`
      : `${bucket?.value === '12+' ? 'more than 12' : (bucket?.label ?? '1')} ${bucket?.value === '1' ? 'camera' : 'cameras'}`

  const clear = (field: PayField) =>
    setErrors((prev) => ({ ...prev, [field]: undefined }))

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    const next: Errors<PayField> = {}
    const cardDigits = digits(payment.cardNumber)

    if (!payment.cardName.trim()) {
      next.cardName = 'Enter the name printed on the card.'
    }
    if (!cardDigits) {
      next.cardNumber = 'Enter the long number on the front of the card.'
    } else if (cardDigits.length < 13 || cardDigits.length > 19) {
      next.cardNumber = `A card number is 13 to 19 digits. This one has ${cardDigits.length}.`
    }
    if (!payment.expiry.trim()) {
      next.expiry = 'Enter the expiry date as MM/YY.'
    } else if (!/^\d{2}\/\d{2}$/.test(payment.expiry)) {
      next.expiry = 'Use MM/YY, like 04/29.'
    } else if (!isFutureExpiry(payment.expiry)) {
      next.expiry = 'That date has passed. Check the expiry on the card.'
    }
    if (digits(payment.cvc).length < 3) {
      next.cvc = 'Enter the 3 digits on the back of the card.'
    }
    if (!payment.postcode.trim()) {
      next.postcode = 'Enter the billing postcode for this card.'
    }

    setErrors(next)
    if (Object.keys(next).length > 0) {
      requestAnimationFrame(() => focusFirstInvalid(formRef.current))
      return
    }
    finish()
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} noValidate>
      <StepHeading title="Your plan">
        Based on {basis}, {recommendation.plan.name} fits. You can pick a
        different one.
      </StepHeading>

      <PlanOption
        plan={recommendation.plan}
        selected={selected.id === recommendation.plan.id}
        recommended
        onSelect={() => selectPlan(recommendation.plan.id)}
      />

      {recommendation.overCapacity && (
        <p className="mt-3 text-meta text-neutral-600">
          Your estimate is above what {recommendation.plan.name} covers. Start
          here — we'll size the rest of the deployment with you once the Box is
          connected.
        </p>
      )}

      {others.length > 0 && (
        <div className="mt-4">
          {/* Once a different plan is chosen the list stays open — collapsing it
              would hide the thing the customer actually selected. */}
          {!offRecommendation && (
            <Button
              type="button"
              variant="link"
              size="sm"
              className="px-0"
              aria-expanded={showOthers}
              aria-controls="other-plans"
              onClick={() => setShowOthers((v) => !v)}
            >
              {showOthers
                ? 'Hide other plans'
                : `Show other plans (${others.length})`}
            </Button>
          )}

          {(showOthers || offRecommendation) && (
            <div id="other-plans" className="mt-3 grid gap-3">
              {others.map((plan) => (
                <PlanOption
                  key={plan.id}
                  plan={plan}
                  selected={selected.id === plan.id}
                  onSelect={() => selectPlan(plan.id)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ---- Payment ---- */}
      <section className="mt-12">
        <h2 className="font-display text-display-sm font-medium text-ink">
          Payment
        </h2>
        <div className="mt-6 grid gap-6">
          <Field label="Name on card" error={errors.cardName}>
            {(props) => (
              <Input
                {...props}
                value={payment.cardName}
                onChange={(e) => {
                  patchPayment({ cardName: e.target.value })
                  clear('cardName')
                }}
                autoComplete="cc-name"
              />
            )}
          </Field>

          <Field label="Card number" error={errors.cardNumber}>
            {(props) => (
              <Input
                {...props}
                value={payment.cardNumber}
                onChange={(e) => {
                  patchPayment({ cardNumber: formatCardNumber(e.target.value) })
                  clear('cardNumber')
                }}
                inputMode="numeric"
                autoComplete="cc-number"
                placeholder="4242 4242 4242 4242"
                className="font-mono text-data"
              />
            )}
          </Field>

          <div className="grid gap-6 sm:grid-cols-3">
            <Field label="Expiry" error={errors.expiry} className="sm:col-span-1">
              {(props) => (
                <Input
                  {...props}
                  value={payment.expiry}
                  onChange={(e) => {
                    patchPayment({ expiry: formatExpiry(e.target.value) })
                    clear('expiry')
                  }}
                  inputMode="numeric"
                  autoComplete="cc-exp"
                  placeholder="MM/YY"
                  className="font-mono text-data"
                />
              )}
            </Field>

            <Field label="CVC" error={errors.cvc} className="sm:col-span-1">
              {(props) => (
                <Input
                  {...props}
                  value={payment.cvc}
                  onChange={(e) => {
                    patchPayment({ cvc: digits(e.target.value).slice(0, 4) })
                    clear('cvc')
                  }}
                  inputMode="numeric"
                  autoComplete="cc-csc"
                  placeholder="123"
                  className="font-mono text-data"
                />
              )}
            </Field>

            <Field
              label="Billing postcode"
              error={errors.postcode}
              className="sm:col-span-1"
            >
              {(props) => (
                <Input
                  {...props}
                  value={payment.postcode}
                  onChange={(e) => {
                    patchPayment({ postcode: e.target.value })
                    clear('postcode')
                  }}
                  autoComplete="postal-code"
                />
              )}
            </Field>
          </div>
        </div>
      </section>

      {/* ---- One total. Hardware is inside the plan, not a line item. ---- */}
      <div className="mt-10 border-t border-neutral-200 pt-6">
        <div className="flex items-baseline justify-between gap-4">
          <span className="text-title text-ink">{selected.name}</span>
          <span className="font-display text-display-sm font-medium text-ink">
            {formatPrice(selected.monthly)}
            <span className="ml-1.5 text-meta font-normal text-neutral-600">
              a month
            </span>
          </span>
        </div>
        <p className="mt-2 text-meta text-neutral-600">
          Billed monthly, starting today. Your Detecto Box is part of this plan
          and ships with it.
        </p>
      </div>

      <p aria-live="polite" className="sr-only">
        {issueSummary(errors)}
      </p>
      <StepActions
        submitLabel={`Confirm and pay ${formatPrice(selected.monthly)} a month`}
      />
    </form>
  )
}

function PlanOption({
  plan,
  selected,
  recommended = false,
  onSelect,
}: {
  plan: Plan
  selected: boolean
  recommended?: boolean
  onSelect: () => void
}) {
  return (
    <label className="block cursor-pointer">
      <input
        type="radio"
        name="plan"
        value={plan.id}
        checked={selected}
        onChange={onSelect}
        className="peer sr-only"
      />
      <span
        className={cn(
          'block rounded-md border bg-paper-raised transition-colors duration-150',
          recommended ? 'p-5 sm:p-6' : 'p-4 sm:p-5',
          'peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring',
          selected
            ? 'border-ink'
            : 'border-neutral-300 hover:border-neutral-400',
        )}
      >
        <span className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
          <span className="flex items-center gap-3">
            <span
              className={cn(
                'font-display font-medium text-ink',
                recommended ? 'text-display-sm' : 'text-title',
              )}
            >
              {plan.name}
            </span>
            {recommended && <Badge variant="outline">Recommended</Badge>}
          </span>
          <span className="font-display text-display-sm font-medium text-ink">
            {formatPrice(plan.monthly)}
            <span className="ml-1.5 text-meta font-normal text-neutral-600">
              a month
            </span>
          </span>
        </span>

        <span className="mt-2 block text-meta text-neutral-600">
          {plan.summary}
        </span>

        {recommended && (
          <span className="mt-5 block">
            <span className="label-micro text-neutral-500">Includes</span>
            {/* Spans with list roles: a <label> only admits phrasing content,
                so real <ul>/<li> here would be invalid nesting. */}
            <span role="list" className="mt-3 grid gap-2">
              {plan.includes.map((item) => (
                <span
                  key={item}
                  role="listitem"
                  className="flex gap-3 text-meta text-neutral-700"
                >
                  <span
                    aria-hidden="true"
                    className="mt-2 size-1 shrink-0 bg-neutral-400"
                  />
                  {item}
                </span>
              ))}
            </span>
          </span>
        )}
      </span>
    </label>
  )
}
