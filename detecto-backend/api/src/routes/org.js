import { Router } from 'express';

import { pool } from '../db.js';
import { requireActiveOrg, requireAuth, requireOrgScope, requirePermission } from '../middleware/auth.js';
import { actorSnapshot, logAudit } from '../lib/audit.js';

export const orgRouter = Router();

/**
 * Auth/org-scope only at the router level — `requirePermission('org:settings')`
 * is applied per-route below instead, not blanket here. orgRouter,
 * rolesRouter and auditRouter all share the /api/org prefix (see app.js),
 * and Express falls through to the next router mounted at the same prefix
 * when this one has no matching route — but it does NOT skip this
 * router's own `.use()` middleware first. A blanket `requirePermission`
 * here would run (and could reject) a request actually bound for
 * /api/org/audit or /api/org/directory before it ever reached those
 * routers, blocking a real, correctly-permissioned user for a permission
 * their own route doesn't even require. Found via this phase's own
 * testing with a narrowly-scoped role (audit:view only), not something
 * this task set out to fix — see the B7g report for the discovery.
 */
orgRouter.use(requireAuth, requireOrgScope, requireActiveOrg);

const ORG_TYPES = ['Office', 'Retail', 'Warehouse', 'School', 'Other'];
const IDLE_TIMEOUTS = [15, 30, 60];

function toWireSettings(row) {
  return {
    profile: {
      name: row.name,
      type: row.org_type ?? '',
      contactEmail: row.contact_email ?? '',
      contactPhone: row.contact_phone ?? '',
    },
    security: {
      idleTimeoutMinutes: row.idle_timeout_minutes,
    },
  };
}

const SETTINGS_COLUMNS = 'name, org_type, contact_email, contact_phone, idle_timeout_minutes';

orgRouter.get('/settings', requirePermission('org:settings'), async (req, res) => {
  const { rows } = await pool.query(
    `SELECT ${SETTINGS_COLUMNS} FROM organizations WHERE id = $1`,
    [req.claims.orgId],
  );
  // The org in the token was deleted out from under an otherwise-valid
  // session — not reachable in normal operation, but a live JWT outlives
  // the row it names by design (no server-side revocation this pass).
  if (!rows[0]) return res.status(404).json({ error: 'not_found' });
  res.status(200).json(toWireSettings(rows[0]));
});

/**
 * One endpoint, two callers on the frontend (saveOrgProfile/saveOrgSecurity)
 * — both PATCH the same resource, exactly as lib/org/api.ts's realSave()
 * does. This accepts either or both `profile`/`security` in one request.
 *
 * When `profile` is sent, it's the *whole* OrgProfile object — that's what
 * saveOrgProfile(profile: OrgProfile) always passes, never a sub-patch of
 * individual fields — so it's validated and written as a unit rather than
 * merged field-by-field. Same for `security`. Merging field-by-field here
 * would have a sharp edge: a `profile` sent without an explicit `type` key
 * would need to mean *something* (clear it? leave it?), and there's no
 * right answer because the real caller never does that.
 */
orgRouter.patch('/settings', requirePermission('org:settings'), async (req, res) => {
  const { profile, security } = req.body ?? {};
  if (profile === undefined && security === undefined) {
    return res.status(422).json({ error: 'validation_failed', errors: { body: 'Nothing to update.' } });
  }

  const errors = {};
  if (profile !== undefined) {
    if (!String(profile.name ?? '').trim()) errors.name = 'Enter the name your organization operates under.';
    if (profile.type && !ORG_TYPES.includes(profile.type)) errors.type = 'Unrecognized organization type.';
  }
  if (security !== undefined) {
    if (!IDLE_TIMEOUTS.includes(security.idleTimeoutMinutes)) {
      errors.idleTimeoutMinutes = 'Must be 15, 30, or 60.';
    }
  }
  if (Object.keys(errors).length > 0) {
    return res.status(422).json({ error: 'validation_failed', errors });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const before = await client.query(
      `SELECT ${SETTINGS_COLUMNS} FROM organizations WHERE id = $1`,
      [req.claims.orgId],
    );
    if (!before.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'not_found' });
    }

    const { rows } = await client.query(
      `UPDATE organizations SET
         name = CASE WHEN $1::boolean THEN $2 ELSE name END,
         org_type = CASE WHEN $1::boolean THEN NULLIF($3, '') ELSE org_type END,
         contact_email = CASE WHEN $1::boolean THEN $4 ELSE contact_email END,
         contact_phone = CASE WHEN $1::boolean THEN $5 ELSE contact_phone END,
         idle_timeout_minutes = CASE WHEN $6::boolean THEN $7 ELSE idle_timeout_minutes END,
         updated_at = now()
       WHERE id = $8
       RETURNING ${SETTINGS_COLUMNS}`,
      [
        profile !== undefined,
        profile?.name?.trim(),
        profile?.type ?? '',
        profile?.contactEmail?.trim() ?? '',
        profile?.contactPhone?.trim() ?? '',
        security !== undefined,
        security?.idleTimeoutMinutes,
        req.claims.orgId,
      ],
    );
    const settings = rows[0];

    const changes = [];
    if (before.rows[0].name !== settings.name) {
      changes.push(`Renamed from "${before.rows[0].name}" to "${settings.name}".`);
    }
    if (before.rows[0].org_type !== settings.org_type) {
      changes.push(`Organisation type is now ${settings.org_type || 'unset'}.`);
    }
    if (before.rows[0].contact_email !== settings.contact_email) {
      changes.push(`Contact email is now ${settings.contact_email || 'unset'}.`);
    }
    if (before.rows[0].contact_phone !== settings.contact_phone) {
      changes.push(`Contact phone is now ${settings.contact_phone || 'unset'}.`);
    }
    if (before.rows[0].idle_timeout_minutes !== settings.idle_timeout_minutes) {
      changes.push(`Idle timeout is now ${settings.idle_timeout_minutes} minutes.`);
    }

    if (changes.length > 0) {
      const actor = await actorSnapshot(client, req.claims.sub);
      await logAudit(client, {
        orgId: req.claims.orgId,
        actor,
        action: 'org.settings_changed',
        summary: 'Changed organisation settings',
        detail: changes,
      });
    }

    await client.query('COMMIT');
    res.status(200).json(toWireSettings(settings));
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});
