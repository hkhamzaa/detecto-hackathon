import { useId } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import { Panel, PanelBody } from '@/components/ui/panel'
import type { AuditActor } from '@/lib/audit/api'
import {
  ACTION_GROUPS,
  isFiltered,
  type ActionGroup,
  type AuditFilter,
} from '@/lib/audit/filter'

/**
 * The four questions somebody actually arrives with.
 *
 * Who, what kind of thing, between when and when, and — for the times the
 * answer is a name or an id they were given — a plain search over the words on
 * the row. Nobody browses this page; they open it because an auditor asked
 * something specific, so the filters are the page rather than an ornament above
 * it.
 *
 * Every control is a native one. A date range built out of two `<input
 * type="date">` gets the platform picker on a phone, keyboard entry on a
 * desktop, and a locale the reader already understands — none of which a custom
 * calendar would have got right for the same effort.
 */
export function AuditFilters({
  filter,
  actors,
  matching,
  total,
  onChange,
}: {
  filter: AuditFilter
  /** Everybody in the log, including people who have since left. */
  actors: AuditActor[]
  matching: number
  total: number
  onChange: (next: AuditFilter) => void
}) {
  const ids = {
    person: useId(),
    action: useId(),
    from: useId(),
    to: useId(),
    query: useId(),
  }

  const set = (patch: Partial<AuditFilter>) => onChange({ ...filter, ...patch })
  const filtered = isFiltered(filter)

  return (
    <Panel
      label="Find an entry"
      className="mb-6"
      action={
        <span className="label-micro text-neutral-500">
          {filtered ? `${matching} of ${total}` : `${total} entries`}
        </span>
      }
    >
      <PanelBody>
        {/* One column on a phone, two from `sm`, four from `lg`. The date pair
            stays side by side wherever there is room for it, because a range
            read as two stacked fields is easy to fill in backwards. */}
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          <div className="grid gap-2">
            <Label htmlFor={ids.person}>Person</Label>
            <NativeSelect
              id={ids.person}
              value={filter.actorId ?? ''}
              onChange={(event) => set({ actorId: event.target.value || null })}
            >
              <option value="">Anyone</option>
              {actors.map((actor) => (
                <option key={actor.id} value={actor.id}>
                  {actor.name}
                </option>
              ))}
            </NativeSelect>
          </div>

          <div className="grid gap-2">
            <Label htmlFor={ids.action}>Action</Label>
            <NativeSelect
              id={ids.action}
              value={filter.group ?? ''}
              onChange={(event) =>
                set({ group: (event.target.value || null) as ActionGroup | null })
              }
            >
              <option value="">Everything</option>
              {ACTION_GROUPS.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.label}
                </option>
              ))}
            </NativeSelect>
          </div>

          <div className="grid gap-2">
            <Label htmlFor={ids.from}>From</Label>
            <Input
              id={ids.from}
              type="date"
              value={filter.from ?? ''}
              max={filter.to ?? undefined}
              onChange={(event) => set({ from: event.target.value || null })}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor={ids.to}>To</Label>
            <Input
              id={ids.to}
              type="date"
              value={filter.to ?? ''}
              min={filter.from ?? undefined}
              onChange={(event) => set({ to: event.target.value || null })}
            />
          </div>
        </div>

        <div className="mt-5 grid gap-2">
          <Label htmlFor={ids.query}>Search</Label>
          <Input
            id={ids.query}
            type="search"
            value={filter.query}
            placeholder="A camera, a role, an alert id…"
            onChange={(event) => set({ query: event.target.value })}
            className="sm:max-w-md"
          />
          <p className="text-meta text-neutral-500">
            Matches the person, the action and what changed — including the alert
            id on a decision.
          </p>
        </div>

        {filtered && (
          <Button
            type="button"
            variant="ghost"
            className="mt-5"
            onClick={() =>
              onChange({ actorId: null, group: null, from: null, to: null, query: '' })
            }
          >
            Clear filters
          </Button>
        )}
      </PanelBody>
    </Panel>
  )
}
