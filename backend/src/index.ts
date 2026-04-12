import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { prisma } from './lib/prisma';
import authRoutes from './routes/auth.routes';
import infrastructureRoutes from './routes/infrastructure.routes';
import inventoryRoutes from './routes/inventory.routes';
import adminRoutes from './routes/admin.routes';
import { hashPassword } from './utils/auth';

dotenv.config();

const app = express();
const port = process.env.PORT || 8000;

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

// Initialize Workers (Disabled for local run without Redis)
// startWarrantyWorker();
// startIntegrationWorker();

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
  res.json({ status: 'ok', engine: 'Node.js' });
});

app.listen(Number(port), '0.0.0.0', async () => {
  console.log(`[server]: Server is running at http://0.0.0.0:${port}`);
  
  // Create first admin if not exists
  const hp = await hashPassword('admin123');
  try {
    await prisma.user.upsert({
      where: { username: 'admin' },
      update: { password: hp, role: 'admin' },
      create: { 
        username: 'admin', 
        password: hp, 
        email: 'admin@inventrops.com', 
        role: 'admin' 
      }
    });
    console.log('[Setup] Default admin user is ready (admin / admin123)');
  } catch (err) {
    // console.log('[Setup] Admin already exists or DB not ready yet');
  }
});

export { app };
