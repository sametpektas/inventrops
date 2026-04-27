import { Queue, Worker } from 'bullmq';
import { prisma } from '../lib/prisma';
import { XormonForecastProvider } from '../services/forecast/providers/xormonForecast.provider';
import { VRopsForecastProvider } from '../services/forecast/providers/vropsForecast.provider';
import { calculateForecast } from '../services/forecast/engine';

const connection = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379')
};

export const forecastQueue = new Queue('forecast-jobs', { connection });

export function startForecastWorker() {
  const worker = new Worker('forecast-jobs', async job => {
    if (job.name === 'sync-all') {
      console.log('[Forecast Worker] Starting periodic sync...');
      const sources = await prisma.forecastSource.findMany({ where: { is_active: true } });
      
      for (const source of sources) {
        try {
          const provider = source.source_type === 'xormon' ? new XormonForecastProvider() : new VRopsForecastProvider();
          const metrics = await provider.collectMetrics(source.id);
          
          for (const m of metrics) {
            await prisma.forecastMetricSnapshot.create({
              data: {
                source_id: source.id,
                object_id: m.objectId,
                object_name: m.objectName,
                object_type: m.objectType,
                metric_name: m.metricName,
                metric_value: m.metricValue,
                captured_at: m.timestamp
              }
            });
          }
        } catch (err) {
          console.error(`[Forecast Worker] Error syncing source ${source.id}:`, (err as Error).message);
        }
      }

      // Auto-trigger calculation
      await forecastQueue.add('recalculate-all', {});
    }

    if (job.name === 'recalculate-all') {
      console.log('[Forecast Worker] Starting periodic recalculation...');
      const uniqueObjects = await prisma.forecastMetricSnapshot.groupBy({
        by: ['source_id', 'object_id', 'object_name', 'object_type', 'metric_name'],
      });

      for (const obj of uniqueObjects) {
        try {
          const history = await prisma.forecastMetricSnapshot.findMany({
            where: { object_id: obj.object_id, metric_name: obj.metric_name },
            orderBy: { captured_at: 'asc' }
          });

          const points = history.map(h => ({ date: h.captured_at, value: h.metric_value }));
          
          let warning = 80;
          let critical = 90;
          if (obj.metric_name === 'capacity_total' || obj.metric_name === 'capacity_used' || obj.metric_name === 'iops' || obj.metric_name === 'vm_count') {
              warning = 100000;
              critical = 120000;
          }
          
          const result = calculateForecast(points, warning, critical, 'up');

          await prisma.forecastResult.upsert({
            where: {
              object_id_metric_name: {
                object_id: obj.object_id,
                metric_name: obj.metric_name
              }
            },
            update: {
              current_value: points[points.length - 1]?.value || 0,
              pred_30d: result.pred_30d,
              pred_90d: result.pred_90d,
              pred_180d: result.pred_180d,
              pred_365d: result.pred_365d,
              days_to_warning: result.days_to_warning,
              days_to_critical: result.days_to_critical,
              confidence_score: result.confidence_score,
              risk_level: result.risk_level,
              calculated_at: new Date()
            },
            create: {
              source_id: obj.source_id,
              object_id: obj.object_id,
              object_name: obj.object_name,
              object_type: obj.object_type,
              metric_name: obj.metric_name,
              current_value: points[points.length - 1]?.value || 0,
              pred_30d: result.pred_30d,
              pred_90d: result.pred_90d,
              pred_180d: result.pred_180d,
              pred_365d: result.pred_365d,
              days_to_warning: result.days_to_warning,
              days_to_critical: result.days_to_critical,
              confidence_score: result.confidence_score,
              risk_level: result.risk_level,
            }
          });
        } catch (err) {
          console.error(`[Forecast Worker] Error recalculating obj ${obj.object_id}:`, (err as Error).message);
        }
      }
    }
  }, { connection });

  worker.on('failed', (job, err) => {
    console.error(`[Forecast Worker] Job ${job?.id} failed:`, err);
  });
}

export async function startForecastScheduler() {
  await forecastQueue.add('sync-all', {}, {
    repeat: { pattern: '0 1 * * *' } // Every day at 1 AM
  });
}
