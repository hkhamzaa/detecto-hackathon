import { useId } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'

import { TenantStatus } from '@/components/admin/tenant-status'
import { PageHeader } from '@/components/app-shell/page-header'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Panel, PanelBody } from '@/components/ui/panel'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { can } from '@/lib/auth/claims'
import { planById } from '@/lib/plans'
import type { Tenant, TenantStatus as Status } from '@/lib/tenants/api'
import { planLabel } from '@/lib/tenants/labels'
import { useTenants } from '@/lib/tenants/queries'
import { formatDate } from '@/lib/time'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/store/auth-store'

type Segment = Status | 'all'

const SEGMENTS: { value: Segment; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'trial', label: 'Trial' },
  { value: 'suspended', label: 'Suspended' },
]

const DEFAULT_SEGMENT: Segment = 'all'

function isSegment(value: string | null): value is Segment {
  return SEGMENTS.some((segment) => segment.value === value)
}

/**
 * Every account on Detecto, and what they are paying for.
 *
 * Account-level data only. There is no column here that could hold a camera, a
 * zone or a detection, because `Tenant` has no field that holds one — the
 * restraint is in the type, not in what this page chose to render. See the note
 * at the top of `lib/tenants/api.ts`.
 */
export default function AdminTenantsPage() {
  const claims = useAuthStore((s) => s.claims)
  const canView = can(claims, 'admin:tenants')

  const [searchParams, setSearchParams] = useSearchParams()
  const { data: tenants, isPending, isError, refetch, isFetching } = useTenants()

  const query = searchParams.get('q') ?? ''
  const requested = searchParams.get('status')
  const segment: Segment = isSegment(requested) ? requested : DEFAULT_SEGMENT

  const setParam = (key: string, value: string, fallback: string) => {
    const params = new URLSearchParams(searchParams)
    if (value === fallback) params.delete(key)
    else params.set(key, value)
    // Replaced, so typing in the search box does not fill the back button with
    // one entry per keystroke on the way out of the page.
    setSearchParams(params, { replace: true })
  }

  if (!canView) {
    return (
      <>
        <PageHeader eyebrow="Platform" title="Tenants" />
        <Panel label="Not available to you" tone="signal">
          <PanelBody>
            <p className="max-w-2xl text-meta text-neutral-600">
              This is a Detecto platform surface, and your account doesn't hold
              the grant for it.
            </p>
          </PanelBody>
        </Panel>
      </>
    )
  }

  const counts: Record<Segment, number> = {
    all: tenants?.length ?? 0,
    active: tenants?.filter((t) => t.status === 'active').length ?? 0,
    trial: tenants?.filter((t) => t.status === 'trial').length ?? 0,
    suspended: tenants?.filter((t) => t.status === 'suspended').length ?? 0,
  }

  const needle = query.trim().toLowerCase()
  const shown = (tenants ?? [])
    .filter((tenant) => segment === 'all' || tenant.status === segment)
    .filter(
      (tenant) =>
        needle === '' ||
        tenant.name.toLowerCase().includes(needle) ||
        // The account contact is the other thing support has in front of them
        // when somebody emails in, so it is searchable too.
        tenant.adminEmail.toLowerCase().includes(needle),
    )
    .sort((a, b) => a.name.localeCompare(b.name))

  return (
    <>
      <PageHeader
        eyebrow="Platform"
        title="Tenants"
        lead="Every organisation and household on Detecto, what they are paying for, and how much of it they are actually using."
      />

      <Filters
        query={query}
        segment={segment}
        counts={counts}
        disabled={isPending || isError}
        onQuery={(value) => setParam('q', value, '')}
        onSegment={(value) => setParam('status', value, DEFAULT_SEGMENT)}
      />

      {isPending ? (
        <Loading />
      ) : isError ? (
        <Unavailable onRetry={() => void refetch()} pending={isFetching} />
      ) : shown.length === 0 ? (
        <NoMatches
          onClear={() => setSearchParams(new URLSearchParams(), { replace: true })}
          filtered={needle !== '' || segment !== DEFAULT_SEGMENT}
        />
      ) : (
        <Results tenants={shown} />
      )}
    </>
  )
}

/* -------------------------------------------------------------------------- */
/* Filters                                                                    */
/* -------------------------------------------------------------------------- */

