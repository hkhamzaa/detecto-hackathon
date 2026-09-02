/**
 * Writes to audit_log (Phase B1's schema) — the durable record
 * detecto-frontend/src/lib/audit/api.ts's header describes and cannot build
 * itself: written on the server, by the same transaction that performs the
 * action, to an append-only store.
 *
 * `action` must be one of the strings the frontend's closed AUDIT_ACTIONS
 * list (and this table's own audit_log_action_check constraint) already
 * know about — see db/migrations/1788300000000_extend-audit-log-actions.js.
 * Inventing a new one here without adding it to both would either fail the
 * insert outright or silently vanish on read (toEntry() in api.ts drops any
 * action it doesn't recognize).
 */

/**
 * Who did it, captured now rather than read from the JWT: the access token
 * only ever carries the coarse `role` ('org_admin'/'member'/'super_admin')
 * and permission keys, never the person's name or their custom role's own
 * name — and a token can be up to a day old (see config.js's
 * sessionExpiry), so a fresh lookup is also the more honest "what they held
 * right now" than whatever the token happened to say at login.
 *
 * `roleName` is null for a super admin (no org, no custom role) or for a
 * user whose role was deleted out from under them (role_id NULL) — both
 * real states, not missing data.
 */
export async function actorSnapshot(client, userId) {
  const { rows } = await client.query(
    `SELECT u.name, r.name AS role_name FROM users u LEFT JOIN roles r ON r.id = u.role_id WHERE u.id = $1`,
    [userId],
  );
  const row = rows[0];
  return { id: userId, name: row?.name ?? null, roleName: row?.role_name ?? null };
}

/**
 * `client` is whatever the caller is already using for the action itself
 * (a pool client mid-transaction, or the pool directly for a route that
 * isn't transactional) — never a connection of its own, so a route that
 * wraps its mutation in BEGIN/COMMIT gets the audit row committed or rolled
 * back atomically with the action it describes, per the header note above.
 */
export async function logAudit(client, { orgId, actor, action, summary, detail = [], alertId = null }) {
  await client.query(
    `INSERT INTO audit_log (org_id, actor_id, actor_name, actor_role_name, action, summary, detail, alert_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [orgId, actor.id, actor.name, actor.roleName, action, summary, detail, alertId],
  );
}

/** `cameras:view` etc. -> `cameras view`. Plain-words fallback for permission keys in audit detail text. */
export function humanizePermission(key) {
  return key.replace(/[:_]/g, ' ');
}

/** Matches lib/roles/permissions.ts's summarisePermissions register, without importing frontend TS. */
export function summarizePermissionsPlain(permissions) {
  if (permissions.length === 0) return 'Nothing yet. Nobody holding this role can see anything.';
  return `Can ${permissions.map(humanizePermission).join(', ')}.`;
}

/** Matches lib/roles/permissions.ts's summariseScope register. */
export function summarizeScopePlain(zones) {
  if (zones === null) return 'All cameras.';
  if (zones.length === 0) return 'No zones — this role reaches no cameras.';
  return `${zones.join(', ')} only.`;
}
