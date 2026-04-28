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

      // Only fetch Clusters as requested, exclude individual Hosts and Datacenters
      const resourceKinds = ['ClusterComputeResource'];

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
            let resourceName = resource.resourceKey?.name || resource.resourceName || resourceId;
            let objectType = 'cluster';

            // Attempt to fetch Datacenter name for the cluster via relationships
            if (kind === 'ClusterComputeResource') {
              let dcFound = false;
              try {
                // Try relationships first (most reliable)
                const relRes = await client.get(`/suite-api/api/resources/${resourceId}/relationships`, {
                  headers,
                  params: { relationshipType: 'PARENT' }
                });
                const parents = relRes.data?.resourceList || [];
                const dcParent = parents.find((p: any) => 
                  p.resourceKey?.resourceKindKey === 'Datacenter' || 
                  p.resourceKey?.resourceKind === 'Datacenter'
                );
                if (dcParent) {
                  const dcName = dcParent.resourceKey?.name || dcParent.resourceName || 'Unknown DC';
                  resourceName = `${dcName} | ${resourceName}`;
                  dcFound = true;
                }
              } catch {}
              
              if (!dcFound) {
                try {
                  const propRes = await client.get(`/suite-api/api/resources/${resourceId}/properties`, { headers });
                  const props = propRes.data?.property || [];
                  const dcProp = props.find((p: any) => p.name === 'summary|datacenter' || p.name === 'summary|parentDatacenter');
                  if (dcProp && dcProp.value) {
                    resourceName = `${dcProp.value} | ${resourceName}`;
                    dcFound = true;
                  }
                } catch {}
              }
              
              if (!dcFound) {
                resourceName = `Unknown DC | ${resourceName}`;
              }
            }

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
              // Broad coverage of all common vROps cluster CPU/MEM stat keys
              const statKeys = [
                'cpu|usage_average', 
                'cpu|usagemhz_average',
                'cpu|demandmhz',
                'cpu|demandPct',
                'cpu|workload',
                'cpu|capacity_usagepct_average',
                'mem|usage_average',
                'mem|workload', 
                'mem|host_demand',
                'mem|capacity_usagepct_average',
                'cpu|capacity_provisioned', 
                'cpu|totalCapacity_average',
                'mem|host_usable', 
                'mem|capacity_provisioned',
                'mem|totalCapacity_average'
              ];

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
              
              // Debug: log all returned stat keys for first cluster only
              if (resources.indexOf(resource) === 0) {
                const debugKeys: string[] = [];
                for (const rs of resourceStats) {
                  if (!rs) continue;
                  const sl = rs['stat-list']?.stat || rs.statList?.stat || rs.stat || [];
                  for (const s of sl) {
                    const k = s.statKey?.key || s.key;
                    if (k) debugKeys.push(k);
                  }
                }
                console.log(`[VRopsForecast] DEBUG: Returned stat keys for ${resourceName}: ${JSON.stringify(debugKeys)}`);
              }

              for (const resStat of resourceStats) {
                if (!resStat) continue;
                const statList = resStat['stat-list']?.stat || resStat.statList?.stat || resStat.stat || [];

                for (const stat of statList) {
                  const key = stat.statKey?.key || stat.key;
                  if (!key) continue;

                  const timestamps = stat.timestamps || [];
                  const values = stat.data || stat.values || [];

                  if (timestamps.length > 0 && values.length > 0 && timestamps.length === values.length) {
                    let metricName = key.replace(/\|/g, '_');

                    // CPU percentage variants
                    if (metricName.includes('cpu_usage') || metricName.includes('cpu_workload') || metricName.includes('cpu_demandPct') || metricName.includes('cpu_capacity_usagepct')) metricName = 'cpu_usage_percent';
                    // MEM percentage variants 
                    else if (metricName.includes('mem_usage') || metricName.includes('mem_workload') || metricName.includes('mem_capacity_usagepct')) metricName = 'memory_usage_percent';
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
