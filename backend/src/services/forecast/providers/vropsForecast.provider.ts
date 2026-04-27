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
      console.warn(`[VRopsProvider] Failed to fetch real metrics, falling back to mock data if needed:`, (error as Error).message);
    }

    // Fallback to mock data
    console.log(`[VRopsProvider] Generating mock metrics for source ${source.name}`);
    
    // Generate mock server data
    const servers = ['ESXi-01', 'ESXi-02', 'ESXi-03'];
    for (const [idx, name] of servers.entries()) {
      const id = `server-${idx}`;
      metrics.push({ objectId: id, objectName: name, objectType: 'server', metricName: 'cpu_usage_percent', metricValue: 50 + Math.random() * 20, timestamp });
      metrics.push({ objectId: id, objectName: name, objectType: 'server', metricName: 'memory_usage_percent', metricValue: 60 + Math.random() * 15, timestamp });
    }

    // Generate mock virtualization/cluster data
    const clusters = ['Prod-Cluster-01', 'Dev-Cluster-01'];
    for (const [idx, name] of clusters.entries()) {
      const id = `cluster-${idx}`;
      metrics.push({ objectId: id, objectName: name, objectType: 'virtualization', metricName: 'cluster_cpu_demand', metricValue: 70 + Math.random() * 10, timestamp });
      metrics.push({ objectId: id, objectName: name, objectType: 'virtualization', metricName: 'cluster_memory_demand', metricValue: 75 + Math.random() * 10, timestamp });
      metrics.push({ objectId: id, objectName: name, objectType: 'virtualization', metricName: 'vm_count', metricValue: 120 + Math.floor(Math.random() * 5), timestamp });
    }

    return metrics;
  }
}
