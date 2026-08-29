import type { ReactNode } from 'react'

/** Ink chrome, one lit Paper card. Shared by login and the reset sub-flow. */
export function AuthShell({
  children,
  footer,
}: {
  children: ReactNode
  footer?: ReactNode
}) {
  return (
    <div className="min-h-dvh bg-ink">
      <header className="border-b border-ink-hairline">
        <div className="mx-auto flex h-14 max-w-md items-center gap-3 px-4 sm:px-6">
          <span aria-hidden="true" className="size-2 rounded-full bg-signal-500" />
          <span className="font-display text-title font-semibold tracking-tight text-paper">
            Detecto
          </span>
        </div>
      </header>

      <main className="mx-auto w-full max-w-md px-4 py-10 sm:px-6 sm:py-16">
        <div className="rounded-lg border border-ink-hairline bg-paper p-5 sm:p-8">
          {children}
        </div>
        {footer && <div className="mt-6 text-center">{footer}</div>}
      </main>
    </div>
  )
}
