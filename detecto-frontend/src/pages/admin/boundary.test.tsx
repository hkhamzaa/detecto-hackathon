import { readFileSync } from 'node:fs'
import { dirname, join, resolve as resolvePath } from 'node:path'
import type { QueryClient } from '@tanstack/react-query'
import { beforeAll, describe, expect, it } from 'vitest'

import * as billingApi from '@/lib/billing/api'
import { BILLING_KEY } from '@/lib/billing/queries'
import * as healthApi from '@/lib/health/api'
import { HEALTH_KEY } from '@/lib/health/queries'
import * as tenantsApi from '@/lib/tenants/api'
import { SUMMARY_KEY, TENANTS_KEY, tenantKey } from '@/lib/tenants/queries'
import AdminBillingPage from '@/pages/admin/billing'
import AdminOverviewPage from '@/pages/admin/overview'
import AdminSystemHealthPage from '@/pages/admin/system-health'
import AdminTenantDetailPage from '@/pages/admin/tenants/detail'
import AdminTenantsPage from '@/pages/admin/tenants'
import { renderPage, signIn, SUPER_ADMIN } from '@/test/harness'

/**
 * The standing architectural rule, as a test.
 *
 * A super admin runs the platform. They do not get to watch a customer's
 * cameras. That rule is held in three places and this file checks all three:
 * the types carry no content, the rendered pages show none, and no admin page
 * pulls an alert or camera module into its bundle at all.
 *
 * The last one is the important one. A page cannot leak what it cannot import,
 * and this is the check that fails the build on the commit that adds the
 * import — before anybody has to notice it on screen.
 */

/** Vitest runs from the project root, so this is stable across platforms. */
const SRC = resolvePath(process.cwd(), 'src')

/** Local imports of one module, as written. `@/x` and `./x` alike. */
function importsOf(file: string): string[] {
  const source = readFileSync(file, 'utf8')
  return [...source.matchAll(/^\s*(?:import|export)[\s\S]*?from\s+'([^']+)'/gm)]
    .map((match) => match[1])
    .filter((specifier) => specifier.startsWith('@/') || specifier.startsWith('.'))
}

function resolveLocal(specifier: string, from: string): string | null {
  const base = specifier.startsWith('@/')
    ? join(SRC, specifier.slice(2))
    : resolvePath(dirname(from), specifier)

  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, 'index.ts'),
    join(base, 'index.tsx'),
  ]) {
    try {
      readFileSync(candidate, 'utf8')
      return candidate
    } catch {
      // Not this extension; try the next.
    }
  }
  return null
}

/** Every local module an entry point can reach, transitively. */
function moduleGraph(entry: string): string[] {
  const seen = new Set<string>()
  const queue = [entry]

  while (queue.length > 0) {
    const file = queue.pop() as string
    if (seen.has(file)) continue
    seen.add(file)

    for (const specifier of importsOf(file)) {
      const resolved = resolveLocal(specifier, file)
      if (resolved && !seen.has(resolved)) queue.push(resolved)
    }
  }

  return [...seen]
}

const ADMIN_PAGES = [
  'pages/admin/overview.tsx',
  'pages/admin/tenants/index.tsx',
  'pages/admin/tenants/detail.tsx',
  'pages/admin/system-health/index.tsx',
  'pages/admin/module-flags/index.tsx',
  'pages/admin/billing/index.tsx',
]

