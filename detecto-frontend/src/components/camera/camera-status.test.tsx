import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { CameraStatus, cameraStatusLabel, cameraTone } from '@/components/camera/camera-status'
import { ReviewStatusBadge } from '@/components/camera/review-status-badge'

/**
 * The four states a camera can honestly be in, and nothing else. Fixtures
 * shaped exactly like what GET /api/cameras actually returns for each case
 * (verified against a real backend: an unconfigured seed camera, a manually
 * marked-down rtsp camera, a box-reported camera mid-review, and a fully
 * approved camera the box is actively heartbeating for) — not invented
 * shapes that happen to compile. See the Step 1 report on camera status
 * honesty for why these four, specifically, must never be ambiguous with
 * each other.
 */
describe('camera status honesty', () => {
  it('never configured reads as neutral "Not configured", not Offline', () => {
    const camera = { online: false, sourceType: 'unconfigured' as const }
    expect(cameraTone(camera)).toBe('neutral')
    expect(cameraStatusLabel(camera)).toBe('Not configured')

    const { container } = render(<CameraStatus camera={camera} />)
    expect(container.textContent).toBe('Not configured')
    expect(container.textContent).not.toContain('Offline')
  })

  it('configured but not sending a picture reads as Signal "Offline"', () => {
    const camera = { online: false, sourceType: 'rtsp' as const }
    expect(cameraTone(camera)).toBe('signal')
    expect(cameraStatusLabel(camera)).toBe('Offline')
  })

  it('pending review can still be genuinely online — the two are independent axes', () => {
    const camera = { online: true, sourceType: 'rtsp' as const, reviewStatus: 'pending' as const }
    expect(cameraTone(camera)).toBe('confirm')
    expect(cameraStatusLabel(camera)).toBe('Online')

    const { container: status } = render(<CameraStatus camera={camera} />)
    expect(status.textContent).toBe('Online')

    const { container: badge } = render(<ReviewStatusBadge camera={camera} />)
    expect(badge.textContent).toContain('Pending review')
  })

  it('approved and online reads as plain Confirm "Online", no badge', () => {
    const camera = { online: true, sourceType: 'file' as const, reviewStatus: 'approved' as const }
    expect(cameraTone(camera)).toBe('confirm')

    const { container: status } = render(<CameraStatus camera={camera} />)
    expect(status.textContent).toBe('Online')

    const { container: badge } = render(<ReviewStatusBadge camera={camera} />)
    expect(badge.textContent).toBe('')
  })

  it('never configured always reads neutral regardless of online (an unconfigured row is never truly online)', () => {
    // Defensive: even a malformed/legacy row claiming online:true with no
    // real source stays neutral rather than flipping to a claimed "Online"
    // nothing backs.
    const camera = { online: true, sourceType: 'unconfigured' as const }
    expect(cameraTone(camera)).toBe('neutral')
    expect(cameraStatusLabel(camera)).toBe('Not configured')
  })
})
