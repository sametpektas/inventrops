import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import { prisma } from './lib/prisma';
import authRoutes from './routes/auth.routes';
import infrastructureRoutes from './routes/infrastructure.routes';
import inventoryRoutes from './routes/inventory.routes';
import adminRoutes from './routes/admin.routes';
import forecastRoutes from './routes/forecast.routes';
import aiRoutes from './routes/ai.routes';
import { hashPassword } from './utils/auth';
import { startIntegrationWorker, startIntegrationScheduler } from './workers/integration.worker';
import { startForecastWorker, startForecastScheduler } from './workers/forecast.worker';

dotenv.config();

// FATAL CHECK: Enforce environment variables
if (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'secret' || process.env.JWT_SECRET === 'production_secret_change_me') {
  console.error('FATAL: JWT_SECRET environment variable is NOT set or is insecure! Server refusing to start.');
  process.exit(1);
}

const app = express();
const port = process.env.PORT || 8000;

// Security Middleware
app.use(helmet());
app.use(rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5000, // Limit each IP to 5000 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many requests from this IP, please try again later.',
  skip: (req: any) => req.path === '/api/health' // Don't count healthchecks
}));

// Emergency Admin Setup (Remove in production)
app.get('/api/setup-admin', async (req, res) => {
  const hp = await hashPassword('admin123');
  try {
    const user = await prisma.user.upsert({
      where: { username: 'admin' },
      update: { password: hp, role: 'admin' },
      create: { 
        username: 'admin', 
        password: hp, 
        email: 'admin@inventrops.com', 
        role: 'admin' 
      }
    });
    res.json({ message: 'Admin created/updated', username: user.username });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Workers are initialized inside app.listen() callback below

// Schedule Repeats (Daily at midnight)
// warrantyQueue.add('daily-check', {}, {
//   repeat: { pattern: '0 0 * * *' }
// });

// Schedule Integration Sync (Disabled for local run without Redis)
app.get('/api/admin/integrations/sync-all', async (req, res) => {
  res.status(503).json({ error: 'Redis worker queue not available in local mode.' });
});

app.use(cors());
app.use(express.json());

// Global trailing slash handler (internal rewrite, no redirect to preserve POST body)
app.use((req, res, next) => {
  if (req.path.length > 1 && req.path.endsWith('/')) {
    const newPath = req.path.slice(0, -1);
    const query = req.url.slice(req.path.length);
    req.url = newPath + query;
  }
  next();
});

// Request logging middleware
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url} ${res.statusCode} (${duration}ms)`);
  });
  next();
});

app.use('/api/auth', authRoutes);
app.use('/api/infrastructure', infrastructureRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/forecast', forecastRoutes);
app.use('/api/ai', aiRoutes);

// Root redirect or info
app.get('/', (req, res) => {
  res.json({
    message: 'InvenTrOps API Node.js Engine Active',
    version: '1.0.0-js',
    status: 'Ready'
  });
});

// Basic health check
app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Start server
app.listen(Number(port), '0.0.0.0', () => {
  console.log(`[server]: Server is running at http://0.0.0.0:${port}`);
  
  // Run background initialization without blocking the main event loop
  setImmediate(async () => {
    try {
      // 1. Initial Integration Setup
      startIntegrationWorker();
      await startIntegrationScheduler();
      startForecastWorker();
      await startForecastScheduler();
      
      // 2. Admin User Verification
      const adminExists = await prisma.user.findUnique({ where: { username: 'admin' } });
      if (!adminExists) {
        const hp = await hashPassword('admin123');
        await prisma.user.create({
          data: { 
            username: 'admin', 
            password: hp, 
            email: 'admin@inventrops.com', 
            role: 'admin',
            is_active: true
          }
        });
        console.log('[Setup] Default admin "admin" created.');
      } else if (!adminExists.is_active) {
        await prisma.user.update({
          where: { username: 'admin' },
          data: { is_active: true }
        });
        console.log('[Setup] Admin "admin" activated.');
      }
    } catch (err: any) {
      console.warn(`[Setup] Background initialization warning: ${err.message}`);
    }
  });
});

export { app };
