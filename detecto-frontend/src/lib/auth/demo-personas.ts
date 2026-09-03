/**
 * Hackathon demo accounts. The sign-in page offers a button per role so
 * judges can open each surface without typing a password.
 *
 * Emails match the mock's local-part convention (`super@`, `admin@`, …) and
 * the rows `detecto-backend/db/seed.js` inserts for the real API.
 */
export type DemoPersona = {
  id: string
  label: string
  blurb: string
  email: string
  recommended?: boolean
}

export const DEMO_PERSONAS: DemoPersona[] = [
  {
    id: 'admin',
    label: 'Org admin',
    blurb: 'Northgate. Cameras, people, alerts, billing.',
    email: 'admin@northgate.example',
    recommended: true,
  },
  {
    id: 'super',
    label: 'Platform admin',
    blurb: 'Detecto staff. Tenants, billing, module flags.',
    email: 'super@northgate.example',
  },
  {
    id: 'member',
    label: 'Operator',
    blurb: 'Confirms alerts and watches cameras.',
    email: 'member@northgate.example',
  },
  {
    id: 'viewer',
    label: 'Viewer',
    blurb: 'Cameras only. Cannot confirm an alert.',
    email: 'viewer@northgate.example',
  },
  {
    id: 'nobody',
    label: 'No access',
    blurb: 'Signed in, granted nothing yet.',
    email: 'nobody@northgate.example',
  },
]

export function demoPassword() {
  // Same password the real API seed uses. Mock login also accepts this so
  // the one-click buttons work whether VITE_USE_MOCKS is on or off.
  return 'detecto-test-password'
}
