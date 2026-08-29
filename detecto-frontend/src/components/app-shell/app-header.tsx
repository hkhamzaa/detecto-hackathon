import { Link } from 'react-router-dom'
import { LogOut, Menu, UserRound } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useLogout } from '@/hooks/use-logout'
import type { Claims } from '@/lib/auth/claims'
import { roleLabel, scopeLabel } from '@/lib/auth/labels'
import type { NavArea } from '@/lib/auth/nav'
import { useUiStore } from '@/store/ui-store'

/**
 * Ink chrome across the top: who you are, which tenant you are looking at, and
 * the way out. Below `sm` the context line gives its room to the brand and the
 * sign-out control, and reappears in the drawer instead of disappearing.
 */
export function AppHeader({
  claims,
  area,
}: {
  claims: Claims
  area: NavArea | null
}) {
  const navOpen = useUiStore((s) => s.navOpen)
  const toggleNav = useUiStore((s) => s.toggleNav)
  const { signOutNow, pending } = useLogout()

  return (
    <header className="dark sticky top-0 z-30 border-b border-ink-hairline bg-ink">
      <div className="flex h-14 items-center justify-between gap-3 px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
          {area && (
            <Button
              variant="ghost"
              size="icon"
              className="-ml-2 text-paper lg:hidden"
              aria-expanded={navOpen}
              aria-controls="app-nav-drawer"
              onClick={toggleNav}
            >
              <Menu />
              <span className="sr-only">Open navigation</span>
            </Button>
          )}

          <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-signal-500" />
          <span className="font-display text-title font-semibold tracking-tight text-paper">
            Detecto
          </span>

          <span
            aria-hidden="true"
            className="hidden h-4 w-px shrink-0 bg-ink-hairline sm:block"
          />
          <div className="hidden min-w-0 items-baseline gap-2 sm:flex">
            {area && <span className="label-micro text-neutral-500">{area.title}</span>}
            <span className="truncate text-meta text-neutral-300">
              {scopeLabel(claims)}
            </span>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-3">
          {/* The signed-in email is the affordance for your own account: it is
              already the thing on screen that identifies you, and this page
              belongs to no sidebar because it belongs to no area. */}
          <div className="hidden items-center gap-2.5 md:flex">
            <Link
              to="/account"
              className="max-w-[16rem] truncate text-meta text-neutral-300 underline decoration-neutral-600 underline-offset-4 transition-colors hover:text-paper hover:decoration-current focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              {claims.email}
            </Link>
            <Badge variant="outline">{roleLabel(claims.role)}</Badge>
          </div>

          {/* Below `md` the email is gone, so the account needs its own way in.
              The drawer carries one too, but somebody with no navigation area
              has no drawer at all. */}
          <Button
            asChild
            variant="ghost"
            size="icon"
            className="text-neutral-300 md:hidden"
          >
            <Link to="/account">
              <UserRound />
              <span className="sr-only">Your account</span>
            </Link>
          </Button>

          <Button
            variant="ghost"
            size="sm"
            className="text-neutral-300"
            onClick={signOutNow}
            disabled={pending}
          >
            <LogOut />
            <span className="hidden sm:inline">
              {pending ? 'Signing out…' : 'Sign out'}
            </span>
            <span className="sr-only sm:hidden">Sign out</span>
          </Button>
        </div>
      </div>
    </header>
  )
}
