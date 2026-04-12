import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { prisma } from '../lib/prisma';

const connection = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379/0', {
  maxRetriesPerRequest: null
});

export const warrantyQueue = new Queue('warranty-alerts', { connection });

export const startWarrantyWorker = () => {
  const worker = new Worker('warranty-alerts', async (job) => {
    console.log('[Worker] Checking warranty expiries...');
    
    // Logic from Django check_warranty_expiry
    const today = new Date();
    const thresholds = [
      { days: 365, type: 'WARRANTY_12M' },
      { days: 180, type: 'WARRANTY_6M' }
    ];

    for (const t of thresholds) {
      const windowEnd = new Date(today);
      windowEnd.setDate(today.getDate() + t.days);
      const windowStart = new Date(windowEnd);
      windowStart.setDate(windowEnd.getDate() - 30);

      const items = await prisma.inventoryItem.findMany({
        where: {
          status: 'active',
          warranty_expiry: {
            gte: windowStart,
            lte: windowEnd
          }
        },
        include: { model: { include: { vendor: true } }, team: true }
      });

      for (const item of items) {
        // Here we would send email and log alert
        console.log(`[Alert] Item ${item.serial_number} expiring in ~${t.days} days.`);
      }
    }
  }, { connection });

  worker.on('completed', (job) => {
    console.log(`[Worker] Job ${job.id} completed`);
  });

  worker.on('failed', (job, err) => {
    console.error(`[Worker] Job ${job?.id} failed:`, err);
  });
};
