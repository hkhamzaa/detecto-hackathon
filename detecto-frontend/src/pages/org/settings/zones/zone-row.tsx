import { useId, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { NativeSelect } from '@/components/ui/native-select'
import { useMergeZones, useRenameZone } from '@/lib/zones/queries'
import {
  planMerge,
  renameIssue,
  summariseReferences,
  type ZoneReferences,
} from '@/lib/zones/references'
import type { Camera } from '@/lib/cameras/api'
import type { NotificationRoute } from '@/lib/notifications/api'
import type { Role } from '@/lib/roles/api'
import { cn } from '@/lib/utils'

const NAME_MAX = 40

/**
 * One zone, what points at it, and the two things that can be done to it.
 *
 * Renaming and merging are separated on purpose even though the transport ends
 * up doing something similar for both. They are different decisions: renaming
 * changes a label and touches nobody's access, merging widens it. Offering them
 * as one control with a dropdown would flatten that difference, and the
 * difference is the whole reason one of them has a confirm step.
 */
export function ZoneRow({
  references,
  zones,
  cameras,
  roles,
  routes,
  canManage,
}: {
  references: ZoneReferences
  /** Every zone in use, for the rename collision check and the merge target list. */
  zones: string[]
  cameras: Camera[]
  roles: Role[]
  routes: NotificationRoute[]
  canManage: boolean
}) {
  const panelId = useId()
  const [open, setOpen] = useState<'rename' | 'merge' | null>(null)

  const { zone } = references

  return (
    <li>
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 px-5 py-5 sm:px-6">
        <div className="min-w-0">
          <h3 className="text-body font-medium text-ink">{zone}</h3>
          <p className="mt-1 text-meta text-neutral-600">
            {summariseReferences(references)}
          </p>

          {references.cameras.length > 0 && (
            <p className="mt-1.5 max-w-prose text-meta text-neutral-500">
              {references.cameras.map((camera) => camera.name).join(', ')}
            </p>
          )}
        </div>

        {canManage && (
          <div className="flex shrink-0 flex-wrap gap-2">
            {/* The visible word is short because the zone is right beside it;
                the accessible name carries the zone, because a screen reader
                moving through this list would otherwise hear "Rename" once per
                zone with nothing to tell them apart. Same pattern as the alert
                queue's row links. */}
            <Button
              type="button"
              size="sm"
              variant="outline"
              aria-label={`Rename ${zone}`}
              aria-expanded={open === 'rename'}
              aria-controls={panelId}
              onClick={() => setOpen((current) => (current === 'rename' ? null : 'rename'))}
            >
              Rename
            </Button>
            {zones.length > 1 && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                aria-label={`Merge ${zone} into another zone`}
                aria-expanded={open === 'merge'}
                aria-controls={panelId}
                onClick={() => setOpen((current) => (current === 'merge' ? null : 'merge'))}
              >
                Merge into…
              </Button>
            )}
          </div>
        )}
      </div>

      {open === 'rename' && (
        <Rename
          id={panelId}
          references={references}
          zones={zones}
          onClose={() => setOpen(null)}
        />
      )}

      {open === 'merge' && (
        <Merge
          id={panelId}
          references={references}
          zones={zones}
          cameras={cameras}
          roles={roles}
          routes={routes}
          onClose={() => setOpen(null)}
        />
      )}
    </li>
  )
}

/* -------------------------------------------------------------------------- */
/* Rename                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * A rename touches nobody's access, so it does not get a confirm step — but it
 * does say what it is about to rewrite, because "this is a text field" is the
 * wrong mental model for something stored in three places.
 */
