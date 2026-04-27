import axios from 'axios';
import { prisma } from '../../../lib/prisma';
import { NormalizedMetric, ForecastProvider } from './index';

export class VRopsForecastProvider implements ForecastProvider {
  async collectMetrics(sourceId: number): Promise<NormalizedMetric[]> {
    const source = await prisma.forecastSource.findUnique({ where: { id: sourceId } });
    if (!source) throw new Error('Source not found');

    const metrics: NormalizedMetric[] = [];
    const timestamp = new Date();

    try {
      if (source.url && source.url !== 'mock://vrops') {
        const response = await axios.get(`${source.url}/suite-api/api/resources/stats`, {
          headers: {
            'Authorization': `vRealizeOpsToken ${source.api_key}`,
            'Accept': 'application/json'
          },
          timeout: 10000
        });
        
        const data = response.data;
        if (data && Array.isArray(data.resourceList)) {
          for (const item of data.resourceList) {
             const statList = item.statKey || [];
             for (const stat of statList) {
                metrics.push({
                   objectId: String(item.identifier),
                   objectName: String(item.resourceName),
                   objectType: String(item.resourceKind).toLowerCase(),
                   metricName: stat.key,
                   metricValue: Number(stat.value),
                   timestamp
                });
             }
          }
        }
        return metrics;
      }
    } catch (error) {
      console.warn(`[VRopsProvider] Failed to fetch real metrics:`, (error as Error).message);
    }

    return metrics;
  }
}
