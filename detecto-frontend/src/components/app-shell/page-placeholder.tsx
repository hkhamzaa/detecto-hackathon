import { PageHeader } from '@/components/app-shell/page-header'
import { Panel, PanelBody } from '@/components/ui/panel'

/**
 * A route that exists, in its right place in the nav, with nothing behind it
 * yet — and says so plainly instead of pretending to be a dashboard.
 *
 * `coming` is what will actually be on this page, written specifically. A page
 * that cannot describe what belongs on it probably should not be in the nav.
 */
export function PagePlaceholder({
  eyebrow,
  title,
  lead,
  coming,
  note,
}: {
  eyebrow: string
  title: string
  lead: string
  coming: string[]
  note?: string
}) {
  return (
    <>
      <PageHeader eyebrow={eyebrow} title={title} lead={lead} />

      <Panel label="Nothing to show yet">
        <PanelBody>
          <p className="max-w-2xl text-meta text-neutral-600">
            The page is here; the data behind it is not. This is what will be on
            it:
          </p>

          <ul className="mt-4 max-w-2xl space-y-2.5">
            {coming.map((line) => (
              <li key={line} className="flex gap-3 text-meta text-neutral-600">
                <span
                  aria-hidden="true"
                  className="mt-2 size-1 shrink-0 bg-neutral-400"
                />
                <span>{line}</span>
              </li>
            ))}
          </ul>

          {note && (
            <p className="mt-5 max-w-2xl border-t border-neutral-200 pt-4 text-meta text-neutral-500">
              {note}
            </p>
          )}
        </PanelBody>
      </Panel>
    </>
  )
}
