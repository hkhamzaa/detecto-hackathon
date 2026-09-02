import { Router } from 'express';

import { pool } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { hashPassword, verifyPassword } from '../lib/passwords.js';
import { isEmail, passwordIssue } from '../lib/validation.js';
import { actorSnapshot, logAudit } from '../lib/audit.js';

export const accountRouter = Router();

/**
 * `requireAuth` only — never `requireOrgScope` or `requirePermission`. See
 * lib/account/api.ts's own header: "No function here takes a person id, an
 * org id, or any other handle." A super admin has no org (`req.claims.orgId`
 * is null for one) and still has to be able to reach their own account, so
 * gating this on org scope would lock every platform account out of it.
 * Identity comes entirely from `req.claims.sub` — never a path param, never
 * the request body — which is what stops this module from growing into "edit
 * somebody else's account" (that's `users:manage`, in roles.js, on purpose).
 */
accountRouter.use(requireAuth);

function toWireAccount(row) {
  return { id: row.id, name: row.name, email: row.email };
}

/* -------------------------------------------------------------------------- */
/* GET /api/account                                                           */
/* -------------------------------------------------------------------------- */

accountRouter.get('/', async (req, res) => {
  const { rows } = await pool.query('SELECT id, name, email FROM users WHERE id = $1', [
    req.claims.sub,
  ]);
  // Not a real-world 404: a valid, freshly-verified token whose subject has
  // since vanished. Reported the same as any other reachability failure
  // rather than invented a code lib/account/api.ts's AccountResult has no
  // branch for.
  if (!rows[0]) return res.status(503).json({ error: 'unavailable' });
  res.status(200).json(toWireAccount(rows[0]));
});

/* -------------------------------------------------------------------------- */
/* PATCH /api/account                                                         */
/* -------------------------------------------------------------------------- */

accountRouter.patch('/', async (req, res) => {
  const { name, email } = req.body ?? {};
  const errors = {};
  if (typeof name !== 'string' || !name.trim()) errors.name = 'Enter your name.';
  if (typeof email !== 'string' || !isEmail(email)) {
    errors.email = 'This needs an @ and a domain, like name@company.com.';
  }
  if (Object.keys(errors).length > 0) {
    return res.status(422).json({ error: 'validation_failed', errors });
  }

  const trimmedName = name.trim();
  const trimmedEmail = email.trim();

  const existing = await pool.query(
    'SELECT 1 FROM users WHERE lower(email) = lower($1) AND id <> $2',
    [trimmedEmail, req.claims.sub],
  );
  if (existing.rows.length > 0) return res.status(409).json({ error: 'email_taken' });

  const { rows } = await pool.query(
    `UPDATE users SET name = $1, email = $2, updated_at = now() WHERE id = $3
     RETURNING id, name, email`,
    [trimmedName, trimmedEmail, req.claims.sub],
  );
  // Not audited: a display-name/contact-email edit has no precedent action
  // to extend into (see the account-actions migration's own note) and is
  // materially lower stakes than the one mutation in this file that is —
  // changing the password below.
  res.status(200).json(toWireAccount(rows[0]));
});

/* -------------------------------------------------------------------------- */
/* POST /api/account/password                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Changing your own password, while signed in — distinct from the
 * reset-link flow in auth.js: this one proves you know the current
 * password rather than that you own an inbox, which is what stops an
 * unattended, still-signed-in machine from becoming a permanent takeover.
 */
accountRouter.post('/password', async (req, res) => {
  const { currentPassword, newPassword } = req.body ?? {};
  if (typeof currentPassword !== 'string' || typeof newPassword !== 'string') {
    return res.status(400).json({ error: 'currentPassword and newPassword are required' });
  }

  const { rows } = await pool.query('SELECT password_hash FROM users WHERE id = $1', [
    req.claims.sub,
  ]);
  const user = rows[0];
  const currentOk = user ? await verifyPassword(user.password_hash, currentPassword) : false;
  if (!currentOk) return res.status(401).json({ error: 'wrong_password' });

  const weak = passwordIssue(newPassword);
  if (weak) return res.status(422).json({ error: 'weak_password', message: weak });

  const passwordHash = await hashPassword(newPassword);
  await pool.query('UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2', [
    passwordHash,
    req.claims.sub,
  ]);

  // Deliberately NOT revoking other sessions here, even though
  // revokeAllForUser exists and lib/account/api.ts's own realChangePassword()
  // sends credentials so the backend "can, if it chooses to." The rendered
  // page (pages/account/password.tsx) makes a specific, unhedged promise on
  // success: "anywhere else you were already signed in stays signed in,
  // because Detecto has no record of your other sessions to end." That copy
  // is what a person actually reads, and it is the more binding contract
  // than a comment in a transport module — revoking here would make it a
  // lie the moment a real backend existed to check it against. If that
  // product decision changes, the fix is both here and in that page's copy
  // together, not one without the other.
  //
  // audit_log.org_id is NOT NULL and a super admin has no org — same gap
  // auth.js's /login and /logout already leave alone, for the same reason.
  if (req.claims.orgId) {
    const actor = await actorSnapshot(pool, req.claims.sub);
    await logAudit(pool, {
      orgId: req.claims.orgId,
      actor,
      action: 'auth.password_changed',
      summary: 'Changed their own password',
      detail: [],
    });
  }

  res.status(200).json({ ok: true });
});
