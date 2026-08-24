import 'dotenv/config';
import express from 'express';
import cors from 'cors';

import authRoutes from './routes/auth';
import familyRoutes from './routes/families';
import pointsRoutes from './routes/points';
import tasksRoutes from './routes/tasks';
import rewardsRoutes from './routes/rewards';
import adminRoutes from './routes/admin';

const app = express();
const PORT = Number(process.env.PORT) || 3001;

// 支援多個來源：本機開發 + 正式前端網域（逗號分隔）
const corsOrigins = (
  process.env.CORS_ORIGIN || 'http://localhost:5173,http://127.0.0.1:5173'
)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      // 允許無 origin（如 Postman、server-to-server）或在白名單內
      if (!origin || corsOrigins.includes(origin) || corsOrigins.includes('*')) {
        callback(null, true);
      } else {
        const error = new Error('CORS origin not allowed') as Error & {
          status?: number;
        };
        error.status = 403;
        callback(error);
      }
    },
    credentials: true,
  })
);
app.use(express.json());

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', name: 'StarJar API' });
});

app.use('/api/auth', authRoutes);
app.use('/api/families', familyRoutes);
app.use('/api/points', pointsRoutes);
app.use('/api/tasks', tasksRoutes);
app.use('/api/rewards', rewardsRoutes);
app.use('/api/admin', adminRoutes);

// 404
app.use((_req, res) => {
  res.status(404).json({ error: '找不到此 API' });
});

// Error handler
app.use(
  (
    err: Error & { status?: number },
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    console.error(err);
    res.status(err.status ?? 500).json({
      error: err.status === 403 ? '不允許的來源' : '伺服器錯誤',
    });
  }
);

app.listen(PORT, '0.0.0.0', () => {
  console.log(`StarJar API running on port ${PORT}`);
});
