import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { Router } from 'express';
import multer from 'multer';

import { config } from '../config.js';
import { pool } from '../db.js';
import { requireActiveOrg, requireAuth, requireOrgScope, requirePermission } from '../middleware/auth.js';
import { isUuid } from '../lib/validation.js';
import { actorSnapshot, logAudit } from '../lib/audit.js';
import { launchPipeline } from '../lib/pipeline.js';

export const camerasRouter = Router();

camerasRouter.use((req, res, next) => {
  // <video> cannot send an Authorization header. This one GET accepts the
  // same access token as a query param so the browser can range-request the
  // file. Restricted to the video path so it does not widen any other route.
  const isVideo =
    (req.method === 'GET' || req.method === 'HEAD') &&
    /\/[0-9a-fA-F-]{36}\/video\/?$/.test(req.path);
  if (isVideo && typeof req.query.access_token === 'string' && !req.headers.authorization) {
    req.headers.authorization = `Bearer ${req.query.access_token}`;
  }
  next();
});
camerasRouter.use(requireAuth, requireOrgScope, requireActiveOrg);

camerasRouter.param('id', (req, res, next, id) => {
  if (!isUuid(id)) return res.status(404).json({ error: 'not_found' });
  next();
});

/**
 * No `cameras:manage` permission exists in the frontend's catalogue —
 * lib/roles/permissions.ts says so outright, camera admin was never gated
 * by more than "being in the org area at all." `cameras:view` is used as
 * the gate for mutations too, as the closest real stand-in; a future
 * `cameras:manage` key would replace this on both routes below.
 */
const CAN_MUTATE = requirePermission('cameras:view');

/**
 * `online`/`lastSeen` for a box-paired camera are no longer the stored
 * columns — both are derived from the box's own `last_seen_at`, the instant
 * `POST /api/boxes/:id/heartbeat` last touched (see boxes.js). Same
 * 10-minute staleness threshold as admin-health.js's `SILENT_AFTER_MS` and
 * admin-tenants.js's `SILENT_AFTER` — one platform-wide "still talking"
 * definition, not a fourth independently-tuned one. Deriving `lastSeen` too,
 * not just `online`, matters: an `online: true` camera whose `lastSeen`
 * stayed frozen at whatever the stored column happened to hold (null, for
 * every camera today — see the Step 1 report) would read as self-
 * contradictory to anyone looking at it.
 *
 * A camera with no box (`box_id IS NULL` — every camera today) keeps the
 * plain stored `online`/`last_seen`, exactly as before this change: no live
 * signal exists for it, so nothing here claims one.
 */
const CAMERA_SELECT = `
  SELECT
    c.id, c.name, c.zone, c.review_status, c.source_type,
    CASE WHEN c.box_id IS NULL THEN c.last_seen ELSE b.last_seen_at END AS last_seen,
    CASE
      WHEN c.box_id IS NULL THEN c.online
      ELSE b.last_seen_at IS NOT NULL AND b.last_seen_at >= now() - interval '10 minutes'
    END AS online
  FROM cameras c
  LEFT JOIN boxes b ON b.id = c.box_id
`;

/**
 * `reviewStatus` and `sourceType` are both now consumed by the frontend's
 * `Camera` type (lib/cameras/api.ts) — see the Step 1 report on camera
 * status honesty. `sourceType` in particular is what lets the UI tell
 * "never configured" apart from "configured but not currently sending a
 * picture": an `online: false` row with `sourceType: 'unconfigured'` is not
 * the same fact as an `online: false` row with `sourceType: 'rtsp'`, and
 * collapsing them into one boolean was exactly the honesty gap this closes.
 */
function toWireCamera(row) {
  return {
    id: row.id,
    name: row.name,
    zone: row.zone,
    online: row.online,
    lastSeen: row.last_seen ? row.last_seen.toISOString() : null,
    reviewStatus: row.review_status,
    sourceType: row.source_type,
  };
}

camerasRouter.get('/', requirePermission('cameras:view'), async (req, res) => {
  const { rows } = await pool.query(
    `${CAMERA_SELECT} WHERE c.org_id = $1 ORDER BY c.name`,
    [req.claims.orgId],
  );
  res.status(200).json({ cameras: rows.map(toWireCamera) });
});

