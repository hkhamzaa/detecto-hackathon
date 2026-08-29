import { fireEvent } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { PlatformHealth } from '@/lib/health/api'
import { HEALTH_KEY } from '@/lib/health/queries'
import { getPlatformSummary } from '@/lib/tenants/api'
import { SUMMARY_KEY } from '@/lib/tenants/queries'
import AdminSystemHealthPage from '@/pages/admin/system-health'
import { NO_GRANTS, renderPage, signIn, SUPER_ADMIN } from '@/test/harness'

/**
 * The four sections, at the three volumes the platform can be in.
 *
 * The behaviour worth protecting is the same as on the analytics page: enough
 * data draws a chart, not enough says so and keeps the live figures. Plus the
 * restraint rule — a healthy platform should be almost entirely uncoloured.
 */

async function health(mode?: 'degraded' | 'new'): Promise<PlatformHealth> {
  vi.resetModules()
  vi.stubEnv('VITE_HEALTH_MOCK', mode ?? '')

  const api = await import('@/lib/health/api')
  const result = await api.getPlatformHealth()
  if (!result.ok) throw new Error(result.code)
  return result.health
}

async function open(mode?: 'degraded' | 'new') {
  const data = await health(mode)
  const summary = await getPlatformSummary()

  return renderPage(<AdminSystemHealthPage />, {
    seed: (client) => {
      client.setQueryData(HEALTH_KEY, data)
      if (summary.ok) client.setQueryData(SUMMARY_KEY, summary.summary)
    },
  })
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('permissions', () => {
  it('refuses an account without the grant', async () => {
    signIn(NO_GRANTS)
    expect((await open()).text()).toContain("doesn't hold the grant")
  })
})

describe('a healthy platform', () => {
  it('leads with a verdict so the page can be read at a glance', async () => {
    signIn(SUPER_ADMIN)
    // Two boxes are genuinely silent in the default mock, so this is the
    // "something needs attention" branch.
    expect((await open()).text()).toContain('Something needs attention')
  })

  it('renders all four sections', async () => {
    signIn(SUPER_ADMIN)
    const out = (await open()).text()

    expect(out).toContain('Edge Agent connectivity')
    expect(out).toContain('API and servers')
    expect(out).toContain('Queue health')
    expect(out).toContain('Infrastructure cost')
  })

  it('names the queues the backend actually runs', async () => {
    signIn(SUPER_ADMIN)
    const out = (await open()).text()

    expect(out).toContain('Frame ingest')
    expect(out).toContain('Anomaly detection')
  })

  it('shows the cost against the promise it is there to check', async () => {
    signIn(SUPER_ADMIN)
    const out = (await open()).text()

    expect(out).toContain('Month to date')
    expect(out).toContain('Oracle Cloud')
    expect(out).toContain('Per account')
    expect(out).toContain('Still costing nothing')
  })

  it('explains suspended boxes rather than colouring them as a fault', async () => {
    signIn(SUPER_ADMIN)
    expect((await open()).text()).toContain('That is the suspension working, not a fault')
  })

  it('draws its charts and shows no sparse state', async () => {
    signIn(SUPER_ADMIN)
    const out = (await open()).text()

    expect(out).toContain('Response time by hour')
    expect(out).not.toContain('Not enough data yet')
  })

  it('keeps colour scarce, so the one thing that matters still stands out', async () => {
    signIn(SUPER_ADMIN)
    const view = await open()
    const coloured = (view.html().match(/text-signal-700/g) ?? []).length

    // Two silent boxes is the only fault in the default mock. If this climbs,
    // something has started colouring numbers that are simply fine.
    expect(coloured).toBeLessThanOrEqual(6)
  })
})

describe('the fleet table', () => {
  it('links each row to the tenant it belongs to', async () => {
    signIn(SUPER_ADMIN)
    expect((await open()).html()).toContain('/admin/tenants/')
  })

  it('exposes its sort state to assistive technology', async () => {
    signIn(SUPER_ADMIN)
    expect((await open()).html()).toContain('aria-sort')
  })

  it('defaults to most concerning first and can be re-sorted by name', async () => {
    signIn(SUPER_ADMIN)
    const view = await open()

    const names = () =>
      [...view.container.querySelectorAll('tbody tr td:first-child')].map(
        (cell) => cell.textContent?.trim() ?? '',
      )

    const byConcern = names()
    fireEvent.click(view.getByRole('button', { name: /Tenant/ }))
    const alphabetical = names()

    expect(alphabetical).toEqual([...alphabetical].sort((a, b) => a.localeCompare(b)))
    expect(alphabetical).not.toEqual(byConcern)
  })
})

describe('a degraded platform', () => {
  it('says something needs attention and warns about late alerts', async () => {
    signIn(SUPER_ADMIN)
    const out = (await open('degraded')).text()

    expect(out).toContain('Something needs attention')
    expect(out).toContain('arriving late')
  })
})

describe('a brand new platform', () => {
  it('withholds the hourly charts', async () => {
    signIn(SUPER_ADMIN)
    const out = (await open('new')).text()

    expect(out).toContain('Not enough data yet')
    expect(out).not.toContain('Response time by hour')
  })

  it('keeps the live figures, and says only the trend is missing', async () => {
    signIn(SUPER_ADMIN)
    const out = (await open('new')).text()

    expect(out).toContain('Response time (p95)')
    expect(out).toContain('only the trend is withheld')
    expect(out).toContain('Frame ingest')
  })
})
