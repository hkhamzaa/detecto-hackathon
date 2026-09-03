import cors from 'cors';
import express from 'express';
import helmet from 'helmet';

import { config } from './config.js';
import { parseCookies } from './middleware/cookies.js';
import { requestMetrics } from './lib/request-metrics.js';
import { createRateLimiter, rateLimitMiddleware } from './lib/rate-limiter.js';
import { verifyToken } from './lib/tokens.js';
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

// Belt-and-suspenders alongside helmet's own removal below — this is a pure
// JSON API, so the header has nothing to advertise either way.
app.disable('x-powered-by');

app.use(
  helmet({
    // A script/style-source CSP protects HTML pages that render markup;
    // this API never serves any — every response is JSON. Leaving the
    // default on would just be dead bytes on every response.
    contentSecurityPolicy: false,
    // The frontend is a deliberately different origin (config.frontendOrigin)
    // calling this API cross-origin. Helmet's default 'same-origin'
    // Cross-Origin-Resource-Policy has browsers block cross-origin reads of
    // the response outright — independent of, and stricter than, the cors()
    // middleware's own allowance below — so it has to be opened up here.
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  }),
);

app.use(cors({ origin: config.frontendOrigin, credentials: true }));
// 256kb: generous headroom over the largest real payload this API accepts
// today (~38KB, PATCH /api/org/settings' full profile+security object) —
// deliberate now, not just whatever body-parser's own default happened to
// allow.
app.use(express.json({ limit: '256kb' }));
app.use(parseCookies);
// Before every route, so GET /api/admin/health's own figures cover the
// whole API, not just itself — see lib/request-metrics.js.
app.use(requestMetrics);

/**
 * A per-authenticated-user backstop, independent of any per-route limiter:
 * a compromised or leaked access token shouldn't be able to hammer any
 * single route — or spread requests across many — past a sane ceiling.
 * Generous enough that no legitimate UI usage should ever come close.
 *
 * Reads the bearer token itself (rather than `req.claims`, which doesn't
 * exist yet at this point in the middleware chain) so it applies uniformly
 * ahead of every router; an invalid/expired token is simply not counted
 * here; requireAuth downstream still 401s it as normal.
 */
const userLimiter = rateLimitMiddleware(
  createRateLimiter({ windowMs: 60 * 1000, max: 200 }),
  (req) => req.claims.sub,
);

app.use((req, res, next) => {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : null;
  if (!token) return next();

  try {
    req.claims = verifyToken(token);
  } catch {
    return next();
  }
  userLimiter(req, res, next);
});

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
  // body-parser's own errors — malformed JSON, or a body over the
  // express.json() limit above — are the caller's fault, not the server's.
  // They already carry the right client-error status; expose it instead of
  // collapsing every error, ours or theirs, into the same 500.
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'invalid_json' });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'payload_too_large' });
  }

  console.error(err);
  res.status(500).json({ error: 'internal_error' });
});
