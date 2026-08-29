import { describe, expect, it } from 'vitest'

import { APPROACHING, needsSaying, usageFor, usageTone } from '@/lib/subscription/usage'

/**
 * How much of a plan an organisation is using.
 *
 * The property worth protecting is the restraint. This is a customer's own
 * bill, and the temptation on one of those is to make every number feel urgent
 * so somebody upgrades. Only being over a limit is allowed to carry Signal —
 * everything else is a count, and a test that lets a second state creep into
 * Signal is the one that should fail.
 */

describe('states', () => {
  it('says nothing is connected rather than calling zero a usage', () => {
    // A new account is not "0% used", it is an account nobody has set up yet.
    expect(usageFor(0, 48).state).toBe('none')
  })

  it('is quiet well inside the limit', () => {
    expect(usageFor(4, 48).state).toBe('within')
    expect(usageFor(38, 48).state).toBe('within')
  })

  it('speaks up at four-fifths, which is where ordering more starts', () => {
    expect(APPROACHING).toBe(0.8)
    expect(usageFor(39, 48).state).toBe('approaching')
    expect(usageFor(47, 48).state).toBe('approaching')
  })

  it('distinguishes exactly at the limit from inside it', () => {
    // Nothing is wrong at the limit, but the next camera will not fit — which
    // is worth knowing before somebody orders one, and only then.
    expect(usageFor(48, 48).state).toBe('at')
  })

  it('reports being over, which a downgrade can genuinely produce', () => {
    expect(usageFor(52, 48).state).toBe('over')
  })

  it('treats a plan with no limit as unlimited rather than instantly exceeded', () => {
    // Guards the arithmetic: dividing by zero here would make every account on
    // such a plan look over its limit.
    expect(usageFor(12, 0).state).toBe('within')
  })
})

describe('headroom', () => {
  it('counts what is left', () => {
    expect(usageFor(40, 48).remaining).toBe(8)
    expect(usageFor(48, 48).remaining).toBe(0)
  })

  it('goes negative once over, so the page can say by how much', () => {
    expect(usageFor(52, 48).remaining).toBe(-4)
  })
})

describe('tone', () => {
  it('gives Signal to being over the limit and to nothing else', () => {
    // The rule the whole product follows: colour the word only when something
    // needs a person. A page that colours a customer's bill whenever they are
    // busy is a page they stop reading.
    expect(usageTone('over')).toBe('signal')

    for (const state of ['none', 'within', 'approaching', 'at'] as const) {
      expect(usageTone(state)).not.toBe('signal')
    }
  })

  it('leaves a comfortable account reading as fine', () => {
    expect(usageTone('within')).toBe('confirm')
    expect(usageTone('none')).toBe('confirm')
  })
})

describe('what the section bothers to say', () => {
  it('stays quiet when there is nothing to act on', () => {
    expect(needsSaying('within')).toBe(false)
    expect(needsSaying('none')).toBe(false)
  })

  it('explains itself once a limit is in sight', () => {
    for (const state of ['approaching', 'at', 'over'] as const) {
      expect(needsSaying(state)).toBe(true)
    }
  })
})
