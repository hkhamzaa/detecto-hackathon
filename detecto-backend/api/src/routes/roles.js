import { Router } from 'express';

import { pool } from '../db.js';
import { requireActiveOrg, requireAuth, requireOrgScope, requirePermission } from '../middleware/auth.js';
import { ALL_PERMISSION_KEYS } from '../lib/permissions.js';
import { isUuid } from '../lib/validation.js';
import { actorSnapshot, logAudit, summarizePermissionsPlain, summarizeScopePlain } from '../lib/audit.js';

export const rolesRouter = Router();

// requirePermission('users:manage') is applied per-route below, not blanket
// here — see the matching comment in org.js for why: this router shares
// the /api/org prefix with orgRouter and auditRouter, and a router-level
// permission check runs for every request reaching this router regardless
// of whether one of its own routes ends up matching.
rolesRouter.use(requireAuth, requireOrgScope, requireActiveOrg);

rolesRouter.param('id', (req, res, next, id) => {
  if (!isUuid(id)) return res.status(404).json({ error: 'not_found' });
  next();
});

function toWireRole(row) {
  return {
    id: row.id,
    name: row.name,
    permissions: row.permissions,
    zones: row.zones,
    isDefault: row.is_default,
  };
}

function toWirePerson(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    roleId: row.role_id,
    status: row.status,
    invitedAt: row.invited_at ? row.invited_at.toISOString() : null,
  };
}

/**
 * GET /api/org/directory — the real contract for "list roles": the mock
 * has no roles-only endpoint, getDirectory() returns roles and people
 * together as one call, and this matches that rather than inventing a
 * narrower one the frontend will never call.
 */
rolesRouter.get('/directory', requirePermission('users:manage'), async (req, res) => {
  const [roles, people] = await Promise.all([
    pool.query(
      `SELECT id, name, permissions, zones, is_default FROM roles WHERE org_id = $1 ORDER BY name`,
      [req.claims.orgId],
    ),
    pool.query(
      `SELECT id, name, email, role_id, status, invited_at FROM users WHERE org_id = $1 ORDER BY name`,
      [req.claims.orgId],
    ),
  ]);
  res.status(200).json({
    roles: roles.rows.map(toWireRole),
    people: people.rows.map(toWirePerson),
  });
});

/** Drops unrecognized keys rather than rejecting — matches mockSaveRole's knownPermissions(). */
function knownPermissions(value) {
  return Array.isArray(value) ? value.filter((key) => ALL_PERMISSION_KEYS.includes(key)) : [];
}

function roleDraftErrors(body) {
  const errors = {};
  if (!String(body?.name ?? '').trim()) errors.name = 'Enter a name for this role.';
  if (body?.zones !== null && body?.zones !== undefined && !Array.isArray(body.zones)) {
    errors.zones = 'zones must be an array or null.';
  }
  return errors;
}

async function insertOrUpdateRole(req, res, { id }) {
  const errors = roleDraftErrors(req.body);
  if (Object.keys(errors).length > 0) {
    return res.status(422).json({ error: 'validation_failed', errors });
  }

  const name = String(req.body.name).trim();
  const permissions = knownPermissions(req.body.permissions);
  const zones = Array.isArray(req.body.zones) ? req.body.zones : null;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const before = id
      ? await client.query(`SELECT name, permissions, zones FROM roles WHERE id = $1 AND org_id = $2`, [id, req.claims.orgId])
      : null;
    if (id && !before.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'not_found' });
    }

    const { rows } = id
      ? await client.query(
          `UPDATE roles SET name = $1, permissions = $2, zones = $3, updated_at = now()
           WHERE id = $4 AND org_id = $5
           RETURNING id, name, permissions, zones, is_default`,
          [name, permissions, zones, id, req.claims.orgId],
        )
      : await client.query(
          // is_default is never client-settable — always false here. Only
          // signup (detecto-api's /api/auth/signup) creates a default role.
          `INSERT INTO roles (org_id, name, permissions, zones, is_default)
           VALUES ($1, $2, $3, $4, false)
           RETURNING id, name, permissions, zones, is_default`,
          [req.claims.orgId, name, permissions, zones],
        );
    const role = rows[0];

    const actor = await actorSnapshot(client, req.claims.sub);
    if (id) {
      const changes = [];
      if (before.rows[0].name !== role.name) {
        changes.push(`Renamed from "${before.rows[0].name}" to "${role.name}".`);
      }
      changes.push(summarizePermissionsPlain(role.permissions));
      changes.push(summarizeScopePlain(role.zones));
      await logAudit(client, {
        orgId: req.claims.orgId,
        actor,
        action: 'role.edited',
        summary: `Edited the role ${role.name}`,
        detail: changes,
      });
    } else {
      await logAudit(client, {
        orgId: req.claims.orgId,
        actor,
        action: 'role.created',
        summary: `Created the role ${role.name}`,
        detail: [summarizePermissionsPlain(role.permissions), summarizeScopePlain(role.zones)],
      });
    }

    await client.query('COMMIT');
    res.status(id ? 200 : 201).json(toWireRole(role));
  } catch (err) {
    await client.query('ROLLBACK');
    // roles_org_id_lower_name_key — case-insensitive per-org uniqueness,
    // enforced at the DB level since Phase B1.
    if (err.code === '23505') return res.status(409).json({ error: 'duplicate_name' });
    throw err;
  } finally {
    client.release();
  }
}