/**
 * POST /api/cameras — body: {cameras: NewCamera[]}, matching addCameras()'s
 * real contract exactly (batch, not single — a create of one camera is just
 * an array of length 1).
 *
 * `discoveredId` can't currently resolve to anything: box discovery is
 * ephemeral and was never persisted even in the B1 schema design, and no
 * discovery endpoint exists yet (that's later, alongside the box-pairing
 * flow). It's still accepted for wire compatibility, but no longer decides
 * `online` — see below. `boxId` is always stored null until a real
 * discovery/pairing flow exists.
 *
 * `online` is NOT client-settable, here or anywhere else. Every new camera
 * is created `online: false, source_type: 'unconfigured'` regardless of
 * what the request body claims — a row in this table is not "live" just
 * because a client said so at creation time. `online` becomes true only
 * once something derives it from a genuine live signal (a heartbeat from an
 * actual source) — not built yet; see the Step 1 report. Until then, an
 * honest `false` is strictly better than a claimed `true` nothing backs.
 */
camerasRouter.post('/', CAN_MUTATE, async (req, res) => {
  const cameras = req.body?.cameras;
  if (!Array.isArray(cameras) || cameras.length === 0) {
    return res.status(422).json({ error: 'validation_failed', errors: { cameras: 'At least one camera is required.' } });
  }

  const errors = {};
  cameras.forEach((camera, index) => {
    if (!camera || typeof camera !== 'object') {
      errors[index] = 'Invalid camera.';
      return;
    }
    if (!String(camera.name ?? '').trim()) errors[index] = 'name is required.';
    else if (!String(camera.zone ?? '').trim()) errors[index] = 'zone is required.';
  });
  if (Object.keys(errors).length > 0) {
    return res.status(422).json({ error: 'validation_failed', errors });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const created = [];
    for (const camera of cameras) {
      const { rows } = await client.query(
        `INSERT INTO cameras (org_id, name, zone, online, last_seen, address, source_type)
         VALUES ($1, $2, $3, false, NULL, $4, 'unconfigured')
         RETURNING id, name, zone, online, last_seen, review_status, source_type`,
        [
          req.claims.orgId,
          String(camera.name).trim(),
          String(camera.zone).trim(),
          camera.address ? String(camera.address).trim() : null,
        ],
      );
      created.push(toWireCamera(rows[0]));
    }

    const actor = await actorSnapshot(client, req.claims.sub);
    await logAudit(client, {
      orgId: req.claims.orgId,
      actor,
      action: 'camera.added',
      summary:
        created.length === 1
          ? `Added the camera ${created[0].name}`
          : `Added ${created.length} cameras: ${created.map((c) => c.name).join(', ')}`,
      detail: created.map((c) => `${c.name} to ${c.zone}.`),
    });

    await client.query('COMMIT');
    res.status(201).json({ cameras: created });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

const VIDEO_EXTENSIONS = new Set(['.mp4', '.webm', '.mov', '.avi', '.mkv', '.m4v']);
const VIDEO_MIME = new Set([
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'video/x-msvideo',
  'video/avi',
  'video/x-matroska',
  'video/mkv',
  'application/octet-stream',
]);
const NAME_MAX = 48;
const ZONE_MAX = 40;

function ensureUploadDir() {
  fs.mkdirSync(config.uploadDir, { recursive: true });
}

const demoUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      try {
        ensureUploadDir();
        cb(null, config.uploadDir);
      } catch (err) {
        cb(err);
      }
    },
    filename: (_req, file, cb) => {
      const ext = VIDEO_EXTENSIONS.has(path.extname(file.originalname).toLowerCase())
        ? path.extname(file.originalname).toLowerCase()
        : '.mp4';
      cb(null, `${randomUUID()}${ext}`);
    },
  }),
  limits: { fileSize: config.maxUploadBytes, files: 1 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const mime = (file.mimetype || '').toLowerCase();
    if (VIDEO_EXTENSIONS.has(ext) && (VIDEO_MIME.has(mime) || mime.startsWith('video/'))) {
      return cb(null, true);
    }
    cb(Object.assign(new Error('unsupported_video_type'), { code: 'unsupported_video_type' }));
  },
});

function demoUploadMiddleware(req, res, next) {
  if (!config.demoMode) return res.status(404).json({ error: 'not_found' });
  demoUpload.single('video')(req, res, (err) => {
    if (!err) return next();
    if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'file_too_large' });
    }
    const unsupported = err.code === 'unsupported_video_type' || err.message === 'unsupported_video_type';
    return res.status(422).json({
      error: 'validation_failed',
      errors: {
        video: unsupported
          ? 'Upload a video file (MP4, WebM, MOV, AVI, or MKV).'
          : 'Could not read the upload.',
      },
    });
  });
}

