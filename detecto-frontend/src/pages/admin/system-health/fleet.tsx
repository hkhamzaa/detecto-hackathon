import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowDown, ChevronsUpDown } from 'lucide-react'

import { Figure } from '@/components/ui/figure'
import { Panel, PanelBody } from '@/components/ui/panel'
import { StatusWord } from '@/components/ui/status-word'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { FleetHealth, FleetRow } from '@/lib/health/api'
import {
  byBoxCount,
  byName,
  byStaleness,
  fleetLabel,
  fleetTone,
  THRESHOLD,
} from '@/lib/health/status'
import { formatRelative, formatTimestamp } from '@/lib/time'
import { cn } from '@/lib/utils'

/**
 * Are the boxes talking to us?
 *
 * The one section on this page where a number belongs to a named customer,
 * because a silent Edge Agent is a platform fault somebody has to go and fix,
 * and "two boxes are down somewhere" is not something anyone can act on. It is
 * still counts and a timestamp: whose box, when it last spoke, and nothing
 * about what it was looking at.
 *
 * Defaults to most-concerning-first rather than alphabetical. A platform
 * engineer opening this page has one question, and the answer should be the
 * first row.
 */

type SortKey = 'staleness' | 'name' | 'boxes'

const SORTS: { key: SortKey; label: string; direction: 'ascending' | 'descending' }[] = [
  { key: 'staleness', label: 'Status', direction: 'descending' },
  { key: 'name', label: 'Tenant', direction: 'ascending' },
  { key: 'boxes', label: 'Boxes', direction: 'descending' },
]

function SortableHead({
  sort,
  onSort,
  column,
  className,
}: {
  sort: SortKey
  onSort: (key: SortKey) => void
  column: (typeof SORTS)[number]
  className?: string
}) {
  const active = sort === column.key

  return (
    <TableHead
      aria-sort={active ? column.direction : 'none'}
      className={cn('p-0', className)}
    >
      <button
        type="button"
        onClick={() => onSort(column.key)}
        className={cn(
          'label-micro inline-flex h-9 w-full items-center gap-1.5 px-3 first:pl-0',
          'transition-colors duration-150 hover:text-ink',
          'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring',
          className?.includes('text-right') && 'justify-end',
          active ? 'text-ink' : 'text-neutral-500',
        )}
      >
        {column.label}
        {active ? (
          <ArrowDown aria-hidden="true" className="size-3" />
        ) : (
          <ChevronsUpDown aria-hidden="true" className="size-3 text-neutral-400" />
        )}
      </button>
    </TableHead>
  )
}

export function FleetSection({ fleet, now }: { fleet: FleetHealth; now: number }) {
  const [sort, setSort] = useState<SortKey>('staleness')

  const rows = [...fleet.rows].sort(
    sort === 'name' ? byName : sort === 'boxes' ? byBoxCount : byStaleness(now),
  )

  return (
    <Panel
      label="Edge Agent connectivity"
      tone={fleet.offline > 0 ? 'signal' : 'confirm'}
      className="mb-6"
    >
      <div className="grid divide-y divide-neutral-200 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        <Figure
          label="Boxes reporting"
          value={String(fleet.online)}
          note={`Of ${fleet.total} registered across the platform`}
        />
        <Figure
          label="Gone silent"
          value={String(fleet.offline)}
          tone={fleet.offline > 0 ? 'signal' : 'neutral'}
          note={
            fleet.offline === 0
              ? 'Nothing has stopped talking'
              : `Quiet for more than ${THRESHOLD.boxSilentMinutes} minutes — those cameras are watched by nothing`
          }
        />
        <Figure
          label="Never connected"
          value={String(fleet.neverConnected)}
          note={
            fleet.neverConnected === 0
              ? 'Every box shipped has checked in'
              : 'Shipped and registered, never plugged in'
          }
        />
      </div>

      {fleet.suspended > 0 && (
        <PanelBody className="border-t border-neutral-200 py-4">
          <p className="max-w-2xl text-meta text-neutral-500">
            A further{' '}
            <span className="font-mono text-data">{fleet.suspended}</span>{' '}
            {fleet.suspended === 1 ? 'box is' : 'boxes are'} not syncing because
            their account is suspended. That is the suspension working, not a
            fault, so {fleet.suspended === 1 ? 'it is' : 'they are'} counted
            separately and left uncoloured.
          </p>
        </PanelBody>
      )}

      {rows.length === 0 ? (
        <PanelBody className="border-t border-neutral-200">
          <p className="max-w-2xl text-meta text-neutral-600">
            No Detecto Boxes are registered yet. This fills in as accounts pair
            their first box.
          </p>
        </PanelBody>
      ) : (
        /* Below `sm` this scrolls sideways inside its own container rather than
           reflowing, the same treatment every other table in the product gets:
           status against last-seen is a comparison read across the row. */
        <PanelBody className="border-t border-neutral-200 py-2 sm:py-3">
          <Table>
            <TableHeader>
              <TableRow>
                <SortableHead sort={sort} onSort={setSort} column={SORTS[1]} />
                <SortableHead
                  sort={sort}
                  onSort={setSort}
                  column={SORTS[2]}
                  className="text-right"
                />
                <SortableHead sort={sort} onSort={setSort} column={SORTS[0]} />
                <TableHead className="text-right">Last seen</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <FleetTableRow key={row.tenantId} row={row} now={now} />
              ))}
            </TableBody>
          </Table>
        </PanelBody>
      )}
    </Panel>
  )
}

function FleetTableRow({ row, now }: { row: FleetRow; now: number }) {
  return (
    <TableRow>
      <TableCell>
        <Link
          to={`/admin/tenants/${row.tenantId}`}
          className={cn(
            'whitespace-nowrap text-meta font-medium text-ink',
            'underline decoration-neutral-300 underline-offset-4',
            'transition-colors hover:decoration-current',
            'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
          )}
        >
          {row.tenantName}
        </Link>
      </TableCell>

      <TableCell className="whitespace-nowrap text-right font-mono text-data text-ink">
        {row.boxCount}
      </TableCell>

      <TableCell>
        <StatusWord tone={fleetTone(row)} className="text-meta">
          {fleetLabel(row, now)}
        </StatusWord>
      </TableCell>

      <TableCell className="whitespace-nowrap text-right font-mono text-data text-neutral-600">
        {row.lastSeenAt ? (
          <time dateTime={row.lastSeenAt} title={formatTimestamp(row.lastSeenAt)}>
            {formatRelative(row.lastSeenAt, now)}
          </time>
        ) : (
          'Never'
        )}
      </TableCell>
    </TableRow>
  )
}
