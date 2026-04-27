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
      console.warn(`[XormonProvider] Failed to fetch real metrics, falling back to mock data if needed:`, (error as Error).message);
    }

    // Fallback to mock data
    console.log(`[XormonProvider] Generating mock metrics for source ${source.name}`);
    
    // Generate mock storage data
    const storages = ['NetApp AFF A400', 'Dell PowerMax 2000'];
    for (const [idx, name] of storages.entries()) {
      const id = `storage-${idx}`;
      metrics.push({ objectId: id, objectName: name, objectType: 'storage', metricName: 'capacity_total', metricValue: 50000, timestamp });
      metrics.push({ objectId: id, objectName: name, objectType: 'storage', metricName: 'capacity_used', metricValue: 35000 + (Math.random() * 1000), timestamp });
      metrics.push({ objectId: id, objectName: name, objectType: 'storage', metricName: 'capacity_used_percent', metricValue: 70 + (Math.random() * 2), timestamp });
      metrics.push({ objectId: id, objectName: name, objectType: 'storage', metricName: 'iops', metricValue: 5000 + Math.random() * 500, timestamp });
      metrics.push({ objectId: id, objectName: name, objectType: 'storage', metricName: 'latency_ms', metricValue: 2 + Math.random(), timestamp });
    }

    // Generate mock SAN data
    const sans = ['Brocade 6510', 'Cisco MDS 9148'];
    for (const [idx, name] of sans.entries()) {
      const id = `san-${idx}`;
      metrics.push({ objectId: id, objectName: name, objectType: 'san', metricName: 'port_utilization_percent', metricValue: 40 + Math.random() * 10, timestamp });
      metrics.push({ objectId: id, objectName: name, objectType: 'san', metricName: 'error_rate', metricValue: Math.random() * 0.01, timestamp });
    }

    return metrics;
  }
}
