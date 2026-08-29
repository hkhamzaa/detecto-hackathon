import { Link } from 'react-router-dom'
import { Check } from 'lucide-react'

import { Button } from '@/components/ui/button'

const NEXT = [
  'Detecto is receiving these feeds now. Cameras the box already had a picture from show as online straight away; anything you typed in by hand stays offline until the box can reach it.',
  'Detection is switched on separately, camera by camera, under Detection modules. Until you do that, nothing is being watched for weapons or violence.',
  'Once it is on, every flag still waits for a person to confirm it. Detecto does not contact anyone on its own.',
]

export function StepDone({
  count,
  onRestart,
}: {
  count: number
  onRestart: () => void
}) {
  return (
    <div>
      <span
        aria-hidden="true"
        className="mb-6 flex size-10 items-center justify-center rounded-full bg-confirm-500 text-white"
      >
        <Check className="size-5" />
      </span>

      <h2 className="font-display text-display-md font-medium text-ink">
        {count === 1 ? 'One camera added.' : `${count} cameras added.`}
      </h2>
      <p className="mt-3 max-w-prose text-body text-neutral-600">
        They are on your camera list now, with the names and zones you gave them.
      </p>

      <h3 className="label-micro mt-9 text-neutral-500">What happens next</h3>
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

      <div className="mt-10 flex flex-col-reverse gap-3 border-t border-neutral-200 pt-6 sm:flex-row sm:items-center sm:justify-between">
        <Button type="button" variant="ghost" onClick={onRestart}>
          Connect another box
        </Button>
        <Button asChild size="lg" className="w-full sm:w-auto">
          <Link to="/org/cameras">See your cameras</Link>
        </Button>
      </div>
    </div>
  )
}
