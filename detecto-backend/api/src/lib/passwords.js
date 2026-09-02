import argon2 from 'argon2';

export function hashPassword(password) {
  return argon2.hash(password);
}

export function verifyPassword(hash, password) {
  return argon2.verify(hash, password);
}

/**
 * A real argon2 hash of a value nobody will ever type, computed once at
 * startup rather than per-request — hashing is the expensive half of this,
 * and there is no reason to redo it for every login attempt against an
 * email that doesn't exist.
 *
 * Used so that "email not found" and "email found, password wrong" cost the
 * same amount of server time. Without this, a login attempt against an
 * unregistered email returns as soon as the lookup misses, while one against
 * a real account waits on a hash comparison — and that timing gap is itself
 * an account-enumeration channel, independent of the 401's identical body.
 */
export const dummyHash = await argon2.hash('detecto-dummy-password-for-timing-parity');
