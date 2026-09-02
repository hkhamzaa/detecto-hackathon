import cors from 'cors';
import express from 'express';

import { config } from './config.js';
import { parseCookies } from './middleware/cookies.js';
import { requestMetrics } from './lib/request-metrics.js';
import { authRouter } from './routes/auth.js';
import { accountRouter } from './routes/account.js';
import { alertsRouter } from './routes/alerts.js';
import { camerasRouter } from './routes/cameras.js';
import { boxesRouter } from './routes/boxes.js';
import { orgRouter } from './routes/org.js';
import { rolesRouter } from './routes/roles.js';
import { auditRouter } from './routes/audit.js';
import { modulesRouter } from './routes/modules.js';
import { analyticsRouter } from './routes/analytics.js';
import { notificationsRouter } from './routes/notifications.js';
import { zonesRouter } from './routes/zones.js';
import { subscriptionRouter } from './routes/subscription.js';
import { adminTenantsRouter } from './routes/admin-tenants.js';
import { adminBillingRouter } from './routes/admin-billing.js';
import { adminHealthRouter } from './routes/admin-health.js';
import { adminModulesRouter } from './routes/admin-modules.js';

export const app = express();

app.use(cors({ origin: config.frontendOrigin, credentials: true }));
app.use(express.json());
app.use(parseCookies);
// Before every route, so GET /api/admin/health's own figures cover the
// whole API, not just itself — see lib/request-metrics.js.
app.use(requestMetrics);

app.use('/api/auth', authRouter);
app.use('/api/account', accountRouter);
app.use('/api/alerts', alertsRouter);
app.use('/api/cameras', camerasRouter);
// boxesRouter defines only /pair — see its own header for why discovery
// (/api/boxes/:id/discover) is deliberately not built alongside it.
app.use('/api/boxes', boxesRouter);
// orgRouter defines /settings; rolesRouter defines /directory and /roles;
// auditRouter defines /audit — all three mount under /api/org, matching
// /api/org/settings, /api/org/directory, /api/org/roles, /api/org/audit
// exactly (the last one per lib/audit/api.ts's realLog(), not the literal
// /api/audit the task description guessed at — see the Step 1 report).
// notificationsRouter defines / and /routes and /escalation under
// /api/org/notifications; zonesRouter defines /rename and /merge under
// /api/org/zones.
app.use('/api/org', orgRouter);
app.use('/api/org', rolesRouter);
app.use('/api/org', auditRouter);
app.use('/api/org/notifications', notificationsRouter);
app.use('/api/org/zones', zonesRouter);
// subscriptionRouter defines / and /plan-change under /api/org/subscription.
app.use('/api/org/subscription', subscriptionRouter);
app.use('/api/modules', modulesRouter);
app.use('/api/analytics', analyticsRouter);
// adminTenantsRouter defines /summary and /tenants(/:id), adminBillingRouter
// defines /billing, adminHealthRouter defines /health, adminModulesRouter
// defines /modules(/:id) — all under /api/admin, all requireSuperAdmin-gated,
// never requireOrgScope. Revenue/MRR itself is not a route: it's arithmetic
// the frontend already does over GET /api/admin/tenants (lib/billing/
// revenue.ts) — see admin-billing.js's own header for why a second endpoint
// re-reading tenant state would reintroduce the "two pages disagree" drift
// risk this split was built to avoid.
app.use('/api/admin', adminTenantsRouter);
app.use('/api/admin', adminBillingRouter);
app.use('/api/admin', adminHealthRouter);
app.use('/api/admin', adminModulesRouter);

app.get('/health', (_req, res) => res.status(200).json({ ok: true }));

// Centralized error handler — routes throw rather than catch-and-500 by
// hand, matching how the pg client rejects on a bad query.
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'internal_error' });
});
