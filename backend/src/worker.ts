import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { WorkerEnv } from './lib/worker-prisma';
import authRoutes from './worker-routes/auth';
import familyRoutes from './worker-routes/families';
import pointsRoutes from './worker-routes/points';
import adminRoutes from './worker-routes/admin';
import tasksRoutes from './worker-routes/tasks';
import rewardsRoutes from './worker-routes/rewards';
import scheduledAwardRoutes from './worker-routes/scheduled-awards';
import allowanceRoutes from './worker-routes/allowance';
import reportRoutes from './worker-routes/reports';
import trophyRoutes from './worker-routes/trophies';
import { runScheduledAwards } from './lib/scheduled-awards';

const app = new Hono<{ Bindings: WorkerEnv }>();

app.use('/api/*', async (c, next) => {
  const allowedOrigins = (c.env.CORS_ORIGIN ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  return cors({
    origin: (origin) =>
      allowedOrigins.includes('*') || allowedOrigins.includes(origin)
        ? origin
        : undefined,
    credentials: true,
  })(c, next);
});

// Release switch: block the new schema-dependent endpoints until migration is verified.
app.use('/api/*', async (c,next) => {
  const path=new URL(c.req.url).pathname;
  if(c.env.TASKS_MAINTENANCE==='1' && (/^\/api\/(tasks|reports)(\/|$)/).test(path)) {
    c.header('Retry-After','30');
    return c.json({error:'任務功能正在更新，請稍後重新整理。'},503);
  }
  await next();
});

app.get('/api/health', (c) =>
  c.json({ status: 'ok', name: 'StarJar API', runtime: 'cloudflare-workers', release:'2026-09-07-daily-challenges', tasksMaintenance:c.env.TASKS_MAINTENANCE==='1' })
);

app.route('/api/auth', authRoutes);
app.route('/api/families', familyRoutes);
app.route('/api/points', pointsRoutes);
app.route('/api/admin', adminRoutes);
app.route('/api/tasks', tasksRoutes);
app.route('/api/rewards', rewardsRoutes);
app.route('/api/scheduled-awards', scheduledAwardRoutes);
app.route('/api/allowance', allowanceRoutes);
app.route('/api/reports', reportRoutes);
app.route('/api/trophies', trophyRoutes);

app.notFound((c) => c.json({ error: '找不到此 API' }, 404));

app.onError((error, c) => {
  console.error(error);
  return c.json({ error: '伺服器錯誤' }, 500);
});

export default {
  fetch: app.fetch,
  scheduled: (_event: unknown, env: WorkerEnv, ctx: { waitUntil(promise: Promise<unknown>): void }) => {
    ctx.waitUntil(runScheduledAwards(env));
  },
};
