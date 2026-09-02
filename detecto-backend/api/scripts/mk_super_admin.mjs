import argon2 from 'argon2';
import pg from 'pg';
import 'dotenv/config';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const email = 'superadmin@detecto.platform';
const password = 'detecto-super-admin-password';
const hash = await argon2.hash(password);

const { rows } = await pool.query(
  `INSERT INTO users (org_id, name, email, password_hash, role_id, status, is_super_admin)
   VALUES (NULL, 'Detecto Platform Admin', $1, $2, NULL, 'active', true)
   ON CONFLICT (lower(email)) DO UPDATE SET password_hash = excluded.password_hash
   RETURNING id, email`,
  [email, hash],
);
console.log('super admin ready:', rows[0], 'password:', password);
await pool.end();
