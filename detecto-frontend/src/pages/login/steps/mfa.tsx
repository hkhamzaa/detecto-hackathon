import { Button } from '@/components/ui/button'

/**
 * Seam for the verification-code step.
 *
 * The container, the `LoginStep` union, and the `mfa_required` branch of
 * `LoginResult` are all in place, so adding MFA means replacing the body of
 * this component with the code entry form and calling `signIn` with the token
 * the challenge returns — no restructuring of the page.
 *
 * Until then this is unreachable: the backend contract for the challenge does
 * not exist yet, so nothing returns `mfa_required`. It renders an honest dead
 * end rather than a blank card in case a backend starts sending it early.
 */
export function MfaStep({
  challengeId,
  onBack,
}: {
  challengeId: string | null
  onBack: () => void
}) {
  return (
    <div>
      <h1 className="font-display text-display-md font-medium text-ink">
        Verification required
      </h1>
      <p className="mt-3 text-body text-neutral-600">
        This account asks for a verification code, and that step isn't part of
        this build yet.
      </p>

      {challengeId && (
        <p className="mt-4 font-mono text-data text-neutral-500">
          challenge {challengeId}
        </p>
      )}

      <Button type="button" variant="outline" className="mt-8" onClick={onBack}>
        Back to sign in
      </Button>
    </div>
  )
}
