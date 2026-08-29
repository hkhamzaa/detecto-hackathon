import { NavLink } from 'react-router-dom'

import type { NavArea } from '@/lib/auth/nav'
import { cn } from '@/lib/utils'

/**
 * The nav list itself, shared by the desktop sidebar and the mobile drawer so
 * the two can never show different things.
 *
 * `area.items` arrives already filtered by `navFor`. Nothing is rendered and
 * then disabled — a route this person cannot use is simply not here.
 */
export function SidebarNav({
  area,
  className,
  onNavigate,
}: {
  area: NavArea
  className?: string
  onNavigate?: () => void
}) {
  return (
    <nav className={className} aria-label={area.title}>
      <p className="label-micro mb-3 px-2.5 text-neutral-500">{area.title}</p>
      <ul className="space-y-0.5">
        {area.items.map((item) => {
          const Icon = item.icon
          return (
            <li key={item.to}>
              <NavLink
                to={item.to}
                onClick={onNavigate}
                className={({ isActive }) =>
                  cn(
                    'relative flex items-center gap-3 rounded-md px-2.5 py-2 text-meta',
                    'transition-colors duration-150',
                    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                    isActive
                      ? 'bg-ink-raised text-paper'
                      : 'text-neutral-400 hover:bg-ink-raised hover:text-paper',
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    {/* Position marker, in Paper. Signal is never spent on
                        something as ordinary as "you are here". */}
                    {isActive && (
                      <span
                        aria-hidden="true"
                        className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-paper"
                      />
                    )}
                    <Icon
                      aria-hidden="true"
                      className={cn(
                        'size-4 shrink-0',
                        isActive ? 'text-paper' : 'text-neutral-500',
                      )}
                    />
                    <span className="truncate">{item.label}</span>
                  </>
                )}
              </NavLink>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
