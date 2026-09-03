import { config } from '../config.js';

/**
 * Talks to detecto-backend/server's existing POST/DELETE /pipelines.
 *
 * This is not a second way to spawn inference. The Python server already
 * owns subprocess lifetime (see server/app.py); this module is only the
 * Node side of that same internal-key call, used after a demo upload has
 * written a real camera row.
 */

const PIPELINE_TIMEOUT_MS = 10_000;

function headers() {
  return {
    'Content-Type': 'application/json',
    'X-Internal-Api-Key': config.internalApiKey,
  };
}

export async function stopPipeline(cameraId) {
  const response = await fetch(
    `${config.pipelineUrl}/pipelines/${encodeURIComponent(cameraId)}`,
    {
      method: 'DELETE',
      headers: headers(),
      signal: AbortSignal.timeout(PIPELINE_TIMEOUT_MS),
    },
  );
  if (response.status === 404) return false;
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`pipeline stop failed (${response.status}): ${text.slice(0, 200)}`);
  }
  return true;
}

export async function launchPipeline(camera, { retryOnExists = true } = {}) {
  const response = await fetch(`${config.pipelineUrl}/pipelines`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      id: camera.id,
      name: camera.name,
      zone: camera.zone,
      sourceType: 'file',
      video: camera.sourceUri,
      // Score the file as fast as the machine can, then Watch live looks up
      // each moment by timestamp. Wall-clock pacing left the overlay showing
      // an old window on a later frame — percentages that looked random.
      realtime: false,
      weaponDetector: false,
      frameImage: true,
      model: 'detecto-hackathon-final',
    }),
    signal: AbortSignal.timeout(PIPELINE_TIMEOUT_MS),
  });

  if (response.status === 409 && retryOnExists) {
    await stopPipeline(camera.id);
    return launchPipeline(camera, { retryOnExists: false });
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    const error = new Error(
      `pipeline launch failed (${response.status}): ${text.slice(0, 200)}`,
    );
    error.status = response.status;
    throw error;
  }

  return response.json();
}
