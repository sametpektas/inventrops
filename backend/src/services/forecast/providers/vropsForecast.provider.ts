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

      // Fetch resources (Datacenters, Hosts, Clusters, Datastores)
      const resourceKinds = ['Datacenter', 'HostSystem', 'ClusterComputeResource', 'Datastore'];

      for (const kind of resourceKinds) {
        try {
          let page = 0;
          let hasMore = true;
          let resources: any[] = [];

          while (hasMore) {
            const resResponse = await client.get('/suite-api/api/resources', {
              headers,
              params: { resourceKind: kind, pageSize: 1000, page }
            });

            const pageResources = resResponse.data?.resourceList || [];
            if (pageResources.length > 0) {
              resources.push(...pageResources);
              const pageInfo = resResponse.data?.pageInfo;
              if (pageInfo && pageInfo.totalCount !== undefined) {
                 hasMore = resources.length < pageInfo.totalCount;
              } else {
                 hasMore = pageResources.length === 1000;
              }
              page++;
            } else {
              hasMore = false;
            }
          }

          console.log(`[VRopsForecast] Found ${resources.length} ${kind} resources.`);

          for (const resource of resources) {
            const resourceId = resource.identifier;
            const resourceName = resource.resourceKey?.name || resource.resourceName || resourceId;
            let objectType = 'server';

            if (kind === 'ClusterComputeResource') objectType = 'cluster';
            else if (kind === 'Datastore') objectType = 'storage';
            else if (kind === 'Datacenter') objectType = 'datacenter';

            // Determine start and end time for historical stats
            const existing = await prisma.forecastMetricSnapshot.findFirst({
              where: { object_id: resourceId },
              orderBy: { captured_at: 'desc' }
            });

            const endTime = Date.now();
            const daysToFetch = existing ? 2 : 180;
            const startTime = endTime - (daysToFetch * 24 * 3600 * 1000);

            // Fetch historical stats for this resource
            try {
              const statKeys = kind === 'Datastore'
                ? ['disk|capacity_usage', 'disk|capacity_contention', 'diskspace|total_capacity', 'diskspace|used_space']
                : ['cpu|usage_average', 'mem|usage_average', 'cpu|demandPct', 'mem|host_demand'];

              let statsRes;
              try {
                statsRes = await client.post(
                  `/suite-api/api/resources/stats/query`,
                  {
                    resourceId: [resourceId],
                    statKey: statKeys,
                    begin: startTime,
                    end: endTime,
                    rollUpType: 'AVG',
                    intervalType: 'DAYS',
                    intervalQuantifier: 1
                  },
                  { headers }
                );
              } catch (err: any) {
                // If 403 Forbidden with token, try fallback to Basic Auth for this specific request
                if (err.response?.status === 403 && source.username && source.password) {
                  const basicAuth = Buffer.from(`${source.username}:${decrypt(source.password)}`).toString('base64');
                  statsRes = await client.post(
                    `/suite-api/api/resources/stats/query`,
                    {
                      resourceId: [resourceId],
                      statKey: statKeys,
                      begin: startTime,
                      end: endTime,
                      rollUpType: 'AVG',
                      intervalType: 'DAYS',
                      intervalQuantifier: 1
                    },
                    { headers: { ...headers, 'Authorization': `Basic ${basicAuth}` } }
                  );
                } else {
                  throw err;
                }
              }

              const resourceStats = statsRes.data?.values || [statsRes.data];

              for (const resStat of resourceStats) {
                if (!resStat) continue;
                // vROps can return it in different nested structures
                const statList = resStat['stat-list']?.stat || resStat.statList?.stat || resStat.stat || [];

                for (const stat of statList) {
                  const key = stat.statKey?.key || stat.key;
                  if (!key) continue;

                  const timestamps = stat.timestamps || [];
                  const values = stat.data || stat.values || [];

                  if (timestamps.length > 0 && values.length > 0 && timestamps.length === values.length) {
                    let metricName = key.replace(/\|/g, '_');

                    if (metricName.includes('cpu_usage')) metricName = 'cpu_usage_percent';
                    else if (metricName.includes('mem_usage')) metricName = 'memory_usage_percent';
                    else if (metricName.includes('capacity_usage')) metricName = 'capacity_used_percent';
                    else if (metricName.includes('total_capacity')) metricName = 'capacity_total';
                    else if (metricName.includes('used_space')) metricName = 'capacity_used';

                    for (let i = 0; i < timestamps.length; i++) {
                      let finalValue = Number(values[i]);
                      if (metricName === 'capacity_total' || metricName === 'capacity_used') {
                        if (finalValue > 100000000) finalValue = finalValue / (1024 * 1024 * 1024); // Byte to GB
                      }

                      metrics.push({
                        objectId: resourceId,
                        objectName: resourceName,
                        objectType,
                        metricName,
                        metricValue: finalValue,
                        timestamp: new Date(timestamps[i])
                      });
                    }
                  }
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