function Rename({
  id,
  references,
  zones,
  onClose,
}: {
  id: string
  references: ZoneReferences
  zones: string[]
  onClose: () => void
}) {
  const mutation = useRenameZone()
  const { zone } = references

  const [next, setNext] = useState(zone)
  const issue = renameIssue(zone, next, zones)

  const message =
    issue === 'name_taken'
      ? `Your organisation already has a zone called “${next.trim()}”. Merging into it is a different action, and it is on the row above or below.`
      : issue === 'empty'
        ? 'A zone needs a name.'
        : undefined

  if (mutation.isSuccess) {
    return (
      <div id={id} className="border-t border-neutral-200 bg-paper-sunken px-5 py-5 sm:px-6">
        <p role="status" className="max-w-prose text-body text-ink">
          {zone} is now {next.trim()}, everywhere it was referenced.
        </p>
        <Button type="button" variant="outline" className="mt-4" onClick={onClose}>
          Done
        </Button>
      </div>
    )
  }

  return (
    <div id={id} className="border-t border-neutral-200 bg-paper-sunken px-5 py-5 sm:px-6">
      <h4 className="text-body font-medium text-ink">Rename {zone}</h4>

      <p className="mt-2 max-w-prose text-meta text-neutral-600">
        This rewrites the name on {summariseReferences(references)} together, in
        one change. Nobody's access changes — the same roles reach the same
        cameras afterwards, under a different name.
      </p>

      <Field label="New name" error={message} className="mt-5 sm:max-w-sm">
        {(props) => (
          <Input
            {...props}
            value={next}
            onChange={(event) => setNext(event.target.value)}
            maxLength={NAME_MAX}
            autoComplete="off"
            disabled={mutation.isPending}
          />
        )}
      </Field>

      <p className="mt-4 max-w-prose text-meta text-neutral-500">
        Detections already raised keep the name they were raised under, and so
        does the audit log. Those are records of what happened; rewriting them so
        the past matches the present is the one thing an audit trail must not do.
      </p>

      {mutation.isError && (
        <p role="alert" className="mt-4 max-w-prose text-meta text-signal-700">
          {mutation.error instanceof Error && mutation.error.message === 'name_taken'
            ? 'Detecto refused it — that name is already a different zone.'
            : `Nothing was renamed — the change didn't reach Detecto. ${zone} and everything referencing it are exactly as they were.`}
        </p>
      )}

      <div className="mt-5 flex flex-wrap gap-2">
        <Button
          type="button"
          disabled={issue !== null || mutation.isPending}
          onClick={() => mutation.mutate({ from: zone, to: next.trim() })}
        >
          {mutation.isPending ? 'Renaming…' : 'Rename everywhere'}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={onClose}
          disabled={mutation.isPending}
        >
          Cancel
        </Button>
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Merge                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Merging is the consequential one, so it goes behind a plain confirm step —
 * the same weight the zone-wide module change and the escalation change get,
 * and deliberately not press-and-hold, which stays with the one decision that
 * puts a person's name against a detection.
 *
 * The step states three things, all computed from the real data rather than
 * described in general: what moves, whose access widens, and who ends up being
 * notified.
 */
function Merge({
  id,
  references,
  zones,
  cameras,
  roles,
  routes,
  onClose,
}: {
  id: string
  references: ZoneReferences
  zones: string[]
  cameras: Camera[]
  roles: Role[]
  routes: NotificationRoute[]
  onClose: () => void
}) {
  const mutation = useMergeZones()
  const { zone } = references

  const targets = zones.filter((other) => other !== zone)
  const [into, setInto] = useState(targets[0] ?? '')
  const [confirming, setConfirming] = useState(false)

  const plan = into ? planMerge(zone, into, cameras, roles, routes) : null

  if (mutation.isSuccess) {
    return (
      <div id={id} className="border-t border-neutral-200 bg-paper-sunken px-5 py-5 sm:px-6">
        <p role="status" className="max-w-prose text-body text-ink">
          {zone} is now part of {into}. Everything that referenced {zone} points
          at {into}.
        </p>
        <Button type="button" variant="outline" className="mt-4" onClick={onClose}>
          Done
        </Button>
      </div>
    )
  }

  if (confirming && plan) {
    return (
      <div id={id} className="border-t border-neutral-200 bg-paper-sunken px-5 py-5 sm:px-6">
        <h4 className="text-body font-medium text-ink">
          Merge {zone} into {into}?
        </h4>

        <p className="mt-2 max-w-prose text-body text-neutral-700">
          {summariseReferences(references)} reference {zone}. After this, {zone}{' '}
          does not exist and all of it points at {into}.
        </p>

        <ul className="mt-5 max-w-prose space-y-2.5">
          <li className="flex gap-3 text-meta text-neutral-700">
            <span aria-hidden="true" className="mt-2 size-1 shrink-0 bg-neutral-400" />
            <span>
              <span className="font-medium text-ink">
                {plan.camerasMoving.length === 1
                  ? '1 camera'
                  : `${plan.camerasMoving.length} cameras`}
              </span>{' '}
              move into {into}.
            </span>
          </li>

          {plan.rolesRescoped.length > 0 && (
            <li className="flex gap-3 text-meta text-neutral-700">
              <span aria-hidden="true" className="mt-2 size-1 shrink-0 bg-neutral-400" />
              <span>
                {plan.rolesRescoped.length === 1 ? '1 role' : `${plan.rolesRescoped.length} roles`}{' '}
                held to {zone} ({plan.rolesRescoped.map((role) => role.name).join(', ')})
                will be held to {into} instead.
              </span>
            </li>
          )}

          {/* The consequence somebody would otherwise find out about later. */}
          {plan.widened.length > 0 && (
            <li className="flex gap-3 text-meta text-signal-700">
              <span aria-hidden="true" className="mt-2 size-1 shrink-0 bg-signal-500" />
              <span>
                <span className="font-medium">This widens access.</span>{' '}
                {plan.widened
                  .map(
                    (entry) =>
                      `${entry.role.name} will be able to open ${
                        entry.gains.length === 1
                          ? '1 camera'
                          : `${entry.gains.length} cameras`
                      } it cannot today`,
                  )
                  .join('; ')}
                . Everything already in {into} becomes reachable by anybody who
                could only reach {zone}.
              </span>
            </li>
          )}

          <li className="flex gap-3 text-meta text-neutral-600">
            <span aria-hidden="true" className="mt-2 size-1 shrink-0 bg-neutral-400" />
            <span>{plan.route.reason}</span>
          </li>
        </ul>

        <p className="mt-5 max-w-prose text-meta text-neutral-500">
          This cannot be undone by merging back — {zone} stops existing, and
          splitting the cameras out again means setting each one's zone by hand.
          Detections already raised keep the name they were raised under.
        </p>

        {mutation.isError && (
          <p role="alert" className="mt-4 max-w-prose text-meta text-signal-700">
            Nothing was merged — the change didn't reach Detecto. {zone} and{' '}
            {into} are both exactly as they were. Try again.
          </p>
        )}

        <div className="mt-6 flex flex-wrap gap-2">
          <Button
            type="button"
            variant="destructive"
            disabled={mutation.isPending}
            onClick={() => mutation.mutate({ from: zone, into })}
          >
            {mutation.isPending ? 'Merging…' : `Merge into ${into}`}
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => setConfirming(false)}
            disabled={mutation.isPending}
          >
            Back
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div id={id} className="border-t border-neutral-200 bg-paper-sunken px-5 py-5 sm:px-6">
      <h4 className="text-body font-medium text-ink">Merge {zone} into another zone</h4>
      <p className="mt-2 max-w-prose text-meta text-neutral-600">
        For two names that turned out to be the same place. Every camera, role
        and notification route on {zone} moves across, and {zone} stops existing.
      </p>

      <div className="mt-5 grid gap-2 sm:max-w-xs">
        <label htmlFor={`${id}-into`} className="text-meta font-medium text-ink">
          Merge into
        </label>
        <NativeSelect
          id={`${id}-into`}
          value={into}
          onChange={(event) => setInto(event.target.value)}
        >
          {targets.map((target) => (
            <option key={target} value={target}>
              {target}
            </option>
          ))}
        </NativeSelect>
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        <Button type="button" disabled={!into} onClick={() => setConfirming(true)}>
          Review the merge
        </Button>
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Orphans                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Names something still points at, that no camera is in.
 *
 * Shown apart from the real zones because they are not places — they are
 * references left behind when the last camera moved out, and a role scoped only
 * to one of them reaches nothing at all. There is no control offered: tidying
 * them means editing the role or the route that names them, on the pages that
 * own those, and a "remove" button here would be this page reaching into two
 * other stores to delete something on a guess.
 */
export function OrphanedZones({
  zones,
  roles,
  routes,
}: {
  zones: string[]
  roles: Role[]
  routes: NotificationRoute[]
}) {
  return (
    <ul className="grid gap-4">
      {zones.map((zone) => {
        const scoped = roles.filter(
          (role) => role.zones !== null && role.zones.includes(zone),
        )
        const routed = routes.filter(
          (route) => route.kind === 'zone' && route.target === zone,
        )

        return (
          <li key={zone}>
            <h3 className={cn('text-meta font-medium', 'text-ink')}>{zone}</h3>
            <p className="mt-1 max-w-2xl text-meta text-neutral-600">
              No camera is in it.{' '}
              {scoped.length > 0 && (
                <>
                  {scoped.length === 1 ? '1 role is' : `${scoped.length} roles are`}{' '}
                  still held to it ({scoped.map((role) => role.name).join(', ')}),
                  which means {scoped.length === 1 ? 'it reaches' : 'they reach'} no
                  cameras through this name.{' '}
                </>
              )}
              {routed.length > 0 && (
                <>A notification route still points at it, and nothing is raised under it. </>
              )}
              Fix it by giving a camera this zone, or by editing the{' '}
              {scoped.length > 0 ? 'role' : 'route'} that names it.
            </p>
          </li>
        )
      })}
    </ul>
  )
}

