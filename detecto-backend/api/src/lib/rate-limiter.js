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

/**
 * General-purpose fixed-window limiter: the same "in-memory Map keyed by a
 * caller-chosen string" shape as the login lockout above, generalized for
 * routes that just need a flat "no more than `max` per `windowMs`" ceiling
 * rather than login's escalating lockout. Same single-process caveat as
 * `attempts` above — a multi-instance deployment would need a shared store.
 *
 * Returns a `check(key)` function: `null` if the call is allowed, or the
 * number of seconds until the window resets if it isn't.
 */
export function createRateLimiter({ windowMs, max }) {
  const hits = new Map();

  return function check(key) {
    const now = Date.now();
    const entry = hits.get(key);
    if (!entry || now >= entry.resetAt) {
      hits.set(key, { count: 1, resetAt: now + windowMs });
      return null;
    }
    entry.count += 1;
    if (entry.count > max) {
      return Math.ceil((entry.resetAt - now) / 1000);
    }
    return null;
  };
}

/**
 * Wraps a `createRateLimiter()` checker as Express middleware, matching
 * /login's own 429 shape (`{error: 'rate_limited', retryAfterSeconds}` plus
 * a `Retry-After` header) so every rate-limited route in the API responds
 * identically. `keyFn` derives the bucket key from the request — an IP for
 * unauthenticated routes, an org/user id for authenticated ones.
 */
export function rateLimitMiddleware(limiter, keyFn) {
  return (req, res, next) => {
    const retryAfterSeconds = limiter(keyFn(req));
    if (retryAfterSeconds !== null) {
      res.set('Retry-After', String(retryAfterSeconds));
      return res.status(429).json({ error: 'rate_limited', retryAfterSeconds });
    }
    next();
  };
}
