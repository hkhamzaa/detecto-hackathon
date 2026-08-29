import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'

import { PageHeader } from '@/components/app-shell/page-header'
import { Button } from '@/components/ui/button'
import { Panel, PanelBody } from '@/components/ui/panel'
import type { DiscoveredCamera, PairedBox } from '@/lib/cameras/api'
import { WizardProgress } from '@/pages/org/cameras/connect/progress'
import { StepDone } from '@/pages/org/cameras/connect/steps/done'
import { StepFind } from '@/pages/org/cameras/connect/steps/find'
import { StepName } from '@/pages/org/cameras/connect/steps/name'
import { StepPair } from '@/pages/org/cameras/connect/steps/pair'

const STEPS = ['Pair the box', 'Find cameras', 'Name and confirm', 'Done']

/**
 * What the box came back with. Held here rather than in the step so that going
 * back to look at the pairing screen does not re-run a two-second search of
 * somebody's network.
 */
export type Discovery =
  | { status: 'found'; cameras: DiscoveredCamera[] }
  | { status: 'failed'; code: 'box_offline' | 'unavailable' }

/** What someone has typed against one discovered camera on the naming step. */
export type CameraRow = { selected: boolean; name: string; zone: string }

/**
 * Four steps, one at a time, holding only what the next step needs.
 *
 * Nothing is persisted. The signup wizard writes to sessionStorage because a
 * customer can refresh mid-checkout and expect to come back; here a refresh
 * drops the access token and ends the session anyway, so storing the flow would
 * only leave something behind that could never be resumed.
 */
export default function ConnectCamerasPage() {
  const [step, setStep] = useState(1)
  const [box, setBox] = useState<PairedBox | null>(null)
  const [discovery, setDiscovery] = useState<Discovery | null>(null)
  // Held here, not in the step: going back to check something and returning
  // must not wipe six names and zones somebody has just typed.
  const [rows, setRows] = useState<Record<string, CameraRow>>({})
  const [added, setAdded] = useState(0)

  const stepRef = useRef<HTMLDivElement>(null)
  const isFirstRender = useRef(true)

  // Move focus to the new step, so the person is not left at the bottom of the
  // screen they just finished. Same pattern as login and signup.
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false
      return
    }
    stepRef.current?.focus()
    window.scrollTo({ top: 0 })
  }, [step])

  const restart = () => {
    setBox(null)
    setDiscovery(null)
    setRows({})
    setAdded(0)
    setStep(1)
  }

  return (
    <>
      <PageHeader
        eyebrow="Organisation · Cameras"
        title="Connect cameras"
        action={
          step < 4 ? (
            <Button asChild variant="ghost">
              <Link to="/org/cameras">Cancel</Link>
            </Button>
          ) : undefined
        }
      />

      {step < 4 && (
        <WizardProgress
          steps={STEPS}
          current={step}
          label="Camera connection progress"
        />
      )}

      <Panel>
        <PanelBody className="sm:px-7 sm:py-7">
          <div
            key={step}
            ref={stepRef}
            tabIndex={-1}
            className="animate-in fade-in outline-none duration-200"
          >
            {step === 1 && (
              <StepPair
                box={box}
                onPaired={(paired) => {
                  // A different box means whatever the last one found is stale,
                  // and so is anything typed against it.
                  if (paired.id !== box?.id) {
                    setDiscovery(null)
                    setRows({})
                  }
                  setBox(paired)
                  setStep(2)
                }}
              />
            )}

            {step === 2 && box && (
              <StepFind
                box={box}
                discovery={discovery}
                onDiscovery={setDiscovery}
                onBack={() => setStep(1)}
                onContinue={() => setStep(3)}
              />
            )}

            {step === 3 && discovery?.status === 'found' && (
              <StepName
                cameras={discovery.cameras}
                rows={rows}
                onRows={setRows}
                onBack={() => setStep(2)}
                onAdded={(count) => {
                  setAdded(count)
                  setStep(4)
                }}
              />
            )}

            {step === 4 && <StepDone count={added} onRestart={restart} />}
          </div>
        </PanelBody>
      </Panel>
    </>
  )
}
