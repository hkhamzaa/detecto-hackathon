import { readFileSync } from 'node:fs'
import { dirname, join, resolve as resolvePath } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'

import type { Camera } from '@/lib/cameras/api'
import { CAMERAS_KEY } from '@/lib/cameras/queries'
import * as subscriptionApi from '@/lib/subscription/api'
import { SUBSCRIPTION_KEY } from '@/lib/subscription/queries'
import type { Claims } from '@/lib/auth/claims'
import OrgBillingPage from '@/pages/org/billing'
import { renderPage, signIn } from '@/test/harness'

/**
 * The other direction of the standing rule, as a test.
 *
 * `pages/admin/boundary.test.tsx` checks that no platform page can reach a
 * customer's cameras. This checks the mirror: that a customer's own billing
 * page cannot reach the platform's view of every account. The two billing pages
 * look alike and are about the same subject, which is exactly why one of them
 * importing the other's data layer would be an easy commit to wave through.
 *
 * The import-graph check is the one that matters. A page cannot leak what it
 * cannot import, and this fails the build on the commit that adds the import —
 * before anybody has to notice it on screen.
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

const ORG_BILLING = 'pages/org/billing/index.tsx'
const ADMIN_BILLING = 'pages/admin/billing/index.tsx'

describe('neither billing page can reach the other', () => {
  it('the org page pulls in no platform data layer', () => {
    const graph = moduleGraph(join(SRC, ORG_BILLING))
    const crossings = graph.filter((file) =>
      /[\\/]lib[\\/](tenants|billing|health|module-flags)[\\/]/.test(file),
    )

    expect(crossings).toEqual([])
  })

  it('the platform page pulls in no org subscription module', () => {
    // The same rule in the other direction. `/admin/billing` reads revenue
    // across every account; it has no business holding one customer's own.
    const graph = moduleGraph(join(SRC, ADMIN_BILLING))
    const crossings = graph.filter((file) => /[\\/]lib[\\/]subscription[\\/]/.test(file))

    expect(crossings).toEqual([])
  })

  it('the module walker actually finds things, so an empty result means something', () => {
    // Guards the test itself: a resolver that silently found nothing would make
    // both assertions above pass for the wrong reason.
    const graph = moduleGraph(join(SRC, ORG_BILLING))

    expect(graph.length).toBeGreaterThan(10)
    expect(graph.some((f) => /lib[\\/]subscription[\\/]api/.test(f))).toBe(true)
    expect(graph.some((f) => /lib[\\/]cameras[\\/]queries/.test(f))).toBe(true)
  })

  it('shares the invoice shape through a neutral module, not through an area', () => {
    // The one thing the two areas agree on lives outside both of them, which is
    // what let the import ban above stay absolute.
    const graph = moduleGraph(join(SRC, ORG_BILLING))
    expect(graph.some((f) => /lib[\\/]invoice/.test(f))).toBe(true)

    const admin = moduleGraph(join(SRC, 'pages/admin/tenants/detail.tsx'))
    expect(admin.some((f) => /lib[\\/]invoice/.test(f))).toBe(true)
  })
})

describe('the subscription module offers no way out of this organisation', () => {
  it('exports no reader for tenants, other accounts or the platform', () => {
    const suspicious = /tenant|org(s|Id)|account(s)?\b|platform|admin|customer/i

    expect(Object.keys(subscriptionApi).filter((key) => suspicious.test(key))).toEqual([])
  })
})

describe('nothing beyond this organisation reaches the screen', () => {
  let rendered = ''

  beforeAll(async () => {
    const claims: Claims = {
      sub: 'usr_admin',
      email: 'admin@northgate.com',
      role: 'org_admin',
      permissions: ['billing:manage'],
      orgId: 'org_northgate',
      exp: Math.floor(Date.now() / 1000) + 900,
    }
    signIn(claims)

    const result = await subscriptionApi.getSubscription()
    if (!result.ok) throw new Error(result.code)

    const cameras: Camera[] = [
      { id: 'cam_1', name: 'Loading bay', zone: 'Yard', online: true, lastSeen: null, reviewStatus: 'approved', sourceType: 'file' },
    ]

    rendered = renderPage(<OrgBillingPage />, {
      seed: (client) => {
        client.setQueryData(SUBSCRIPTION_KEY, result.subscription)
        client.setQueryData(CAMERAS_KEY, cameras)
      },
    }).html()
  })

  it('actually rendered the page, so an absence means something', () => {
    /*
     * Every assertion below is an absence, and absences pass trivially against
     * an empty string. A permission gate returning early would silently turn
     * this whole block green.
     */
    expect(rendered.length).toBeGreaterThan(8_000)
    expect(rendered).toContain('Site')
    expect(rendered).toContain('Invoices')
  })

  // The names and ids the platform registry is seeded with. If one of these
  // ever appears on a customer's own billing page, another organisation's
  // account has been rendered to somebody who does not own it.
  it.each([
    'Northgate Logistics',
    'Halden Retail Group',
    'Castleford Works',
    'Priory Park School',
    'Okonjo Residence',
    'ten_',
    'castlefordworks',
  ])('no other organisation on screen: %s', (leak) => {
    expect(rendered).not.toContain(leak)
  })

  // Platform-only fields on the tenant record: support context, suspension
  // bookkeeping and the revenue rollup. None of it is a customer's to read.
  it.each([
    'Support note',
    'suspendedAt',
    'Monthly recurring revenue',
    'MRR',
    'Past due',
    'Failed payments',
  ])('no platform-only billing field on screen: %s', (leak) => {
    expect(rendered).not.toContain(leak)
  })

  it.each(['/admin/', '/admin/tenants', '/admin/billing'])(
    'no link into the platform area: %s',
    (route) => {
      expect(rendered).not.toContain(route)
    },
  )
})
