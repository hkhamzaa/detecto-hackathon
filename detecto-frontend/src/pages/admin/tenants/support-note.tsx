import { useId, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Panel, PanelBody } from '@/components/ui/panel'
import { Textarea } from '@/components/ui/textarea'
import type { TenantDetail } from '@/lib/tenants/api'
import { useSetTenantNote } from '@/lib/tenants/queries'

/**
 * Internal context on an account: why it was suspended, who to ring, what the
 * last conversation was.
 *
 * Visible to Detecto staff only. The tenant has no surface that renders this
 * and no endpoint that returns it — it is not a message to the customer and it
 * is not a field they can answer in. The page says so out loud, because a note
 * field whose audience is ambiguous is one somebody will eventually write
 * something into that they would not have written if they knew.
 *
 * That said: "not shown to them" is not the same as "private". A note is
 * account data, and a customer asking for what Detecto holds on them is
 * entitled to it. The copy below tells the truth about that rather than
 * implying a confessional.
 */
export function SupportNote({ tenant }: { tenant: TenantDetail }) {
  const fieldId = useId()
  const mutation = useSetTenantNote(tenant.id)

  const [draft, setDraft] = useState(tenant.note)

  /*
   * Re-seed when the stored note changes underneath us — this page's own
   * refetch landing after a save, or another admin having written one.
   *
   * Adjusted during render rather than in an effect. React handles a setState
   * here by restarting the render before anything commits, so the field never
   * paints the stale value first; an effect would paint it, then correct it.
   */
  const [seeded, setSeeded] = useState(tenant.note)
  if (seeded !== tenant.note) {
    setSeeded(tenant.note)
    setDraft(tenant.note)
  }

  const dirty = draft !== tenant.note

  return (
    <Panel label="Support note" className="mb-6">
      <PanelBody>
        <div className="grid gap-2">
          <Label htmlFor={fieldId}>Internal context on this account</Label>
          <Textarea
            id={fieldId}
            value={draft}
            rows={5}
            disabled={mutation.isPending}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Why this account is in the state it is in, who to contact, what was agreed."
            className="max-w-2xl"
          />
        </div>

        <p className="mt-3 max-w-2xl text-meta text-neutral-500">
          Detecto staff only — nobody on the customer's account sees this, and it
          is never sent to them. It is still account data, so write it as
          something you would be content to hand over if they ever asked what we
          hold on them.
        </p>

        {mutation.isError && (
          <p role="alert" className="mt-4 max-w-2xl text-meta text-signal-700">
            The note wasn't saved — the request didn't reach Detecto. What is
            stored is still the last version that saved. Try again.
          </p>
        )}

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <Button
            type="button"
            disabled={!dirty || mutation.isPending}
            onClick={() => mutation.mutate(draft)}
          >
            {mutation.isPending ? 'Saving…' : 'Save note'}
          </Button>

          {dirty && !mutation.isPending && (
            <Button type="button" variant="ghost" onClick={() => setDraft(tenant.note)}>
              Discard changes
            </Button>
          )}

          <p role="status" aria-live="polite" className="text-meta text-neutral-500">
            {mutation.isPending
              ? ''
              : dirty
                ? 'Not saved yet'
                : mutation.isSuccess
                  ? 'Saved'
                  : ''}
          </p>
        </div>
      </PanelBody>
    </Panel>
  )
}