function demoCameraName(req) {
  const typed = String(req.body?.name ?? '').trim().slice(0, NAME_MAX);
  if (typed) return typed;
  const original = req.file?.originalname ?? '';
  const stem = path.basename(original, path.extname(original)).trim().slice(0, NAME_MAX);
  return stem || 'Demo camera';
}

function demoCameraZone(req) {
  const typed = String(req.body?.zone ?? '').trim().slice(0, ZONE_MAX);
  return typed || 'Demo feed';
}

/**
 * POST /api/cameras/upload — hackathon demo only (config.demoMode).
 *
 * Multipart field `video` plus optional `name` / `zone`. Saves the file,
 * inserts a real camera (`source_type: 'file'`, `source_uri` = absolute
 * path), then calls the existing Python POST /pipelines so the same model
 * and the same Socket.IO path run against it. Nothing here fakes an alert.
 */
camerasRouter.post('/upload', CAN_MUTATE, demoUploadMiddleware, async (req, res) => {
  if (!req.file) {
    return res.status(422).json({
      error: 'validation_failed',
      errors: { video: 'A video file is required.' },
    });
  }

  const savedPath = path.resolve(req.file.path);
  const name = demoCameraName(req);
  const zone = demoCameraZone(req);

  const client = await pool.connect();
  let camera;
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO cameras (org_id, name, zone, online, last_seen, address, source_type, source_uri)
       VALUES ($1, $2, $3, true, now(), NULL, 'file', $4)
       RETURNING id, name, zone, online, last_seen, review_status, source_type`,
      [req.claims.orgId, name, zone, savedPath],
    );
    camera = rows[0];

    await client.query(
      `INSERT INTO camera_modules (camera_id, module_id)
       SELECT $1, id FROM modules WHERE id IN ('weapon', 'violence') AND status = 'live'
       ON CONFLICT (camera_id, module_id) DO NOTHING`,
      [camera.id],
    );

    const actor = await actorSnapshot(client, req.claims.sub);
    await logAudit(client, {
      orgId: req.claims.orgId,
      actor,
      action: 'camera.added',
      summary: `Added the camera ${camera.name}`,
      detail: [`Demo upload: ${camera.name} to ${camera.zone}.`],
    });

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    fs.unlink(savedPath, () => {});
    throw err;
  } finally {
    client.release();
  }

  try {
    const pipeline = await launchPipeline({
      id: camera.id,
      name: camera.name,
      zone: camera.zone,
      sourceUri: savedPath,
    });
    res.status(201).json({ camera: toWireCamera(camera), pipeline });
  } catch (err) {
    console.error('demo upload: pipeline launch failed', err);
    res.status(502).json({
      error: 'pipeline_unavailable',
      camera: toWireCamera(camera),
    });
  }
});

camerasRouter.get('/:id', requirePermission('cameras:view'), async (req, res) => {
  const { rows } = await pool.query(
    `${CAMERA_SELECT} WHERE c.id = $1 AND c.org_id = $2`,
    [req.params.id, req.claims.orgId],
  );
  if (!rows[0]) return res.status(404).json({ error: 'not_found' });
  res.status(200).json(toWireCamera(rows[0]));
});

const VIDEO_CONTENT_TYPE = {
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.m4v': 'video/mp4',
  '.avi': 'video/x-msvideo',
  '.mkv': 'video/x-matroska',
};

/**
 * GET /api/cameras/:id/video — stream the uploaded demo file for <video>.
 *
 * Reuses `cameras.source_uri` written by POST /api/cameras/upload. File
 * cameras only; an RTSP / unconfigured row has nothing to play. Auth is
 * the same JWT as every other camera route (Bearer, or `?access_token=`
 * because a media element cannot attach headers).
 */
camerasRouter.get('/:id/video', requirePermission('cameras:view'), async (req, res) => {
  const { rows } = await pool.query(
    `SELECT source_type, source_uri FROM cameras WHERE id = $1 AND org_id = $2`,
    [req.params.id, req.claims.orgId],
  );
  const camera = rows[0];
  if (!camera) return res.status(404).json({ error: 'not_found' });
  if (camera.source_type !== 'file' || !camera.source_uri) {
    return res.status(404).json({ error: 'no_video' });
  }

  const stored = path.resolve(camera.source_uri);
  if (!fs.existsSync(stored) || !fs.statSync(stored).isFile()) {
    return res.status(404).json({ error: 'no_video' });
  }

  const type = VIDEO_CONTENT_TYPE[path.extname(stored).toLowerCase()] ?? 'application/octet-stream';
  res.setHeader('Content-Type', type);
  res.setHeader('Accept-Ranges', 'bytes');
  res.sendFile(stored);
});

/**
 * GET /api/cameras/:id/detections — the model timeline for Watch live.
 *
 * Written by the Python pipeline next to the uploaded file as it scores
 * each window. Playback looks up the current time in this list; it is not
 * invented in the browser.
 */
camerasRouter.get('/:id/detections', requirePermission('cameras:view'), async (req, res) => {
  const { rows } = await pool.query(
    `SELECT source_type, source_uri FROM cameras WHERE id = $1 AND org_id = $2`,
    [req.params.id, req.claims.orgId],
  );
  const camera = rows[0];
  if (!camera) return res.status(404).json({ error: 'not_found' });
  if (camera.source_type !== 'file' || !camera.source_uri) {
    return res.status(200).json({ complete: false, ticks: [] });
  }

  const stored = path.resolve(camera.source_uri);
  const parsed = path.parse(stored);
  const timeline = path.join(parsed.dir, `${parsed.name}.detections.json`);
  if (!fs.existsSync(timeline)) {
    return res.status(200).json({ complete: false, ticks: [] });
  }

  try {
    const body = JSON.parse(fs.readFileSync(timeline, 'utf8'));
    const ticks = Array.isArray(body.ticks) ? body.ticks : [];
    return res.status(200).json({
      complete: body.complete === true,
      ticks,
    });
  } catch {
    return res.status(200).json({ complete: false, ticks: [] });
  }
});

/**
 * PATCH /api/cameras/:id — not in the mock at all (this task asked for it
 * fresh). `name`/`zone` are editable as before; `online`/`lastSeen` stay
 * device-reported (see CAMERA_SELECT). `reviewStatus` is the one addition
 * for camera auto-registration (see boxes.js's POST /:id/cameras): the
 * ONLY accepted value is `'approved'`, and only as a `'pending' ->
 * 'approved'` transition — no route anywhere lets a client set `'pending'`
 * directly (only the box-report path does that) or revert an approval.
 * This is deliberately just the data-layer transition; no UI exists yet to
 * call it with (see the Step 1 report on this phase) — a person still has
 * to take some real action, whatever a future UI makes that action be, and
 * this is the one endpoint it will need to call.
 *
 * Deliberately does NOT do the atomic cross-table zone rewrite
 * lib/zones/api.ts's renameZone() does (cameras.zone + roles.zones +
 * notification_routes.target together) — that's a distinct "rename this
 * zone everywhere" operation on a module not in this task's scope. This
 * only moves the one camera to a (possibly new, possibly existing) zone.
 */
camerasRouter.patch('/:id', CAN_MUTATE, async (req, res) => {
  const { name, zone, reviewStatus } = req.body ?? {};
  if (name === undefined && zone === undefined && reviewStatus === undefined) {
    return res.status(422).json({ error: 'validation_failed', errors: { body: 'Nothing to update.' } });
  }
  if (name !== undefined && !String(name).trim()) {
    return res.status(422).json({ error: 'validation_failed', errors: { name: 'name cannot be empty.' } });
  }
  if (zone !== undefined && !String(zone).trim()) {
    return res.status(422).json({ error: 'validation_failed', errors: { zone: 'zone cannot be empty.' } });
  }
  if (reviewStatus !== undefined && reviewStatus !== 'approved') {
    return res.status(422).json({
      error: 'validation_failed',
      errors: { reviewStatus: "the only accepted value is 'approved'." },
    });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const before = await client.query(
      `SELECT name, zone, review_status FROM cameras WHERE id = $1 AND org_id = $2`,
      [req.params.id, req.claims.orgId],
    );
    if (!before.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'not_found' });
    }

    const { rows } = await client.query(
      `UPDATE cameras SET
         name = COALESCE($1, name),
         zone = COALESCE($2, zone),
         review_status = CASE WHEN $3 THEN 'approved' ELSE review_status END,
         updated_at = now()
       WHERE id = $4 AND org_id = $5
       RETURNING id, name, zone, online, last_seen, review_status, source_type`,
      [name?.trim() ?? null, zone?.trim() ?? null, reviewStatus === 'approved', req.params.id, req.claims.orgId],
    );
    const camera = rows[0];

    const changes = [];
    if (name !== undefined && before.rows[0].name !== camera.name) {
      changes.push(`Renamed from "${before.rows[0].name}" to "${camera.name}".`);
    }
    if (zone !== undefined && before.rows[0].zone !== camera.zone) {
      changes.push(`Moved from ${before.rows[0].zone} to ${camera.zone}.`);
    }
    if (reviewStatus === 'approved' && before.rows[0].review_status === 'pending') {
      changes.push('Approved this box-reported camera for use.');
    }

    if (changes.length > 0) {
      const actor = await actorSnapshot(client, req.claims.sub);
      await logAudit(client, {
        orgId: req.claims.orgId,
        actor,
        action: 'camera.updated',
        summary: `Updated the camera ${camera.name}`,
        detail: changes,
      });
    }

    await client.query('COMMIT');
    res.status(200).json(toWireCamera(camera));
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

/**
 * PUT /api/cameras/:id/modules/:moduleId — body: `{ enabled }`, matching
 * setCameraModule()'s real contract. `modules:manage`, not `cameras:view`
 * — this is the org's own modules page mutating what runs on a camera it
 * already owns, gated the same way GET /api/modules already is.
 *
 * `camera_modules` is a presence table: enabling inserts a row, disabling
 * deletes it, `enabled_at` needs no separate tracking beyond the row's own
 * existence. Refused for a module that isn't live in *either* direction —
 * matches lib/modules/api.ts's mockSet() exactly, which checks `isLive`
 * unconditionally before looking at which way `enabled` points.
 *
 * Also refused — `enabled: true` only — for a camera still `review_status:
 * 'pending'` (see boxes.js's POST /:id/cameras). This is the actual
 * enforcement of "not auto-activated into full org use," not just a UI
 * convention: even if some future UI bug (or a direct API call) tried to
 * turn a detection module on for a box-reported camera nobody has reviewed
 * yet, this route refuses it regardless. Disabling a module is never
 * blocked — there's no human-in-the-loop concern in turning something OFF.
 */
camerasRouter.put('/:id/modules/:moduleId', requirePermission('modules:manage'), async (req, res) => {
  const { enabled } = req.body ?? {};
  if (typeof enabled !== 'boolean') {
    return res.status(422).json({ error: 'validation_failed', errors: { enabled: 'enabled must be a boolean.' } });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const camera = await client.query(
      `SELECT id, review_status FROM cameras WHERE id = $1 AND org_id = $2`,
      [req.params.id, req.claims.orgId],
    );
    if (!camera.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'not_found' });
    }
    if (enabled && camera.rows[0].review_status === 'pending') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'pending_review' });
    }

    const module_ = await client.query(`SELECT status FROM modules WHERE id = $1`, [req.params.moduleId]);
    if (!module_.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'not_found' });
    }
    if (module_.rows[0].status !== 'live') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'not_live' });
    }

    if (enabled) {
      await client.query(
        `INSERT INTO camera_modules (camera_id, module_id) VALUES ($1, $2)
         ON CONFLICT (camera_id, module_id) DO NOTHING`,
        [req.params.id, req.params.moduleId],
      );
    } else {
      await client.query(
        `DELETE FROM camera_modules WHERE camera_id = $1 AND module_id = $2`,
        [req.params.id, req.params.moduleId],
      );
    }

    const { rows: enabledRows } = await client.query(
      `SELECT module_id FROM camera_modules WHERE camera_id = $1 ORDER BY module_id`,
      [req.params.id],
    );

    const cameraName = await client.query(`SELECT name FROM cameras WHERE id = $1`, [req.params.id]);
    const moduleName = await client.query(`SELECT name FROM modules WHERE id = $1`, [req.params.moduleId]);
    const actor = await actorSnapshot(client, req.claims.sub);
    await logAudit(client, {
      orgId: req.claims.orgId,
      actor,
      action: enabled ? 'module.enabled' : 'module.disabled',
      summary: `${enabled ? 'Turned on' : 'Turned off'} ${moduleName.rows[0].name} for ${cameraName.rows[0].name}`,
      detail: [],
    });

    await client.query('COMMIT');
    res.status(200).json({ enabled: enabledRows.map((row) => row.module_id) });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});
