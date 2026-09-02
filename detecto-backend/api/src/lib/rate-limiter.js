import { config } from '../config.js';

/**
 * In-memory, per-normalized-email failure counter for login.
 *
 * Deliberately keyed by the email string as submitted, not by a user id —
 * an unregistered email locks out on the same schedule as a real one. If
 * the two behaved differently, the lockout itself would tell an attacker
 * which emails are real, undoing the point of the vague 401. This is a
 * single-process in-memory store; a multi-instance deployment would need a
 * shared one (Redis, etc.) to keep that property across instances, but
 * that's out of scope for this pass.
 */
const attempts = new Map();

function keyFor(email) {
  return email.trim().toLowerCase();
}

export function checkLocked(email) {
  const entry = attempts.get(keyFor(email));
  if (!entry) return null;

  const remaining = entry.lockedUntil - Date.now();
  if (remaining <= 0) return null;
  return Math.ceil(remaining / 1000);
}

export function recordFailure(email) {
  const key = keyFor(email);
  const entry = attempts.get(key) ?? { count: 0, lockedUntil: 0 };
  entry.count += 1;
  if (entry.count >= config.login.maxAttempts) {
    entry.lockedUntil = Date.now() + config.login.lockoutSeconds * 1000;
    entry.count = 0;
  }
  attempts.set(key, entry);
}

export function clearFailures(email) {
  attempts.delete(keyFor(email));
}
