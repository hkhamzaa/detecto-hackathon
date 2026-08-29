import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

/**
 * Testing Library only unmounts automatically when Vitest's globals are on, and
 * they are not — tests here import `describe`/`it`/`expect` explicitly, so the
 * imports say where everything comes from. That leaves cleanup to us.
 *
 * Without it, every rendered page stays in the document and the next test's
 * queries match the previous test's markup.
 */
afterEach(cleanup)
