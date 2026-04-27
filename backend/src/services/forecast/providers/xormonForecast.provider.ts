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

      // Get device list
      const devResponse = await client.get('/api/public/v1/architecture/devices', { headers });
      const rawDevices = devResponse.data;
      let devices: any[] = [];

      if (Array.isArray(rawDevices)) {
        devices = rawDevices;
      } else if (rawDevices?.data && Array.isArray(rawDevices.data)) {
        devices = rawDevices.data;
      } else if (rawDevices?.items && Array.isArray(rawDevices.items)) {
        devices = rawDevices.items;
      }

      console.log(`[XormonForecast] Found ${devices.length} devices for capacity metrics.`);

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
          // 1. Fetch Configuration (Current snapshot + Metadata)
          const configRes = await client.post(
            '/api/public/v1/exporter/configuration',
            { uuids: [itemId], format: 'json' },
            { headers }
          );

          const configData = configRes.data;
          let conf: any = {};
          if (Array.isArray(configData) && configData.length > 0) {
            conf = configData[0]?.configuration || configData[0]?.config || configData[0] || {};
          } else if (configData && typeof configData === 'object') {
            const nested = configData.data || configData.items || configData.results;
            if (Array.isArray(nested) && nested.length > 0) {
              const first = nested[0];
              conf = first?.configuration || first?.config || first || {};
            } else {
              const keys = Object.keys(configData);
              if (keys.length > 0) {
                const val = configData[keys[0]];
                conf = val?.configuration || val?.config || val || {};
              }
            }
          }

          const parseXormonValue = (val: any): number => {
            if (typeof val === 'number') return val;
            if (!val) return 0;
            const str = String(val).toLowerCase().trim();
            const num = parseFloat(str);
            if (isNaN(num)) return 0;
            if (str.includes('pb')) return num * 1024 * 1024 * 1024;
            if (str.includes('tb')) return num * 1024 * 1024;
            if (str.includes('gb')) return num * 1024;
            if (str.includes('kb')) return num / 1024;
            return num; // Default MB
          };

          // Storage Capacity from Configuration (Last known state)
          const totalVal = conf.capacity_total || conf.total_capacity || conf.pool_total_capacity || 
                           conf.physical_capacity || conf.real_capacity || conf.cap_p || conf.total_size || 
                           conf.size || conf.capacity || '0';
                           
          const usedVal = conf.capacity_used || conf.used_capacity || conf.pool_used_capacity || 
                          conf.physical_used_capacity || conf.used_real_capacity || conf.cap_r ||
                          conf.used_size || conf.used || '0';

          const capacityTotalMB = parseXormonValue(totalVal);
          const capacityUsedMB = parseXormonValue(usedVal);

          if (capacityTotalMB > 0) {
            const capTotalGB = capacityTotalMB / 1024;
            const capUsedGB = capacityUsedMB / 1024;
            
            metrics.push({
              objectId: itemId, objectName: label, objectType: finalType,
              metricName: 'capacity_total', metricValue: capTotalGB, timestamp
            });
            
            let usagePercent = (capUsedGB / capTotalGB) * 100;
            if (usagePercent > 100 && !label.toLowerCase().includes('overprovision')) usagePercent = 100;

            metrics.push({
              objectId: itemId, objectName: label, objectType: finalType,
              metricName: 'capacity_used_percent', 
              metricValue: Math.round(usagePercent * 100) / 100, 
              timestamp
            });
          }

          // SAN specific metrics from Config (Fallback)
          if (finalType === 'san' || hwType === 'brocade' || label.toLowerCase().includes('sw')) {
            const pTotal = conf.ports_total || conf.total_ports || conf.port_count || conf.ports || '0';
            const pOnline = conf.ports_online || conf.active_ports || conf.online_ports || conf.port_usage || '0';
            
            const portsTotal = parseFloat(String(pTotal));
            const portsOnline = parseFloat(String(pOnline));
            
            if (portsTotal > 0) {
              const portUsedPercent = (portsOnline / portsTotal) * 100;
              metrics.push({
                objectId: itemId, objectName: label, objectType: 'san',
                metricName: 'port_utilization_percent', metricValue: Math.round(portUsedPercent * 100) / 100, timestamp
              });
            }
          }

          // 2. Fetch Time-Series History (Last 180 days) - ALWAYS TRY for all devices
          try {
            const endTime = Math.floor(Date.now() / 1000);
            const startTime = endTime - (180 * 24 * 3600); // 180 days ago

            const tsRes = await client.post(
              '/api/public/v1/exporter/timeseries',
              {
                uuids: [itemId],
                metrics: ['capacity_usage', 'cpu_usage', 'mem_usage', 'data_rate', 'ports_online'],
                start: startTime,
                end: endTime,
                format: 'json'
              },
              { headers }
            );

            const tsData = tsRes.data;
            const series = Array.isArray(tsData) ? tsData : (tsData?.data || tsData?.items || []);
            
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
                    metrics.push({
                      objectId: itemId, objectName: label, objectType: finalType,
                      metricName: normalizedMetric, metricValue: finalValue, timestamp: new Date(ts * 1000)
                    });
                  }
                }
              }
            }
          } catch (tsErr: any) {
            // Silently continue if history fails for a specific device
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
