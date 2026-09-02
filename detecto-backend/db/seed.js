// Minimal seed: enough to manually verify the schema, not full mock-data
// parity with the frontend. Two parts:
//
//   1. Catalogue data — plans and detection modules. These are fixed,
//      platform-authored lists (lib/plans.ts, lib/modules/catalogue.ts),
//      not test data, but nothing else can seed without them: an
//      organization needs a plan_id to reference, and camera_modules
//      needs modules to point at.
//   2. One test organization, one test user (its default Admin role,
//      holding every permission — matching the seed lib/roles/api.ts
//      builds for a brand new org), and two test cameras.
//
// Safe to re-run: every insert is keyed and upserts on conflict.
import 'dotenv/config';
import pg from 'pg';
import argon2 from 'argon2';

const { Pool } = pg;

// Known credentials for manually exercising the auth API against this seed
// (see detecto-backend/api). Not a secret worth protecting — this is local
// dev seed data, never a real account.
export const TEST_USER_EMAIL = 'admin@northgate.example';
export const TEST_USER_PASSWORD = 'detecto-test-password';
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const PLANS = [
  { id: 'home', name: 'Home', audience: 'home', monthly: 39, maxCameras: 4, maxUsers: 1,
    summary: 'One property, up to four cameras.',
    includes: ['Detecto Box (one-time setup)', 'Weapon and violence detection', 'Up to 4 cameras', 'Alerts on your phone, confirmed by you before anything escalates'] },
  { id: 'home-extended', name: 'Home Extended', audience: 'home', monthly: 69, maxCameras: 12, maxUsers: 3,
    summary: 'Larger property, or more than one building.',
    includes: ['Detecto Box (one-time setup)', 'Weapon and violence detection', 'Up to 12 cameras', 'Up to 3 people on the account', '30-day clip history'] },
  { id: 'team', name: 'Team', audience: 'org', monthly: 180, maxCameras: 16, maxUsers: 10,
    summary: 'A single site with a small security team.',
    includes: ['Detecto Box (one-time setup)', 'Weapon and violence detection', 'Up to 16 cameras', 'Up to 10 people, each with their own permissions', 'Audit trail on every confirmation'] },
  { id: 'site', name: 'Site', audience: 'org', monthly: 420, maxCameras: 48, maxUsers: 40,
    summary: 'A full site, or several buildings under one operation.',
    includes: ['Detecto Box (one-time setup)', 'Weapon and violence detection', 'Up to 48 cameras', 'Up to 40 people, each with their own permissions', 'Audit trail on every confirmation', '90-day clip history'] },
  { id: 'estate', name: 'Estate', audience: 'org', monthly: 960, maxCameras: 120, maxUsers: 200,
    summary: 'Multiple sites under central operations.',
    includes: ['Detecto Box (one-time setup)', 'Weapon and violence detection', 'Up to 120 cameras', 'Up to 200 people, each with their own permissions', 'Audit trail on every confirmation', '90-day clip history', 'Named contact for deployment'] },
];

const MODULES = [
  { id: 'weapon', name: 'Weapon detection', description: 'Firearms and firearm-shaped objects in view of the camera.', status: 'live', falsePositiveRate: 0.04, resourceNote: null, planIds: ['home', 'home-extended', 'team', 'site', 'estate'] },
  { id: 'violence', name: 'Violence detection', description: 'Fights, struggles and sustained physical altercations.', status: 'live', falsePositiveRate: 0.07, resourceNote: 'Heavier than weapon detection. On a box carrying eight or more cameras, flags from this one can take a few seconds longer to arrive.', planIds: ['home-extended', 'team', 'site', 'estate'] },
  { id: 'loitering', name: 'Loitering', description: 'Someone staying in one spot for longer than a place expects.', status: 'coming_soon', falsePositiveRate: null, resourceNote: null, planIds: ['team', 'site', 'estate'] },
  { id: 'zone_intrusion', name: 'Zone intrusion', description: 'Someone entering an area that should be empty, or off-limits at that hour.', status: 'coming_soon', falsePositiveRate: null, resourceNote: null, planIds: ['site', 'estate'] },
  { id: 'theft', name: 'Theft', description: 'Items leaving a space they are not meant to leave.', status: 'coming_soon', falsePositiveRate: null, resourceNote: null, planIds: ['team', 'site', 'estate'] },
  { id: 'forced_movement', name: 'Forced movement', description: 'Someone being pushed, pulled or carried against their own movement.', status: 'coming_soon', falsePositiveRate: null, resourceNote: null, planIds: ['estate'] },
];

async function seedCatalogue(client) {
  for (const plan of PLANS) {
    await client.query(
      `INSERT INTO plans (id, name, audience, monthly, max_cameras, max_users, summary, includes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (id) DO UPDATE SET
         name = excluded.name, audience = excluded.audience, monthly = excluded.monthly,
         max_cameras = excluded.max_cameras, max_users = excluded.max_users,
         summary = excluded.summary, includes = excluded.includes`,
      [plan.id, plan.name, plan.audience, plan.monthly, plan.maxCameras, plan.maxUsers, plan.summary, plan.includes],
    );
  }

  for (const module_ of MODULES) {
    await client.query(
      `INSERT INTO modules (id, name, description, status, false_positive_rate, resource_note, plan_ids, live_since)
       VALUES ($1, $2, $3, $4, $5, $6, $7, CASE WHEN $4 = 'live' THEN now() ELSE NULL END)
       ON CONFLICT (id) DO UPDATE SET
         name = excluded.name, description = excluded.description, status = excluded.status,
         false_positive_rate = excluded.false_positive_rate, resource_note = excluded.resource_note,
         plan_ids = excluded.plan_ids`,
      [module_.id, module_.name, module_.description, module_.status, module_.falsePositiveRate, module_.resourceNote, module_.planIds],
    );
  }
}