rolesRouter.post('/roles', requirePermission('users:manage'), (req, res) => insertOrUpdateRole(req, res, { id: null }));
rolesRouter.put('/roles/:id', requirePermission('users:manage'), (req, res) => insertOrUpdateRole(req, res, { id: req.params.id }));

/**
 * DELETE /api/org/roles/:id — body: `{ disposition }`, matching
 * deleteRole()'s real contract exactly. `disposition` is required, not
 * optional: `{kind:'unassign'}` sets every holder's role_id to NULL (they
 * keep their account, see nothing until given a new one — same state as
 * an invite nobody has assigned a role to yet), `{kind:'reassign',
 * roleId}` moves them onto a named role instead. There is no third path
 * that deletes a role in use without saying what happens to its holders —
 * silent orphaning was never a state the mock's own DeleteResult type
 * could even express, and this route doesn't invent one either.
 *
 * The default role can never be deleted (`protected_role`, 409) — it's
 * the one holding `users:manage`, and an org that deleted it would have
 * no route back into managing its own roles at all.
 */
rolesRouter.delete('/roles/:id', requirePermission('users:manage'), async (req, res) => {
  const disposition = req.body?.disposition;
  const validDisposition =
    disposition?.kind === 'unassign' ||
    (disposition?.kind === 'reassign' && isUuid(disposition.roleId));
  if (!validDisposition) {
    return res.status(422).json({
      error: 'validation_failed',
      errors: { disposition: "disposition must be {kind:'unassign'} or {kind:'reassign', roleId}." },
    });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const before = await client.query(
      `SELECT name, is_default FROM roles WHERE id = $1 AND org_id = $2`,
      [req.params.id, req.claims.orgId],
    );
    if (!before.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'not_found' });
    }
    if (before.rows[0].is_default) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'protected_role' });
    }

    let nextRoleId = null;
    if (disposition.kind === 'reassign') {
      // The target role must be real, in this org, and not the role being
      // deleted — reassigning a role onto itself would be deleting it
      // while claiming its holders kept it.
      const target = await client.query(
        `SELECT 1 FROM roles WHERE id = $1 AND org_id = $2 AND id <> $3`,
        [disposition.roleId, req.claims.orgId, req.params.id],
      );
      if (!target.rows[0]) {
        await client.query('ROLLBACK');
        return res.status(422).json({
          error: 'validation_failed',
          errors: { disposition: 'roleId must name a different, existing role in this organisation.' },
        });
      }
      nextRoleId = disposition.roleId;
    }

    const moved = await client.query(
      `UPDATE users SET role_id = $1, updated_at = now() WHERE role_id = $2 AND org_id = $3`,
      [nextRoleId, req.params.id, req.claims.orgId],
    );

    await client.query(`DELETE FROM roles WHERE id = $1 AND org_id = $2`, [req.params.id, req.claims.orgId]);

    const actor = await actorSnapshot(client, req.claims.sub);
    const roleName = before.rows[0].name;
    await logAudit(client, {
      orgId: req.claims.orgId,
      actor,
      action: 'role.deleted',
      summary: `Deleted the role ${roleName}`,
      detail: [
        moved.rowCount === 0
          ? 'Nobody was holding this role.'
          : disposition.kind === 'unassign'
            ? `${moved.rowCount} ${moved.rowCount === 1 ? 'person' : 'people'} lost access until given a new role.`
            : `${moved.rowCount} ${moved.rowCount === 1 ? 'person' : 'people'} moved to another role.`,
      ],
    });

    await client.query('COMMIT');
    res.status(200).json({ moved: moved.rowCount });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});
