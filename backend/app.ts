// Index: routes: /api/health:26,30 | /api/attendance:37 | /api/ai:38 | /api/auth:39 | /api/fingerprint:40 | /api/admin:41
import express from 'express';
import attendanceRouter from './modules/attendance.js';
import aiRouter from './modules/ai.js';
import authRouter from './modules/auth.js';
import fingerprintRouter from './modules/fingerprint.js';
import adminRouter from './modules/admin.js';

const app = express();

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin) {
    res.header('Access-Control-Allow-Origin', origin);
  }
  res.header('Access-Control-Allow-Headers', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }

  next();
});

app.use(express.json({ limit: '20mb' }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.head('/api/health', (_req, res) => {
  res.sendStatus(200);
});

app.get('/', (_req, res) => {
  res.send('Examination Attendance System Backend');
});

app.use('/api/attendance', attendanceRouter);
app.use('/api/ai', aiRouter);
app.use('/api/auth', authRouter);
app.use('/api/fingerprint', fingerprintRouter);
app.use('/api/admin', adminRouter);

export default app;