function Filters({
  query,
  segment,
  counts,
  disabled,
  onQuery,
  onSegment,
}: {
  query: string
  segment: Segment
  counts: Record<Segment, number>
  disabled: boolean
  onQuery: (value: string) => void
  onSegment: (value: Segment) => void
}) {
  const searchId = useId()

  return (
    <div className="mb-6 grid gap-5 sm:grid-cols-[minmax(0,22rem)_1fr] sm:items-start">
      <div className="grid gap-2">
        <Label htmlFor={searchId}>Search</Label>
        <Input
          id={searchId}
          type="search"
          value={query}
          disabled={disabled}
          onChange={(event) => onQuery(event.target.value)}
          placeholder="Name or account contact"
          autoComplete="off"
        />
      </div>

      {/* Native radios, styled — the same control the alert queue uses for the
          same job. Arrow-key navigation, a real focus ring, and a group the
          screen reader already understands, for free. */}
      <fieldset disabled={disabled}>
        <legend className="label-micro mb-2 text-neutral-500">Show</legend>
        <div className="flex flex-wrap gap-2">
          {SEGMENTS.map((option) => (
            <label key={option.value} className="cursor-pointer">
              <input
                type="radio"
                name="tenant-status"
                value={option.value}
                checked={segment === option.value}
                onChange={() => onSegment(option.value)}
                className="peer sr-only"
              />
              <span
                className={cn(
                  'flex items-center gap-2 rounded-md border border-neutral-300 bg-paper-raised px-3.5 py-2 text-meta text-neutral-700',
                  'transition-colors duration-150 hover:border-neutral-400',
                  'peer-checked:border-ink peer-checked:bg-ink peer-checked:text-paper',
                  'peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring',
                  'peer-disabled:opacity-50',
                )}
              >
                {option.label}
                <span
                  className={cn(
                    'font-mono text-micro',
                    segment === option.value ? 'text-neutral-300' : 'text-neutral-500',
                  )}
                >
                  {counts[option.value]}
                </span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* The table                                                                  */
/* -------------------------------------------------------------------------- */

function Results({ tenants }: { tenants: Tenant[] }) {
  return (
    <Panel
      label="Tenants"
      action={
        <span className="label-micro text-neutral-500">
          {tenants.length} {tenants.length === 1 ? 'account' : 'accounts'}
        </span>
      }
    >
      {/* Below `sm` this scrolls sideways inside its own container rather than
          reflowing into cards — plan against camera count against status is a
          comparison read across the row, and stacking loses it. */}
      <PanelBody className="py-2 sm:py-3">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Tenant</TableHead>
              <TableHead>Plan</TableHead>
              <TableHead className="text-right">Cameras</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Created</TableHead>
              <TableHead>Account contact</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tenants.map((tenant) => {
              const plan = planById(tenant.planId)
              const atCeiling =
                plan !== undefined && tenant.cameraCount >= plan.maxCameras

              return (
                <TableRow key={tenant.id}>
                  <TableCell>
                    <Link
                      to={`/admin/tenants/${tenant.id}`}
                      className={cn(
                        'inline-flex items-center gap-1 whitespace-nowrap text-meta font-medium text-ink',
                        'underline decoration-neutral-300 underline-offset-4',
                        'transition-colors hover:decoration-current',
                        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                      )}
                    >
                      {tenant.name}
                      <ChevronRight aria-hidden="true" className="size-3.5 text-neutral-400" />
                    </Link>
                  </TableCell>

                  <TableCell className="whitespace-nowrap text-neutral-700">
                    {planLabel(tenant.planId)}
                  </TableCell>

                  <TableCell className="whitespace-nowrap text-right font-mono text-data text-ink">
                    {tenant.cameraCount}
                    {plan && (
                      <span
                        className={cn(
                          atCeiling ? 'text-signal-700' : 'text-neutral-500',
                        )}
                        title={
                          atCeiling
                            ? `At the ${plan.name} ceiling of ${plan.maxCameras}`
                            : undefined
                        }
                      >
                        {' '}
                        / {plan.maxCameras}
                      </span>
                    )}
                  </TableCell>

                  <TableCell>
                    <TenantStatus tenant={tenant} className="text-meta" />
                  </TableCell>

                  <TableCell className="whitespace-nowrap text-right font-mono text-data text-neutral-600">
                    <time dateTime={tenant.createdAt}>
                      {formatDate(tenant.createdAt)}
                    </time>
                  </TableCell>

                  <TableCell className="whitespace-nowrap font-mono text-data text-neutral-600">
                    {tenant.adminEmail}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </PanelBody>
    </Panel>
  )
}

/* -------------------------------------------------------------------------- */
/* States                                                                     */
/* -------------------------------------------------------------------------- */

function Loading() {
  return (
    <Panel label="Tenants">
      <PanelBody>
        <p role="status" aria-live="polite" className="text-meta text-neutral-500">
          Loading the tenant list…
        </p>
      </PanelBody>
    </Panel>
  )
}

function Unavailable({ onRetry, pending }: { onRetry: () => void; pending: boolean }) {
  return (
    <Panel label="Can't load the tenant list" tone="signal">
      <PanelBody>
        <p className="max-w-2xl text-meta text-neutral-600">
          Detecto couldn't reach the service that holds the tenant registry. No
          account has been changed, and nobody's detection has stopped — this is
          the list, not the platform.
        </p>
        <Button
          type="button"
          variant="outline"
          className="mt-5"
          onClick={onRetry}
          disabled={pending}
        >
          {pending ? 'Trying again…' : 'Try again'}
        </Button>
      </PanelBody>
    </Panel>
  )
}

function NoMatches({ onClear, filtered }: { onClear: () => void; filtered: boolean }) {
  return (
    <Panel label="Nothing to show">
      <PanelBody>
        <p className="max-w-2xl text-meta text-neutral-600">
          {filtered
            ? 'No account matches that. Check the spelling, or widen the filter.'
            : 'There are no tenants on the platform yet.'}
        </p>
        {filtered && (
          <Button type="button" variant="outline" className="mt-5" onClick={onClear}>
            Clear filters
          </Button>
        )}
      </PanelBody>
    </Panel>
  )
}
