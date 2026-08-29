import { PageHeader } from '@/components/app-shell/page-header'
import { Button } from '@/components/ui/button'
import { Panel, PanelBody } from '@/components/ui/panel'
import { useLogout } from '@/hooks/use-logout'
import { useAuthStore } from '@/store/auth-store'

/**
 * Not an error, and not a dead end to apologise for — an account that exists
 * and has not been given anything to do yet. `landingPathFor` sends people here
 * rather than to a page they would only be bounced out of.
 */
export default function NoAccessPage() {
  const claims = useAuthStore((s) => s.claims)
  const { signOutNow, pending } = useLogout()

  return (
    <>
      <PageHeader
        eyebrow="Access"
        title="Nothing assigned yet"
        lead="Your account is active and signed in. It has not been given access to any cameras or alerts, so there is nothing for Detecto to show you. That is a permissions decision, and it belongs to an administrator in your organisation rather than to us."
      />

      <Panel label="What to do">
        <PanelBody>
          <p className="max-w-2xl text-meta text-neutral-600">
            Ask whoever set up your organisation's Detecto account to assign you
            a site and the permissions you need — usually the ability to view
            cameras, confirm alerts, or both. Give them the account below so they
            can find you.
          </p>

          <dl className="mt-5 grid gap-x-8 gap-y-3 sm:max-w-md sm:grid-cols-2">
            <div>
              <dt className="label-micro text-neutral-500">Account</dt>
              <dd className="mt-1 break-all font-mono text-data text-ink">
                {claims?.email}
              </dd>
            </div>
            <div>
              <dt className="label-micro text-neutral-500">User ID</dt>
              <dd className="mt-1 break-all font-mono text-data text-ink">
                {claims?.sub}
              </dd>
            </div>
          </dl>

          <p className="mt-5 max-w-2xl border-t border-neutral-200 pt-4 text-meta text-neutral-500">
            Permissions are read when you sign in. Once yours have been changed,
            sign out and back in and this page will be replaced by whatever you
            have been given.
          </p>

          <Button
            variant="outline"
            className="mt-5"
            onClick={signOutNow}
            disabled={pending}
          >
            {pending ? 'Signing out…' : 'Sign out'}
          </Button>
        </PanelBody>
      </Panel>
    </>
  )
}
