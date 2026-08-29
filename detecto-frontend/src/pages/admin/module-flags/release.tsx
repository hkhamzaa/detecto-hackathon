import { Button } from '@/components/ui/button'
import type { ModuleFlag } from '@/lib/module-flags/api'
import { useSetModuleStatus } from '@/lib/module-flags/queries'

/**
 * Releasing a module, and pulling one back.
 *
 * A plain confirm step, the same weight the org-level zone bulk action gets and
 * for the same reason: this changes something for a great many people at once,
 * so it does not happen on a single click. Press-and-hold is deliberately not
 * used — that control is reserved for the one decision in the product that puts
 * a person's name against a threat, and spending it here would devalue it.
 *
 * The copy states the blast radius as a number, because "some organisations"
 * is not something anybody can weigh at four in the afternoon.
 */

type Mutation = ReturnType<typeof useSetModuleStatus>

function orgs(count: number) {
  return count === 1 ? '1 organisation' : `${count} organisations`
}

export function ReleaseConfirm({
  id,
  module,
  planNames,
  affected,
  suspended,
  mutation,
  onClose,
}: {
  id: string
  module: ModuleFlag
  /** The plans that include it, in the customer's words. */
  planNames: string[]
  /** Organisations on those plans that can act on this immediately. */
  affected: number
  /** On an included plan but suspended, so nothing changes for them today. */
  suspended: number
  mutation: Mutation
  onClose: () => void
}) {
  const going = module.status === 'coming_soon' ? 'live' : 'coming_soon'

  return (
    <div
      id={id}
      className="border-t border-neutral-200 bg-paper-sunken px-5 py-6 sm:px-6"
    >
      <h4 className="text-title font-medium text-ink">
        {going === 'live'
          ? `Release ${module.name}?`
          : `Withdraw ${module.name}?`}
      </h4>

      {planNames.length === 0 ? (
        <p className="mt-2 max-w-prose text-meta text-signal-700">
          No plan includes this module yet, so releasing it would offer it to
          nobody. Add it to at least one plan first.
        </p>
      ) : (
        <p className="mt-2 max-w-prose text-meta text-neutral-600">
          It is on {planNames.join(', ')}.
        </p>
      )}

      <ul className="mt-5 max-w-prose space-y-2.5">
        {going === 'live' ? (
          <>
            <li className="flex gap-3 text-meta text-neutral-700">
              <span aria-hidden="true" className="mt-2 size-1 shrink-0 bg-signal-500" />
              <span>
                <span className="font-medium text-ink">{orgs(affected)}</span> on
                plans that include this module will be able to enable it
                immediately.
              </span>
            </li>
            <li className="flex gap-3 text-meta text-neutral-600">
              <span aria-hidden="true" className="mt-2 size-1 shrink-0 bg-neutral-400" />
              <span>
                Nothing turns itself on. Each organisation still chooses it
                camera by camera, and no camera is watched for this until
                somebody there switches it on.
              </span>
            </li>
            <li className="flex gap-3 text-meta text-neutral-600">
              <span aria-hidden="true" className="mt-2 size-1 shrink-0 bg-neutral-400" />
              <span>
                Detecto does not announce it. If customers should hear about this
                module before they find it, send that first.
              </span>
            </li>
          </>
        ) : (
          <>
            <li className="flex gap-3 text-meta text-neutral-700">
              <span aria-hidden="true" className="mt-2 size-1 shrink-0 bg-signal-500" />
              <span>
                <span className="font-medium text-ink">{orgs(affected)}</span> stop
                being offered this module. Any camera currently running it stops
                being watched for it, and nobody there is told why.
              </span>
            </li>
            <li className="flex gap-3 text-meta text-neutral-600">
              <span aria-hidden="true" className="mt-2 size-1 shrink-0 bg-neutral-400" />
              <span>
                Detections a person already confirmed are untouched. Those are a
                record of a human decision, not model output, and withdrawing a
                module does not rewrite them.
              </span>
            </li>
          </>
        )}

        {suspended > 0 && (
          <li className="flex gap-3 text-meta text-neutral-500">
            <span aria-hidden="true" className="mt-2 size-1 shrink-0 bg-neutral-400" />
            <span>
              A further {orgs(suspended)} on these plans {suspended === 1 ? 'is' : 'are'}{' '}
              suspended, so nothing changes for {suspended === 1 ? 'it' : 'them'}{' '}
              today.
            </span>
          </li>
        )}
      </ul>

      {mutation.isError && (
        <p role="alert" className="mt-5 max-w-prose text-meta text-signal-700">
          Nothing changed — the request didn't reach Detecto. {module.name} is
          exactly as it was. Try again.
        </p>
      )}

      <div className="mt-6 flex flex-wrap gap-2">
        <Button
          type="button"
          variant={going === 'live' ? 'default' : 'destructive'}
          disabled={mutation.isPending || (going === 'live' && planNames.length === 0)}
          onClick={() => mutation.mutate(going, { onSuccess: onClose })}
        >
          {mutation.isPending
            ? going === 'live'
              ? 'Releasing…'
              : 'Withdrawing…'
            : going === 'live'
              ? `Release to ${orgs(affected)}`
              : `Withdraw from ${orgs(affected)}`}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={onClose}
          disabled={mutation.isPending}
        >
          {going === 'live' ? 'Not yet' : 'Leave it live'}
        </Button>
      </div>
    </div>
  )
}
