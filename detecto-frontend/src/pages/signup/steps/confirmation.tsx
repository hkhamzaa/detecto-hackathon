import { Check } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { formatPrice, planById, recommendPlan } from '@/lib/plans'
import { CAMERA_BUCKETS, useSignupStore } from '@/store/signup-store'

const NEXT = [
  'Your Detecto Box ships in 2–3 business days.',
  'Plug it in and point it at the cameras you already have. Nothing gets replaced.',
  'Detection starts once the Box is connected. Every flag waits for a person to confirm it before it goes anywhere.',
]

export function Confirmation() {
  const accountType = useSignupStore((s) => s.accountType)
  const email = useSignupStore((s) => s.account.email)
  const homeCameras = useSignupStore((s) => s.home.cameras)
  const orgName = useSignupStore((s) => s.org.name)
  const orgCameras = useSignupStore((s) => s.org.cameras)
  const orgUsers = useSignupStore((s) => s.org.users)
  const planId = useSignupStore((s) => s.planId)
  const reset = useSignupStore((s) => s.reset)

  const audience = accountType ?? 'home'
  const bucket = CAMERA_BUCKETS.find((b) => b.value === homeCameras)
  const cameras = audience === 'org' ? orgCameras : (bucket?.estimate ?? 1)
  const users = audience === 'org' ? orgUsers : 1

  const plan =
    (planId ? planById(planId) : null) ??
    recommendPlan(audience, cameras, users).plan

  return (
    <div>
      <span
        aria-hidden="true"
        className="mb-6 flex size-10 items-center justify-center rounded-full bg-confirm-500 text-white"
      >
        <Check className="size-5" />
      </span>

      <h1 className="font-display text-display-md font-medium text-ink">
        Account created.
      </h1>
      <p className="mt-3 max-w-prose text-body text-neutral-600">
        A receipt is on its way to{' '}
        <span className="font-mono text-data text-ink">{email}</span>.
      </p>

      <dl className="mt-8 grid gap-x-8 gap-y-4 border-y border-neutral-200 py-6 sm:grid-cols-3">
        <div>
          <dt className="label-micro text-neutral-500">Plan</dt>
          <dd className="mt-1.5 text-body text-ink">
            {plan.name} — {formatPrice(plan.monthly)} a month
          </dd>
        </div>
        <div>
          <dt className="label-micro text-neutral-500">
            {audience === 'org' ? 'Organization' : 'Cameras'}
          </dt>
          <dd className="mt-1.5 text-body text-ink">
            {audience === 'org' ? orgName : (bucket?.label ?? '1')}
          </dd>
        </div>
        <div>
          <dt className="label-micro text-neutral-500">
            {audience === 'org' ? 'People with access' : 'Detection'}
          </dt>
          <dd className="mt-1.5 text-body text-ink">
            {audience === 'org' ? users : 'Weapon and violence'}
          </dd>
        </div>
      </dl>

      <h2 className="label-micro mt-8 text-neutral-500">What happens next</h2>
      <ol className="mt-4 grid gap-4">
        {NEXT.map((item, i) => (
          <li key={item} className="flex gap-4 text-body text-neutral-700">
            <span className="font-mono text-data text-neutral-500">
              {String(i + 1).padStart(2, '0')}
            </span>
            <span className="max-w-prose">{item}</span>
          </li>
        ))}
      </ol>

      <div className="mt-10 border-t border-neutral-200 pt-6">
        <Button type="button" variant="ghost" size="sm" onClick={reset}>
          Start over
        </Button>
      </div>
    </div>
  )
}
