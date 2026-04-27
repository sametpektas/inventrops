import axios from 'axios';
import https from 'https';
import { prisma } from '../../../lib/prisma';
import { decrypt } from '../../../utils/crypto';
import { NormalizedMetric, ForecastProvider } from './index';

export class XormonForecastProvider implements ForecastProvider {
  async collectMetrics(sourceId: number): Promise<NormalizedMetric[]> {
    const source = await prisma.integrationConfig.findUnique({ where: { id: sourceId } });
    if (!source || source.integration_type !== 'xormon') throw new Error('Invalid Xormon source');

    const metrics: NormalizedMetric[] = [];
    const timestamp = new Date();

    const client = axios.create({
      baseURL: source.url,
      timeout: 60000,
      httpsAgent: new https.Agent({ rejectUnauthorized: false }),
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' }
    });

    try {
      // Authenticate using same method as XormonAdapter
      let apiKey = source.api_key ? decrypt(source.api_key) : null;

      if (!apiKey && source.username && source.password) {
        const authRes = await client.post('/api/public/v1/auth', {
          username: source.username,
          password: decrypt(source.password)
        });
        const dataObj = authRes.data?.data || authRes.data;
        apiKey = dataObj?.apiKey || dataObj?.api_key || dataObj?.apikey;
      }

      if (!apiKey) {
        console.warn('[XormonForecast] No valid API key obtained.');
        return metrics;
      }

      const headers = { 'apiKey': apiKey, 'X-API-KEY': apiKey };

    try {
      // 1. Discover and Fetch Bulk Exporters (Storage & SAN)
      console.log(`[XormonForecast] Discovering Bulk Exporters...`);
      try {
        const exportsRes = await client.get('/api/exporter/v1/exports', { headers });
        const exports = Array.isArray(exportsRes.data?.data) ? exportsRes.data.data : 
                        (Array.isArray(exportsRes.data) ? exportsRes.data : []);
        
        console.log(`[XormonForecast] Found ${exports.length} configured exporters.`);

        for (const exp of exports) {
          const label = String(exp.label || '').toLowerCase();
          const exportId = exp.export_id || exp.id;
          
          // Focus on Capacity, Switch or User's 'test' label
          if (exportId && (label.includes('capacity') || label.includes('switch') || label.includes('test') || label.includes('storage'))) {
            console.log(`[XormonForecast] Fetching data for exporter: ${exp.label} (${exportId})`);
            try {
              // Try to fetch the data for this export
              const dataRes = await client.get(`/api/exporter/v1/exports/${exportId}/data`, { headers });
              const resultData = dataRes.data?.data || dataRes.data;
              const series = Array.isArray(resultData) ? resultData : (resultData?.items || resultData?.results || []);

              if (series.length > 0) {
                console.log(`[XormonForecast] Exporter '${exp.label}' returned ${series.length} series.`);
                for (const s of series) {
                  const itemId = s.item_id || s.id || s.uuid;
                  const itemLabel = s.label || s.item_name || itemId;
                  const mName = s.metric || s.metric_name;
                  const values = s.values || s.data || [];
                  if (!itemId || !Array.isArray(values)) continue;

                  const objType = label.includes('switch') ? 'san' : 'storage';

                  for (const point of values) {
                    const ts = point.t || point[0];
                    const val = point.v || point[1];
                    if (ts && val !== undefined) {
                      let normalizedMetric = '';
                      if (mName.includes('percent')) {
                         normalizedMetric = label.includes('switch') ? 'port_utilization_percent' : 'capacity_used_percent';
                      } else if (mName.includes('total')) {
                         normalizedMetric = 'capacity_total';
                      }
                      
                      if (normalizedMetric) {
                        const timestampObj = new Date(ts > 9999999999 ? ts : ts * 1000);
                        metrics.push({
                          objectId: itemId, objectName: itemLabel, objectType: objType,
                          metricName: normalizedMetric, metricValue: parseFloat(String(val)), timestamp: timestampObj
                        });
                      }
                    }
                  }
                }
              }
            } catch (dataErr: any) {
              console.warn(`[XormonForecast] Failed to fetch data for export ${exportId}: ${dataErr.message}`);
            }
          }
        }
      } catch (listErr: any) {
        console.warn(`[XormonForecast] Export discovery failed: ${listErr.message}`);
      }

      // 2. Get device list for remaining devices (Architecture API fallback)
      const endpoints = [
        '/api/public/v1/architecture/devices',
        '/api/public/v1/architecture/storage',
        '/api/public/v1/architecture/san',
        '/api/public/v1/architecture/server',
        '/api/public/v1/architecture/virtualization'
      ];

      let allDevicesMap = new Map<string, any>();

      for (const endpoint of endpoints) {
        try {
          const devResponse = await client.get(endpoint, { headers });
          const rawDevices = devResponse.data;
          let items: any[] = [];

          if (Array.isArray(rawDevices)) items = rawDevices;
          else if (rawDevices?.data && Array.isArray(rawDevices.data)) items = rawDevices.data;
          else if (rawDevices?.items && Array.isArray(rawDevices.items)) items = rawDevices.items;

          for (const item of items) {
            const id = String(item.item_id || item.id || '');
            if (id && !allDevicesMap.has(id)) {
              allDevicesMap.set(id, item);
            }
          }
        } catch (err) {
          // Some endpoints might not exist or be licensed, skip gracefully
        }
      }

      const devices = Array.from(allDevicesMap.values());
      console.log(`[XormonForecast] Found ${devices.length} unique devices across all architecture endpoints.`);

      // For each device, fetch configuration (for metadata) and timeseries (for history)
      for (const device of devices) {
        const itemId = String(device.item_id || device.id || '');
        const label = String(device.label || device.hostname || itemId);
        const hwType = String(device.hw_type || '').toLowerCase();
        const vendor = String(device.vendor || '').toLowerCase();
        const model = String(device.model || '').toLowerCase();
        const deviceClass = String(device.class || 'storage').toLowerCase();
        let finalType = deviceClass;
        
        if (
          hwType === 'sanbrcd' || hwType === 'brocade' || 
          vendor === 'brocade' || vendor.includes('san') ||
          model.includes('switch') || label.toLowerCase().includes('switch')
        ) {
          finalType = 'san';
        } else if (
          vendor.includes('ibm') || vendor.includes('hitachi') || vendor.includes('huawei') ||
          model.includes('v7000') || model.includes('svc') || model.includes('oceanstor') ||
          hwType.includes('svc') || hwType.includes('v7000')
        ) {
          finalType = 'storage';
        }

        try {
          // 1. Fetch Capacity Metrics (Standardized)
          let totalGB = 0;
          let usedGB = 0;

          try {
            const capRes = await client.post(
              '/api/public/v1/exporter/capacity',
              { uuids: [itemId], format: 'json' },
              { headers }
            );

            const capData = capRes.data;
            let capMetrics: any = null;

            if (Array.isArray(capData) && capData.length > 0) {
              capMetrics = capData[0]?.capacity_metrics || capData[0];
            } else if (capData?.data && Array.isArray(capData.data) && capData.data.length > 0) {
              capMetrics = capData.data[0]?.capacity_metrics || capData.data[0];
            }

            if (capMetrics) {
              totalGB = parseFloat(String(capMetrics.total_usable_gb || capMetrics.total_raw_gb || capMetrics.capacity_total || capMetrics.total || '0'));
              usedGB = parseFloat(String(capMetrics.used_gb || capMetrics.capacity_used || capMetrics.used || '0'));
              console.log(`[XormonForecast] Capacity for ${label}: ${totalGB}GB Total, ${usedGB}GB Used`);
            }
          } catch (e: any) {
            console.warn(`[XormonForecast] /exporter/capacity failed for ${label}: ${e.message}`);
          }

          // 2. Fetch Configuration (Metadata + Fallback)
          const configRes = await client.post(
            '/api/public/v1/exporter/configuration',
            { uuids: [itemId], format: 'json' },
            { headers }
          );

          const configData = configRes.data;
          let conf: any = {};
          if (Array.isArray(configData) && configData.length > 0) {
            conf = configData[0]?.configuration || configData[0]?.config || configData[0] || {};
          }
          
          const parseXormonValue = (val: any): number => {
            if (typeof val === 'number') {
              // If number is huge (e.g. > 1 trillion), it's likely Bytes, convert to GB
              if (val > 1000000000000) return val / (1024 * 1024 * 1024);
              // If number is large (e.g. > 1 million), it's likely MB, convert to GB
              if (val > 1000000) return val / 1024;
              return val; // Likely already GB or small MB
            }
            if (!val) return 0;
            const str = String(val).toLowerCase().trim();
            const num = parseFloat(str);
            if (isNaN(num)) return 0;
            if (str.includes('pb')) return num * 1024 * 1024;
            if (str.includes('tb')) return num * 1024;
            if (str.includes('gb')) return num;
            if (str.includes('mb')) return num / 1024;
            if (str.includes('kb')) return num / (1024 * 1024);
            // Default: If no unit and huge, treat as bytes
            if (num > 1000000000000) return num / (1024 * 1024 * 1024);
            return num / 1024; // Default MB to GB
          };

          // Fallback for storage if /capacity was empty
          if (totalGB === 0) {
            const totalVal = conf.capacity_total || conf.total_capacity || conf.pool_total_capacity || 
                             conf.physical_capacity || conf.real_capacity || conf.cap_p || '0';
            const usedVal = conf.capacity_used || conf.used_capacity || conf.pool_used_capacity || 
                            conf.physical_used_capacity || conf.used_real_capacity || conf.cap_r || '0';
            totalGB = parseXormonValue(totalVal);
            usedGB = parseXormonValue(usedVal);
            if (totalGB > 0) console.log(`[XormonForecast] Config Fallback for ${label}: ${totalGB.toFixed(2)}GB Total`);
          }

          if (totalGB > 0) {
            metrics.push({
              objectId: itemId, objectName: label, objectType: 'storage',
              metricName: 'capacity_total', metricValue: totalGB, timestamp
            });
            
            const usagePercent = Math.min(100, (usedGB / totalGB) * 100);
            metrics.push({
              objectId: itemId, objectName: label, objectType: 'storage',
              metricName: 'capacity_used_percent', 
              metricValue: Math.round(usagePercent * 100) / 100, 
              timestamp
            });
          }

          // 3. SAN specific metrics (Optimized)
          if (finalType === 'san' || hwType === 'brocade' || label.toLowerCase().includes('sw')) {
            const pTotal = conf.ports_total || conf.total_ports || conf.port_count || conf.ports || '0';
            let pOnline = conf.ports_online || conf.active_ports || conf.online_ports || conf.port_usage || '0';
            
            const portsTotal = parseFloat(String(pTotal));
            let portsOnline = parseFloat(String(pOnline));
            
            // If config reports 0, try to find current value from timeseries
            if (portsTotal > 0 && portsOnline === 0) {
               try {
                 const tsNow = await client.post('/api/public/v1/exporter/timeseries', {
                    uuids: [itemId], metrics: ['ports_online'], 
                    start: Date.now() - 3600000, 
                    finish: Date.now(), 
                    format: 'json'
                 }, { headers });
                 const series = tsNow.data?.data || tsNow.data;
                 if (Array.isArray(series) && series.length > 0) {
                    const vals = series[0].values || series[0].data || [];
                    if (vals.length > 0) {
                      portsOnline = parseFloat(String(vals[vals.length - 1].v || vals[vals.length - 1][1]));
                    }
                 }
               } catch (e) {}
            }

            if (portsTotal > 0) {
              const portUsedPercent = (portsOnline / portsTotal) * 100;
              console.log(`[XormonForecast] SAN ${label}: ${portsOnline}/${portsTotal} ports used (${portUsedPercent.toFixed(2)}%)`);
              metrics.push({
                objectId: itemId, objectName: label, objectType: 'san',
                metricName: 'port_utilization_percent', metricValue: Math.round(portUsedPercent * 100) / 100, timestamp
              });
            }
          }

          // 4. Fetch Time-Series History (Last 180 days) - Per Device with Milliseconds
          try {
            const endTimeMs = Date.now();
            const startTimeMs = endTimeMs - (180 * 24 * 3600 * 1000);

            const tsRes = await client.post(
              '/api/public/v1/exporter/timeseries',
              {
                uuids: [itemId],
                metrics: ['capacity_usage', 'cpu_usage', 'mem_usage', 'data_rate', 'ports_online'],
                start: startTimeMs,
                finish: endTimeMs,
                format: 'json'
              },
              { headers }
            );

            const tsData = tsRes.data;
            const series = Array.isArray(tsData) ? tsData : (tsData?.data || tsData?.items || []);
            
            let pointsFound = 0;
            for (const s of series) {
              const mName = s.metric || s.metric_name;
              const values = s.values || s.data || [];
              if (!Array.isArray(values)) continue;

              for (const point of values) {
                const ts = point.t || point[0];
                const val = point.v || point[1];
                if (ts && val !== undefined && val !== null) {
                  let normalizedMetric = '';
                  let finalValue = parseFloat(String(val));

                  if (mName === 'capacity_usage') normalizedMetric = 'capacity_used_percent';
                  else if (mName === 'cpu_usage') normalizedMetric = 'cpu_usage_percent';
                  else if (mName === 'mem_usage') normalizedMetric = 'memory_usage_percent';
                  else if (mName === 'ports_online') normalizedMetric = 'ports_online_count';

                  if (normalizedMetric) {
                    const timestampObj = new Date(ts > 9999999999 ? ts : ts * 1000);
                    metrics.push({
                      objectId: itemId, objectName: label, objectType: finalType,
                      metricName: normalizedMetric, metricValue: finalValue, timestamp: timestampObj
                    });
                    pointsFound++;
                  }
                }
              }
            }
            if (pointsFound > 0) {
               console.log(`[XormonForecast] Found ${pointsFound} history points for ${label}`);
            }
          } catch (tsErr: any) {
             console.warn(`[XormonForecast] Timeseries failed for ${label}: ${tsErr.message}`);
          }

        } catch (err: any) {
          if (err.response?.status === 402) {
            console.warn(`[XormonForecast] Licensing Issue (402) for ${label}: API license missing.`);
          } else {
            console.warn(`[XormonForecast] Failed to fetch data for ${label}: ${err.message}`);
          }
        }
      }

      console.log(`[XormonForecast] Collected ${metrics.length} metrics from ${devices.length} devices.`);
    } catch (error) {
      console.warn(`[XormonForecast] Failed to fetch metrics:`, (error as Error).message);
    }

    return metrics;
  }
}
