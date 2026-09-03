import { useId, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Upload } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Panel, PanelBody } from '@/components/ui/panel'
import { MAX_DEMO_UPLOAD_BYTES } from '@/lib/config/demo'
import { useUploadDemoVideo } from '@/lib/cameras/queries'

const ACCEPT = '.mp4,.webm,.mov,.avi,.mkv,.m4v,video/*'

function stem(filename: string) {
  return filename.replace(/\.[^.]+$/, '').trim()
}

function sizeLabel(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Demo-only: pick a CCTV-style video file, create a real camera, and start
 * the real inference pipeline against it. Copy is deliberately honest — this
 * is a simulated feed, not a camera Detecto is plugged into.
 */
export function DemoUploadPanel() {
  const [file, setFile] = useState<File | null>(null)
  const [name, setName] = useState('')
  const [zone, setZone] = useState('Demo feed')
  const [error, setError] = useState<string | null>(null)
  const upload = useUploadDemoVideo()
  const fileId = useId()

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)

    if (!file) {
      setError('Choose a video file first.')
      return
    }
    if (file.size > MAX_DEMO_UPLOAD_BYTES) {
      setError(`That file is ${sizeLabel(file.size)}. The limit is ${sizeLabel(MAX_DEMO_UPLOAD_BYTES)}.`)
      return
    }

    try {
      await upload.mutateAsync({
        file,
        name: name.trim() || stem(file.name) || undefined,
        zone: zone.trim() || undefined,
      })
    } catch (caught) {
      setError(messageFor(caught))
    }
  }

  const done = upload.isSuccess ? upload.data : null

  return (
    <div id="demo-upload">
      <Panel
        label="Demo feed"
        tone={done?.pipelineStarted ? 'confirm' : 'neutral'}
        className="mb-6"
      >
      <PanelBody>
        <p className="max-w-2xl text-body text-neutral-700">
          Demo mode: upload a video file to simulate a live camera feed. Detecto
          will analyse it with detecto-hackathon-final — the same model as the
          rest of this demo — then Watch live shows those scores on the current
          moment. This is not a live camera.
        </p>

        {done ? (
          <div className="mt-6 max-w-2xl rounded-md border border-neutral-200 bg-paper-sunken px-5 py-5">
            <p role="status" className="text-body text-neutral-700">
              {done.pipelineStarted
                ? `detecto-hackathon-final is analysing ${done.camera.name}. Open Watch live and play the file — the bar is that model’s score for the current time.`
                : `${done.camera.name} was saved, but detection did not start. The pipeline server is not reachable — start detecto-backend/server and upload again.`}
            </p>
            {done.pipelineStarted && (
              <div className="mt-5 flex flex-wrap gap-3">
                <Button asChild>
                  <Link to={`/org/cameras/${done.camera.id}/live`}>Watch live</Link>
                </Button>
                <Button asChild variant="outline">
                  <Link to="/org/alerts">Watch the alert queue</Link>
                </Button>
              </div>
            )}
            <Button
              type="button"
              variant="outline"
              className="mt-5 sm:ml-3"
              onClick={() => {
                upload.reset()
                setFile(null)
                setName('')
                setError(null)
              }}
            >
              Upload another file
            </Button>
          </div>
        ) : (
          <form onSubmit={(event) => void onSubmit(event)} className="mt-6 max-w-xl space-y-5">
            <div className="grid gap-2">
              <label htmlFor={fileId} className="text-meta font-medium text-ink">
                Video file
              </label>
              <Input
                id={fileId}
                type="file"
                accept={ACCEPT}
                className="cursor-pointer py-1.5 file:mr-3 file:rounded-md file:border-0 file:bg-ink file:px-3 file:py-1.5 file:text-meta file:font-medium file:text-paper"
                onChange={(event) => {
                  const next = event.target.files?.[0] ?? null
                  setFile(next)
                  setError(null)
                  if (next && !name.trim()) setName(stem(next.name).slice(0, 48))
                }}
              />
              <p className="text-meta text-neutral-500">
                MP4, WebM, MOV, AVI, or MKV. Up to {sizeLabel(MAX_DEMO_UPLOAD_BYTES)}.
                The clip plays in real time; when it ends, detection on this camera
                stops.
              </p>
            </div>

            <Field label="Camera name" optional hint="Shown on alerts. Defaults to the file name.">
              {(props) => (
                <Input
                  {...props}
                  value={name}
                  maxLength={48}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Yard camera"
                />
              )}
            </Field>

            <Field label="Zone" optional hint="Where this simulated camera sits in the site.">
              {(props) => (
                <Input
                  {...props}
                  value={zone}
                  maxLength={40}
                  onChange={(event) => setZone(event.target.value)}
                  placeholder="Demo feed"
                />
              )}
            </Field>

            {error && (
              <p role="alert" className="text-meta text-signal-700 dark:text-signal-300">
                {error}
              </p>
            )}

            <Button type="submit" size="lg" disabled={upload.isPending || !file}>
              <Upload />
              {upload.isPending ? 'Starting detection…' : 'Run detection on this file'}
            </Button>
          </form>
        )}
      </PanelBody>
      </Panel>
    </div>
  )
}

function messageFor(caught: unknown): string {
  if (typeof caught !== 'object' || caught === null) {
    return "Couldn't upload. Try again."
  }
  const code = 'code' in caught ? String(caught.code) : ''
  if (code === 'too_large') return `That file is over ${sizeLabel(MAX_DEMO_UPLOAD_BYTES)}.`
  if (code === 'validation_failed' && 'message' in caught && typeof caught.message === 'string') {
    return caught.message
  }
  if (code === 'unavailable') {
    return "Couldn't reach Detecto. Check the API is running, then try again."
  }
  return "Couldn't upload. Try again."
}
