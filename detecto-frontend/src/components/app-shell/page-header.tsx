import type { ReactNode } from 'react'

import { useDocumentTitle } from '@/hooks/use-document-title'

/**
 * The top of every page in the shell: where you are, what this is, and — when
 * the page has one — the single action that belongs to the whole page.
 *
 * It owns the browser tab title too, because the heading and the tab are the
 * same statement and should not be able to disagree.
 */
export function PageHeader({
  eyebrow,
  title,
  lead,
  action,
}: {
  eyebrow: string
  title: string
  lead?: string
  action?: ReactNode
}) {
  useDocumentTitle(title)

  return (
    <header className="mb-10">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
        <div className="min-w-0">
          <p className="label-micro mb-4 text-neutral-500">{eyebrow}</p>
          <h1 className="font-display text-display-lg font-semibold text-ink">
            {title}
          </h1>
        </div>
        {action && <div className="shrink-0 sm:pt-8">{action}</div>}
      </div>

      {lead && <p className="mt-5 max-w-2xl text-body text-neutral-600">{lead}</p>}
    </header>
  )
}
