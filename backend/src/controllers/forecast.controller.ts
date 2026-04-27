import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { XormonForecastProvider } from '../services/forecast/providers/xormonForecast.provider';
import { VRopsForecastProvider } from '../services/forecast/providers/vropsForecast.provider';
import { calculateForecast } from '../services/forecast/engine';

export const getForecastSummary = async (req: Request, res: Response) => {
  const { team_id, role } = (req as any).user || {};
  try {
    const where = role === 'admin' ? {} : { source: { team_id } };
    const results = await prisma.forecastResult.findMany({
      where,
      orderBy: { risk_level: 'desc' },
    });
    // Sort logic hack for risk_level
    const riskWeight = { red: 4, orange: 3, yellow: 2, green: 1 };
    results.sort((a, b) => riskWeight[b.risk_level] - riskWeight[a.risk_level]);

    res.json({ results });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch summary' });
  }
};

export const getForecastStorage = async (req: Request, res: Response) => {
  const { team_id, role } = (req as any).user || {};
  try {
    const where = { object_type: 'storage', ...(role !== 'admin' && { source: { team_id } }) };
    const results = await prisma.forecastResult.findMany({ where });
    res.json({ results });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch storage forecast' });
  }
};

export const getForecastSan = async (req: Request, res: Response) => {
  const { team_id, role } = (req as any).user || {};
  try {
    const where = { object_type: 'san', ...(role !== 'admin' && { source: { team_id } }) };
    const results = await prisma.forecastResult.findMany({ where });
    res.json({ results });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch san forecast' });
  }
};

export const getForecastServer = async (req: Request, res: Response) => {
  const { team_id, role } = (req as any).user || {};
  try {
    const where = { object_type: 'server', ...(role !== 'admin' && { source: { team_id } }) };
    const results = await prisma.forecastResult.findMany({ where });
    res.json({ results });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch server forecast' });
  }
};

export const getForecastVirtualization = async (req: Request, res: Response) => {
  const { team_id, role } = (req as any).user || {};
  try {
    const where = { object_type: 'virtualization', ...(role !== 'admin' && { source: { team_id } }) };
    const results = await prisma.forecastResult.findMany({ where });
    res.json({ results });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch virtualization forecast' });
  }
};

export const getForecastHistory = async (req: Request, res: Response) => {
  const objectId = req.params.objectId as string;
  const { team_id, role } = (req as any).user || {};
  try {
    const where = { object_id: objectId, ...(role !== 'admin' && { source: { team_id } }) };
    const snapshots = await prisma.forecastMetricSnapshot.findMany({
      where,
      orderBy: { captured_at: 'asc' }
    });
    res.json({ results: snapshots });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch history' });
  }
};

export const syncForecastData = async (req: Request, res: Response) => {
  // In a real app this would just trigger a BullMQ job. For Phase 2 dev, we can run it synchronously or async.
  try {
    const sources = await prisma.integrationConfig.findMany({ 
      where: { 
        is_active: true,
        integration_type: { in: ['xormon', 'vrops'] }
      } 
    });
    let totalSynced = 0;

    for (const source of sources) {
      const provider = source.integration_type === 'xormon' ? new XormonForecastProvider() : new VRopsForecastProvider();
      const metrics = await provider.collectMetrics(source.id);
      
      for (const m of metrics) {
        await prisma.forecastMetricSnapshot.upsert({
          where: {
            object_id_metric_name_captured_at: {
              object_id: m.objectId,
              metric_name: m.metricName,
              captured_at: m.timestamp
            }
          },
          update: {
            metric_value: m.metricValue,
            object_name: m.objectName,
            object_type: m.objectType
          },
          create: {
            source_id: source.id,
            object_id: m.objectId,
            object_name: m.objectName,
            object_type: m.objectType,
            metric_name: m.metricName,
            metric_value: m.metricValue,
            captured_at: m.timestamp
          }
        });
        totalSynced++;
      }
    }
    res.json({ message: 'Sync complete', totalSynced });
  } catch (error) {
    console.error('[ForecastSync] Error:', error);
    res.status(500).json({ error: 'Sync failed', details: (error as Error).message });
  }
};

export const recalculateForecast = async (req: Request, res: Response) => {
  try {
    const uniqueObjects = await prisma.forecastMetricSnapshot.groupBy({
      by: ['source_id', 'object_id', 'object_name', 'object_type', 'metric_name'],
    });

    let calculatedCount = 0;

    for (const obj of uniqueObjects) {
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
          pred_1y: result.pred_1y,
          pred_2y: result.pred_2y,
          pred_3y: result.pred_3y,
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
          pred_1y: result.pred_1y,
          pred_2y: result.pred_2y,
          pred_3y: result.pred_3y,
          days_to_warning: result.days_to_warning,
          days_to_critical: result.days_to_critical,
          confidence_score: result.confidence_score,
          risk_level: result.risk_level,
        }
      });
      calculatedCount++;
    }

    res.json({ message: 'Recalculation complete', calculatedCount });
  } catch (error) {
    res.status(500).json({ error: 'Recalculation failed', details: (error as Error).message });
  }
};
