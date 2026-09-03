import { describe, expect, it, vi } from 'vitest'

import type { Camera } from '@/lib/cameras/api'
import { CAMERAS_KEY } from '@/lib/cameras/queries'
import OrgCameraLivePage from '@/pages/org/cameras/live'
import { renderPage, signIn } from '@/test/harness'

vi.mock('@/lib/cameras/live', () => ({
  useDetectionTicks: () => ({
    ticks: [
      {
        cameraId: 'cam_live',
        offsetS: 0,
        startS: 0,
        endS: 2,
        timestamp: '2026-09-03T00:00:00Z',
        classification: 'Normal',
        violence: 0.11,
        weapon: 0.09,
      },
    ],
    connected: true,
    complete: true,
  }),
}))

const CAMERA: Camera = {
  id: 'cam_live',
  name: 'Yard demo',
  zone: 'Demo feed',
  online: true,
  lastSeen: '2026-09-03T00:00:00Z',
  reviewStatus: 'approved',
  sourceType: 'file',
}

function open() {
  signIn({
    sub: 'usr_admin',
    email: 'admin@northgate.example',
    role: 'org_admin',
    permissions: ['cameras:view', 'alerts:view'],
    orgId: 'org_northgate',
    exp: Math.floor(Date.now() / 1000) + 900,
  })
  return renderPage(<OrgCameraLivePage />, {
    path: '/org/cameras/cam_live/live',
    route: '/org/cameras/:id/live',
    seed: (client) => {
      client.setQueryData([...CAMERAS_KEY, 'cam_live'], CAMERA)
    },
  })
}

describe('the demo live page', () => {
  it('plays the uploaded file under an overlay, and still points at the queue', () => {
    const out = open().text()
    expect(out).toContain('Yard demo')
    expect(out).toContain('Open the alert queue')
    expect(out).toContain('Normal')
    expect(out).toContain('Violence 11%')
    expect(out).toContain('Weapon 9%')
    expect(out).toContain('detecto-hackathon-final has analysed this file')
    expect(out).toContain('The two percentages are independent')
  })
})
