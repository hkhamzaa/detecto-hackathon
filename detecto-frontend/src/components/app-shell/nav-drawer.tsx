import { useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { X } from 'lucide-react'

import { SidebarNav } from '@/components/app-shell/sidebar-nav'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { Claims } from '@/lib/auth/claims'
import { roleLabel, scopeLabel } from '@/lib/auth/labels'
import type { NavArea } from '@/lib/auth/nav'
import { useUiStore } from '@/store/ui-store'

const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * Below `lg` the sidebar is not narrowed, it is put away — a control-room nav
 * squeezed into a 320px gutter is unusable, and a bottom bar cannot hold ten
 * items without abbreviating them into guesswork.
 *
 * It behaves as a modal dialog because it covers the page: Escape closes it,
 * the overlay closes it, Tab cycles inside it, and focus returns to whatever
 * opened it. The slide is a plain CSS animation, so the root
 * `prefers-reduced-motion` rule in `index.css` already flattens it.
 */
export function NavDrawer({ area, claims }: { area: NavArea; claims: Claims }) {
  const open = useUiStore((s) => s.navOpen)
  const closeNav = useUiStore((s) => s.closeNav)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return

    const opener = document.activeElement as HTMLElement | null
    panelRef.current?.focus()

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeNav()
        return
      }
      if (event.key !== 'Tab') return

      const panel = panelRef.current
      if (!panel) return
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE))
      if (focusable.length === 0) return

      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const active = document.activeElement

      if (event.shiftKey && (active === first || active === panel)) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && active === last) {
        event.preventDefault()
        first.focus()
      }
    }

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    document.addEventListener('keydown', onKeyDown)

    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
      opener?.focus()
    }
  }, [open, closeNav])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-40 lg:hidden">
      <button
        type="button"
        onClick={closeNav}
        className="absolute inset-0 animate-in fade-in bg-ink/70 duration-150"
      >
        <span className="sr-only">Close navigation</span>
      </button>

      <div
        id="app-nav-drawer"
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Navigation"
        tabIndex={-1}
        className="dark absolute inset-y-0 left-0 flex w-72 max-w-[85%] animate-in slide-in-from-left flex-col border-r border-ink-hairline bg-ink outline-none duration-200"
      >
        <div className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-ink-hairline px-4">
          <div className="flex items-center gap-3">
            <span aria-hidden="true" className="size-2 rounded-full bg-signal-500" />
            <span className="font-display text-title font-semibold tracking-tight text-paper">
              Detecto
            </span>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="-mr-2 text-paper"
            onClick={closeNav}
          >
            <X />
            <span className="sr-only">Close navigation</span>
          </Button>
        </div>

        <SidebarNav
          area={area}
          onNavigate={closeNav}
          className="flex-1 overflow-y-auto px-3 py-4"
        />

        {/* The context the header gives up below `sm`, put back — and the way
            into your own account, which belongs to no area's nav list. */}
        <div className="shrink-0 border-t border-ink-hairline px-4 py-4">
          <Link
            to="/account"
            onClick={closeNav}
            className="block truncate text-meta text-neutral-300 underline decoration-neutral-600 underline-offset-4 transition-colors hover:text-paper hover:decoration-current focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            {claims.email}
          </Link>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge variant="outline">{roleLabel(claims.role)}</Badge>
            <span className="label-micro truncate text-neutral-500">
              {scopeLabel(claims)}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