describe('no admin page can reach a tenant’s own data', () => {
  it.each(ADMIN_PAGES)('%s imports no alert or camera module', (page) => {
    const graph = moduleGraph(join(SRC, page))
    const crossings = graph.filter((file) =>
      /[\\/]lib[\\/](alerts|cameras)[\\/]/.test(file),
    )

    expect(crossings).toEqual([])
  })

  it('the module walker actually finds things, so an empty result means something', () => {
    // Guards the test itself: a resolver that silently found nothing would make
    // every assertion above pass for the wrong reason.
    const graph = moduleGraph(join(SRC, 'pages/admin/system-health/index.tsx'))
    expect(graph.length).toBeGreaterThan(10)
    expect(graph.some((f) => /lib[\\/]health[\\/]api/.test(f))).toBe(true)
    expect(graph.some((f) => /lib[\\/]tenants[\\/]api/.test(f))).toBe(true)
  })

  it('an org page does cross into alerts, proving the check can fail', () => {
    // The counterexample. If this ever comes back empty, the pattern above has
    // stopped matching anything and the whole file is decorative.
    const graph = moduleGraph(join(SRC, 'pages/org/analytics/index.tsx'))
    expect(graph.some((f) => /lib[\\/]alerts[\\/]/.test(f))).toBe(true)
  })
})

describe('the platform data layer offers no way in', () => {
  it('exports no reader for cameras, alerts, clips or impersonation', () => {
    const suspicious = /camera|alert|clip|footage|zone|stream|impersonat|viewAs/i

    expect(Object.keys(tenantsApi).filter((key) => suspicious.test(key))).toEqual([])
    expect(Object.keys(healthApi).filter((key) => suspicious.test(key))).toEqual([])
    expect(Object.keys(billingApi).filter((key) => suspicious.test(key))).toEqual([])
  })
})

describe('nothing a tenant owns reaches the screen', () => {
  let rendered = ''

  beforeAll(async () => {
    signIn(SUPER_ADMIN)

    const [summary, list, detail, health, ledger] = await Promise.all([
      tenantsApi.getPlatformSummary(),
      tenantsApi.listTenants(),
      tenantsApi.getTenant('ten_castleford'),
      healthApi.getPlatformHealth(),
      billingApi.getBillingLedger(),
    ])
    if (!summary.ok || !list.ok || !detail.ok || !health.ok || !ledger.ok) {
      throw new Error('unavailable')
    }

    const seed = (client: QueryClient) => {
      client.setQueryData(SUMMARY_KEY, summary.summary)
      client.setQueryData(TENANTS_KEY, list.tenants)
      client.setQueryData(tenantKey('ten_castleford'), detail.tenant)
      client.setQueryData(HEALTH_KEY, health.health)
      client.setQueryData(BILLING_KEY, ledger.ledger)
    }

    rendered = [
      renderPage(<AdminOverviewPage />, { seed }),
      renderPage(<AdminTenantsPage />, { seed }),
      renderPage(<AdminSystemHealthPage />, { seed }),
      renderPage(<AdminBillingPage />, { seed }),
      renderPage(<AdminTenantDetailPage />, {
        path: '/admin/tenants/ten_castleford',
        route: '/admin/tenants/:id',
        seed,
      }),
    ]
      .map((view) => view.html())
      .join('\n')
  })

  it('actually rendered the pages, so an absence means something', () => {
    /*
     * Every assertion below is an absence, and absences pass trivially against
     * an empty string. A permission gate returning early, or a page throwing
     * into an error boundary, would silently turn this whole block green.
     */
    expect(rendered.length).toBeGreaterThan(20_000)
    expect(rendered).toContain('Castleford Works')
    expect(rendered).toContain('Edge Agent connectivity')
  })

  // The camera and zone names the org-side mocks use. If one of these ever
  // appears on a platform page, a tenant's estate has been rendered to somebody
  // who does not own it.
  it.each([
    'Main entrance',
    'Loading bay',
    'West corridor',
    'Car park',
    'Front of house',
    'ALR-',
    'handgun',
    'altercation',
  ])('no tenant content on screen: %s', (leak) => {
    expect(rendered).not.toContain(leak)
  })

  it.each(['/org/', '/alerts', '/cameras'])(
    'no link into a tenant’s own area: %s',
    (route) => {
      expect(rendered).not.toContain(route)
    },
  )

  it.each(['View as', 'Impersonate', 'Sign in as'])(
    'no impersonation control: %s',
    (control) => {
      // Deferred deliberately, not forgotten. A super admin borrowing an org's
      // session would undo the area isolation the routing model is built on.
      expect(rendered).not.toContain(control)
    },
  )
})