async function seedTestOrg(client) {
  // No natural unique key on name at the schema level (an org can rename
  // itself to match another's old name), so re-run safety is a lookup
  // rather than an ON CONFLICT target.
  const existing = await client.query(
    `SELECT id FROM organizations WHERE name = 'Northgate Logistics' LIMIT 1`,
  );

  const orgId = existing.rows[0]?.id ?? (
    await client.query(
      `INSERT INTO organizations (name, org_type, contact_email, contact_phone, account_type, plan_id, status, admin_email)
       VALUES ('Northgate Logistics', 'Warehouse', 'ops@northgate.example', '+1 555 0100', 'org', 'site', 'active', 'admin@northgate.example')
       RETURNING id`,
    )
  ).rows[0].id;

  const role = await client.query(
    `INSERT INTO roles (org_id, name, permissions, zones, is_default)
     SELECT $1, 'Admin', $2, NULL, true
     WHERE NOT EXISTS (SELECT 1 FROM roles WHERE org_id = $1 AND is_default)
     RETURNING id`,
    [orgId, [
      'org:overview', 'cameras:view', 'modules:manage', 'alerts:view', 'alerts:confirm',
      'history:view', 'users:manage', 'analytics:view', 'billing:manage', 'org:settings', 'audit:view',
    ]],
  );
  const roleId = role.rows[0]?.id ?? (
    await client.query(`SELECT id FROM roles WHERE org_id = $1 AND is_default LIMIT 1`, [orgId])
  ).rows[0].id;

  // A real argon2 hash of TEST_USER_PASSWORD, exported above — so this row
  // can actually be logged into through the real auth API, not just read
  // back from the schema.
  const passwordHash = await argon2.hash(TEST_USER_PASSWORD);
  await client.query(
    `INSERT INTO users (org_id, name, email, password_hash, role_id, status)
     VALUES ($1, 'Ada Okafor', $3, $4, $2, 'active')
     ON CONFLICT (lower(email)) DO UPDATE SET password_hash = excluded.password_hash`,
    [orgId, roleId, TEST_USER_EMAIL, passwordHash],
  );

  const cameras = [
    { name: 'Main entrance', zone: 'Front of house' },
    { name: 'Loading bay', zone: 'Yard' },
    // Matches detecto-backend/server's default DETECTO_CAMERA_NAME/
    // DETECTO_ZONE exactly. The pipeline needs a real camera row to attach
    // alerts to (alerts.camera_id is a uuid FK, not the pipeline's own
    // "demo-camera-1" string) — see server/README.md.
    { name: 'Demo camera 1', zone: 'Demo feed' },
  ];
  for (const camera of cameras) {
    await client.query(
      `INSERT INTO cameras (org_id, name, zone, online, address)
       SELECT $1, $2, $3, true, '192.168.1.50'
       WHERE NOT EXISTS (SELECT 1 FROM cameras WHERE org_id = $1 AND name = $2)`,
      [orgId, camera.name, camera.zone],
    );
  }

  const demoCamera = await client.query(
    `SELECT id FROM cameras WHERE org_id = $1 AND name = 'Demo camera 1'`,
    [orgId],
  );

  await seedSubscription(client, orgId);

  return { demoCameraId: demoCamera.rows[0].id };
}

/**
 * A subscriptions row plus six invoices, mirroring
 * detecto-frontend/src/lib/subscription/api.ts's mock seed() exactly (same
 * plan, same six-period history, same "most recent is due, the rest are
 * paid" shape) so GET /api/org/subscription has something real to show
 * instead of an empty history. No pending change — a clean starting state
 * for exercising plan-change/withdraw against.
 */
async function seedSubscription(client, orgId) {
  const MOCK_PERIODS = 6;
  const DAY_MS = 86_400_000;
  const CYCLE_DAYS = 30;
  const monthly = 420; // plans.site.monthly, above

  const now = Date.now();
  const lastClose = now - 4 * DAY_MS;

  await client.query(
    `INSERT INTO subscriptions (org_id, renews_at, billing_email)
     VALUES ($1, $2, $3)
     ON CONFLICT (org_id) DO NOTHING`,
    [orgId, new Date(lastClose + CYCLE_DAYS * DAY_MS), TEST_USER_EMAIL],
  );

  for (let index = 0; index < MOCK_PERIODS; index += 1) {
    const id = `INV-${String(MOCK_PERIODS - index).padStart(4, '0')}`;
    const periodEnd = new Date(lastClose - index * CYCLE_DAYS * DAY_MS);
    // Only the most recent can be outstanding — a gap in the middle of a
    // payment history would be a billing bug, not seed data.
    const status = index === 0 ? 'due' : 'paid';
    await client.query(
      `INSERT INTO invoices (id, org_id, period_end, amount, status)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO NOTHING`,
      [id, orgId, periodEnd, monthly, status],
    );
  }
}

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await seedCatalogue(client);
    const { demoCameraId } = await seedTestOrg(client);
    await client.query('COMMIT');
    console.log('Seed complete.');
    console.log(`Demo camera id (for DETECTO_CAMERA_ID): ${demoCameraId}`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
