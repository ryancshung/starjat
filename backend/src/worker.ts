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

app.get('/api/health', (c) =>
  c.json({ status: 'ok', name: 'StarJar API', runtime: 'cloudflare-workers' })
);

app.route('/api/auth', authRoutes);
app.route('/api/families', familyRoutes);
app.route('/api/points', pointsRoutes);
app.route('/api/admin', adminRoutes);
app.route('/api/tasks', tasksRoutes);
app.route('/api/rewards', rewardsRoutes);
app.route('/api/scheduled-awards', scheduledAwardRoutes);

app.notFound((c) => c.json({ error: '找不到此 API' }, 404));

app.onError((error, c) => {
  console.error(error);
  return c.json({ error: '伺服器錯誤' }, 500);
});

export default {
  fetch: app.fetch,
  scheduled: (_event: ScheduledEvent, env: WorkerEnv, ctx: ExecutionContext) => {
    ctx.waitUntil(runScheduledAwards(env));
  },
};
