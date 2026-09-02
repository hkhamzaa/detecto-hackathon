/**
 * The alerts table's wire shape, shared between routes/alerts.js (the live
 * queue) and routes/analytics.js (the reporting window over the same rows).
 * One mapping so the two can never quietly disagree about what an Alert
 * looks like on the wire.
 */

export const ALERT_COLUMNS = `
  id, camera_id, camera_name, zone, kind, subtype, confidence,
  detected_at, model, status, decided_by, decided_at, pipeline_status, frame_image
`;

/**
 * DB row -> wire Alert (lib/alerts/api.ts's Alert type), field for field.
 * `pipelineStatus` and `frameImage` are omitted entirely when absent rather
 * than sent as null — matching parseAlert's own reading, where the key's
 * mere presence is the claim being made (see the comment on parseAlert).
 */
export function toWireAlert(row) {
  const alert = {
    id: row.id,
    cameraId: row.camera_id,
    cameraName: row.camera_name,
    zone: row.zone,
    kind: row.kind,
    subtype: row.subtype,
    confidence: row.confidence,
    detectedAt: row.detected_at.toISOString(),
    model: row.model,
    status: row.status,
    decidedBy: row.decided_by,
    decidedAt: row.decided_at ? row.decided_at.toISOString() : null,
  };
  if (row.pipeline_status) alert.pipelineStatus = row.pipeline_status;
  if (row.frame_image) alert.frameImage = row.frame_image;
  return alert;
}
