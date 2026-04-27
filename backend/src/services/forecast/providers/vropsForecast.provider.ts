import axios from 'axios';
import https from 'https';
import { prisma } from '../../../lib/prisma';
import { decrypt } from '../../../utils/crypto';
import { NormalizedMetric, ForecastProvider } from './index';

export class VRopsForecastProvider implements ForecastProvider {
  async collectMetrics(sourceId: number): Promise<NormalizedMetric[]> {
    const source = await prisma.integrationConfig.findUnique({ where: { id: sourceId } });
    if (!source || source.integration_type !== 'vrops') throw new Error('Invalid vROps source');

    const metrics: NormalizedMetric[] = [];
    const timestamp = new Date();

    const client = axios.create({
      baseURL: source.url,
      timeout: 60000,
      httpsAgent: new https.Agent({ rejectUnauthorized: false }),
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' }
    });

    try {
      // Authenticate: vROps 8.x uses token-based auth
      let token = source.api_key ? decrypt(source.api_key) : null;

      if (!token && source.username && source.password) {
        try {
          const authRes = await client.post('/suite-api/api/auth/token/acquire', {
            username: source.username,
            authSource: 'LOCAL',
            password: decrypt(source.password)
          });
          token = authRes.data?.token;
          console.log('[VRopsForecast] Token acquired successfully.');
        } catch (authErr: any) {
          console.error(`[VRopsForecast] Auth failed (${authErr.response?.status}): ${authErr.response?.data?.message || authErr.message}`);
          // Fallback: try basic auth header
          const basicAuth = Buffer.from(`${source.username}:${decrypt(source.password)}`).toString('base64');
          try {
            const testRes = await client.get('/suite-api/api/versions', {
              headers: { 'Authorization': `Basic ${basicAuth}` }
            });
            if (testRes.status === 200) {
              console.log('[VRopsForecast] Basic auth works, using it for requests.');
              token = `BASIC:${basicAuth}`;
            }
          } catch {
            console.error('[VRopsForecast] Basic auth also failed.');
          }
        }
      }

      if (!token) {
        console.warn('[VRopsForecast] No valid token obtained.');
        return metrics;
      }

      // Determine auth header
      const authHeader = token.startsWith('BASIC:')
        ? `Basic ${token.replace('BASIC:', '')}`
        : `vRealizeOpsToken ${token}`;

      const headers = {
        'Authorization': authHeader,
        'Accept': 'application/json'
      };

      // Fetch resources (VMs, Hosts, Clusters, Datastores)
      const resourceKinds = ['VirtualMachine', 'HostSystem', 'ClusterComputeResource', 'Datastore'];

      for (const kind of resourceKinds) {
        try {
          const resResponse = await client.get('/suite-api/api/resources', {
            headers,
            params: { resourceKind: kind, pageSize: 100 }
          });

          const resources = resResponse.data?.resourceList || [];
          console.log(`[VRopsForecast] Found ${resources.length} ${kind} resources.`);

          for (const resource of resources) {
            const resourceId = resource.identifier;
            const resourceName = resource.resourceKey?.name || resource.resourceName || resourceId;
            let objectType = 'server';

            if (kind === 'ClusterComputeResource') objectType = 'virtualization';
            else if (kind === 'Datastore') objectType = 'storage';
            else if (kind === 'VirtualMachine') objectType = 'virtualization';

            // Fetch latest stats for this resource
            try {
              const statKeys = kind === 'Datastore'
                ? ['disk|capacity_usage', 'disk|capacity_contention', 'diskspace|total_capacity', 'diskspace|used_space']
                : ['cpu|usage_average', 'mem|usage_average', 'cpu|demandPct', 'mem|host_demand'];

              let statsRes;
              try {
                statsRes = await client.post(
                  `/suite-api/api/resources/${resourceId}/stats/latest`,
                  { resourceId: [resourceId], statKey: statKeys },
                  { headers }
                );
              } catch (err: any) {
                // If 403 Forbidden with token, try fallback to Basic Auth for this specific request
                if (err.response?.status === 403 && source.username && source.password) {
                  const basicAuth = Buffer.from(`${source.username}:${decrypt(source.password)}`).toString('base64');
                  statsRes = await client.post(
                    `/suite-api/api/resources/${resourceId}/stats/latest`,
                    { resourceId: [resourceId], statKey: statKeys },
                    { headers: { ...headers, 'Authorization': `Basic ${basicAuth}` } }
                  );
                } else {
                  throw err;
                }
              }

              const statList = statsRes.data?.values || statsRes.data?.stat || [];

              for (const stat of statList) {
                const key = stat.statKey?.key || stat.key;
                const dataPoints = stat['stat-list']?.stat || stat.data || [];
                const latestValue = Array.isArray(dataPoints) && dataPoints.length > 0
                  ? dataPoints[dataPoints.length - 1]?.data || dataPoints[dataPoints.length - 1]
                  : null;

                if (key && latestValue !== null && latestValue !== undefined) {
                  // Normalize metric name
                  let metricName = key.replace(/\|/g, '_');
                  let finalValue = Number(latestValue);

                  if (metricName.includes('cpu_usage')) metricName = 'cpu_usage_percent';
                  else if (metricName.includes('mem_usage')) metricName = 'memory_usage_percent';
                  else if (metricName.includes('capacity_usage')) metricName = 'capacity_used_percent';
                  else if (metricName.includes('total_capacity')) {
                    metricName = 'capacity_total';
                    if (finalValue > 100000000) finalValue = finalValue / (1024 * 1024 * 1024); // Byte to GB
                  }
                  else if (metricName.includes('used_space')) {
                    metricName = 'capacity_used';
                    if (finalValue > 100000000) finalValue = finalValue / (1024 * 1024 * 1024); // Byte to GB
                  }

                  metrics.push({
                    objectId: resourceId,
                    objectName: resourceName,
                    objectType,
                    metricName,
                    metricValue: finalValue,
                    timestamp
                  });
                }
              }
            } catch (statErr: any) {
              console.warn(`[VRopsForecast] Failed to fetch stats for ${resourceName}: ${statErr.message}`);
            }
          }
        } catch (kindErr: any) {
          console.warn(`[VRopsForecast] Failed to fetch ${kind} resources: ${kindErr.message}`);
        }
      }

      console.log(`[VRopsForecast] Collected ${metrics.length} metrics total.`);
    } catch (error) {
      console.warn(`[VRopsForecast] Failed to fetch metrics:`, (error as Error).message);
    }

    return metrics;
  }
}
