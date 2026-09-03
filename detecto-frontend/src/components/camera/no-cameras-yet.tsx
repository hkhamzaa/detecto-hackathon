import { Link } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { Panel, PanelBody } from '@/components/ui/panel'
import { DEMO_MODE } from '@/lib/config/demo'

export const CONNECT_PATH = '/org/cameras/connect'

const WHAT_YOU_NEED = [
  'Your Detecto Box plugged in, on the same network as your cameras.',
  "The eight-character code on the box's screen.",
  'About five minutes. You can name each camera as you go.',
]

const DEMO_WHAT_YOU_NEED = [
  'A CCTV-style video file (MP4, WebM, MOV, AVI, or MKV).',
  'The real detection pipeline running on this machine.',
  'A minute or two — the model watches the file the way it would watch a live feed.',
]

const DEFAULT_LEAD =
  'Detecto works with the cameras you already own. Your Detecto Box connects to the recorder or cameras on your network and starts receiving the pictures they already produce — nothing is replaced, and no new cameras need installing.'

const DEMO_DEFAULT_LEAD =
  'Demo mode: upload a video file to simulate a live camera feed. Nothing here is a real camera — Detecto will run the same model and the same alert pipeline against the file you choose.'

/**
 * The one place the product says "you have no cameras yet".
 *
 * For most org admins this is the first screen they see after signing up, so it
 * reads as somewhere to start rather than as an absence. Anything downstream of
 * cameras — modules, and in time history and analytics — has the same actual
 * precondition, so it shows this rather than inventing its own version of the
 * same conversation. Only the opening line changes, to say why *this* page is
 * empty.
 *
 * In demo mode the box-pairing copy is hidden (not deleted): the checklist and
 * CTA point at the file upload on Cameras instead.
 */
export function NoCamerasYet({ lead }: { lead?: string } = {}) {
  const demo = DEMO_MODE
  const opening = demo ? DEMO_DEFAULT_LEAD : (lead ?? DEFAULT_LEAD)
  const items = demo ? DEMO_WHAT_YOU_NEED : WHAT_YOU_NEED

  return (
    <Panel label="No cameras yet">
      <PanelBody>
        <p className="max-w-2xl text-body text-neutral-700">{opening}</p>

        <h3 className="label-micro mt-8 text-neutral-500">What you'll need</h3>
        <ul className="mt-4 max-w-2xl space-y-2.5">
          {items.map((item) => (
            <li key={item} className="flex gap-3 text-meta text-neutral-600">
              <span aria-hidden="true" className="mt-2 size-1 shrink-0 bg-neutral-400" />
              <span>{item}</span>
            </li>
          ))}
        </ul>

        <Button asChild size="lg" className="mt-8">
          {demo ? (
            <Link to="/org/cameras#demo-upload">Upload a demo video</Link>
          ) : (
            <Link to={CONNECT_PATH}>Connect your cameras</Link>
          )}
        </Button>

        <p className="mt-5 max-w-2xl border-t border-neutral-200 pt-4 text-meta text-neutral-500">
          {demo
            ? 'Uploading a file starts the real detection pipeline. Alerts that the model raises still wait for a human confirmation before anything escalates.'
            : 'Connecting a camera does not switch detection on. That is a separate, deliberate step, and nothing is watched for weapons or violence until you take it.'}
        </p>
      </PanelBody>
    </Panel>
  )
}
