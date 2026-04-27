import axios from 'axios';
import { prisma } from '../../../lib/prisma';
import { NormalizedMetric, ForecastProvider } from './index';

export class XormonForecastProvider implements ForecastProvider {
  async collectMetrics(sourceId: number): Promise<NormalizedMetric[]> {
    const source = await prisma.forecastSource.findUnique({ where: { id: sourceId } });
    if (!source) throw new Error('Source not found');

    const metrics: NormalizedMetric[] = [];
    const timestamp = new Date();

    try {
      // Attempt real API call if properly configured
      if (source.url && source.url !== 'mock://xormon') {
        const response = await axios.get(`${source.url}/api/v1/metrics`, {
          headers: {
            'Authorization': `Bearer ${source.api_key}`,
            'Accept': 'application/json'
          },
          timeout: 10000
        });
        
        // Map real response to NormalizedMetric array here...
        // For brevity and safe handling, we'll assume response.data is an array
        // of { id, name, type, metrics: { [key: string]: number } }
        const data = response.data;
        if (Array.isArray(data)) {
          for (const item of data) {
             for (const [key, value] of Object.entries(item.metrics)) {
                metrics.push({
                   objectId: String(item.id),
                   objectName: String(item.name),
                   objectType: String(item.type),
                   metricName: key,
                   metricValue: Number(value),
                   timestamp
                });
             }
          }
        }
        return metrics;
      }
    } catch (error) {
      console.warn(`[XormonProvider] Failed to fetch real metrics:`, (error as Error).message);
    }

    return metrics;
  }
}
