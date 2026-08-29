import { readFileSync } from 'node:fs'
import { dirname, join, resolve as resolvePath } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'

import * as accountApi from '@/lib/account/api'
import { ACCOUNT_KEY } from '@/lib/account/queries'
import type { Claims } from '@/lib/auth/claims'
import AccountPage from '@/pages/account'
import { renderPage, signIn } from '@/test/harness'

/**
 * The standing rule, in its narrowest form.
 *
 * Everywhere else in the product a boundary separates one *organisation* from
 * another, or the platform from a tenant. This one separates one *person* from
 * everybody else, including their own colleagues: `/account` is the only
 * authenticated page with no permission gate on it, so it is the one page where
 * a stray import would hand an ungated surface something it has no business
 * reading.
 *
 * The import-graph check is the one that matters. A page cannot leak what it
 * cannot import, and this fails the build on the commit that adds the import —
 * before anybody has to notice it on screen.
 */

/** Vitest runs from the project root, so this is stable across platforms. */
const SRC = resolvePath(process.cwd(), 'src')

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

const ACCOUNT_PAGE = 'pages/account/index.tsx'

describe('an ungated page reaches nothing it has not earned', () => {
  it('pulls in no organisation data layer', () => {
    /*
     * `lib/roles` is the sharpest of these: it holds every colleague's record
     * and the operations that change what they can do. This page has no
     * permission gate, so importing it would put the whole directory behind a
     * surface anybody signed in can open.
     */
    const graph = moduleGraph(join(SRC, ACCOUNT_PAGE))
    const crossings = graph.filter((file) =>
      /[\\/]lib[\\/](roles|org|zones|tenants|billing|subscription|health|module-flags|audit|notifications)[\\/]/.test(
        file,
      ),
    )

    expect(crossings).toEqual([])
  })

  it('pulls in no camera or alert module either', () => {
    // Nothing about what this organisation watches belongs on a page about who
    // you are.
    const graph = moduleGraph(join(SRC, ACCOUNT_PAGE))
    expect(
      graph.filter((file) => /[\\/]lib[\\/](alerts|cameras|analytics)[\\/]/.test(file)),
    ).toEqual([])
  })

  it('the module walker actually finds things, so an empty result means something', () => {
    // Guards the test itself: a resolver that silently found nothing would make
    // both assertions above pass for the wrong reason.
    const graph = moduleGraph(join(SRC, ACCOUNT_PAGE))

    expect(graph.length).toBeGreaterThan(8)
    expect(graph.some((f) => /lib[\\/]account[\\/]api/.test(f))).toBe(true)
    expect(graph.some((f) => /pages[\\/]account[\\/]password/.test(f))).toBe(true)
  })

  it('an org settings page does reach the directory, proving the check can fail', () => {
    // The counterexample. If this ever comes back empty, the pattern above has
    // stopped matching anything and the whole file is decorative.
    const graph = moduleGraph(join(SRC, 'pages/org/settings/zones/index.tsx'))
    expect(graph.some((f) => /lib[\\/]roles[\\/]/.test(f))).toBe(true)
  })
})

describe('the account transport offers no way to reach anybody else', () => {
  it('exports nothing that names another person or an organisation', () => {
    const suspicious = /person|people|user(s)?\b|member|org|tenant|directory|role/i
    expect(Object.keys(accountApi).filter((key) => suspicious.test(key))).toEqual([])
  })

  it('takes no id on any function, so there is nothing to point elsewhere', () => {
    /*
     * The identity is the session, never a parameter. `getAccount` takes
     * nothing; `saveAccount` takes the fields; `changePassword` takes two
     * passwords. An endpoint that accepted an id would be an endpoint somebody
     * could pass a different one to.
     */
    expect(accountApi.getAccount).toHaveLength(0)
    expect(accountApi.saveAccount).toHaveLength(1)
    expect(accountApi.changePassword).toHaveLength(2)
  })

  it('returns only the signed-in person, with nothing about the organisation on it', async () => {
    signIn({
      sub: 'usr_member',
      email: 'rhea.mehta@northgate.com',
      role: 'member',
      permissions: ['alerts:view'],
      orgId: 'org_northgate',
      exp: Math.floor(Date.now() / 1000) + 900,
    } satisfies Claims)

    const result = await accountApi.getAccount()
    if (!result.ok) throw new Error(result.code)

    expect(Object.keys(result.account).sort()).toEqual(['email', 'id', 'name'])
    expect(result.account.id).toBe('usr_member')
    expect(result.account.email).toBe('rhea.mehta@northgate.com')

    // Not even the org id the session carries.
    expect(JSON.stringify(result.account)).not.toContain('org_northgate')
  })
})

describe('nothing but your own account reaches the screen', () => {
  let rendered = ''

  beforeAll(async () => {
    signIn({
      sub: 'usr_member',
      email: 'rhea.mehta@northgate.com',
      role: 'member',
      permissions: ['alerts:view'],
      orgId: 'org_northgate',
      exp: Math.floor(Date.now() / 1000) + 900,
    } satisfies Claims)

    const result = await accountApi.getAccount()
    if (!result.ok) throw new Error(result.code)

    rendered = renderPage(<AccountPage />, {
      seed: (client) => client.setQueryData(ACCOUNT_KEY, result.account),
    }).html()
  })

  it('actually rendered the page, so an absence means something', () => {
    expect(rendered.length).toBeGreaterThan(4_000)
    expect(rendered).toContain('rhea.mehta@northgate.com')
  })

  // Names from the seeded org directory and the platform registry. If one ever
  // appears here, a page anybody can open has rendered somebody else's record.
  it.each([
    'Ade Okafor',
    'Tomas Bergstrom',
    'Joan Whitfield',
    'Northgate Logistics',
    'Castleford Works',
    'usr_admin',
    'ten_',
  ])('no other person or organisation on screen: %s', (leak) => {
    expect(rendered).not.toContain(leak)
  })

  it.each(['/org/users', '/org/settings', '/admin/'])(
    'no link into something this page does not own: %s',
    (route) => {
      expect(rendered).not.toContain(route)
    },
  )
})
