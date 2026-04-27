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

      // For each device, fetch performance/capacity data
      for (const device of devices) {
        const itemId = String(device.item_id || device.id || '');
        const label = String(device.label || device.hostname || itemId);
        const hwType = String(device.hw_type || '').toLowerCase();
        const deviceClass = String(device.class || 'storage').toLowerCase();
        let finalType = deviceClass;
        if (hwType === 'sanbrcd' || hwType === 'brocade' || label.toLowerCase().includes('switch')) {
          finalType = 'san';
        }

        // Fetch configuration to get capacity and performance info
        try {
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
              // Keyed object { uuid: config }
              const keys = Object.keys(configData);
              if (keys.length > 0) {
                const val = configData[keys[0]];
                conf = val?.configuration || val?.config || val || {};
              }
            }
          }

          // 1. Storage Capacity Metrics (Convert MB to GB)
          const capacityTotalMB = parseFloat(conf.capacity_total || conf.total_capacity || conf.size || '0');
          const capacityUsedMB = parseFloat(conf.capacity_used || conf.used_capacity || conf.used || '0');

          if (capacityTotalMB > 0) {
            const capTotalGB = capacityTotalMB / 1024;
            const capUsedGB = capacityUsedMB / 1024;
            
            metrics.push({
              objectId: itemId, objectName: label, objectType: finalType,
              metricName: 'capacity_total', metricValue: capTotalGB, timestamp
            });
            metrics.push({
              objectId: itemId, objectName: label, objectType: finalType,
              metricName: 'capacity_used_percent', 
              metricValue: Math.round((capUsedGB / capTotalGB) * 10000) / 100, 
              timestamp
            });
          }

          // 2. SAN specific metrics
          if (finalType === 'san' || hwType === 'sanbrcd') {
            const portsTotal = parseFloat(conf.ports_total || conf.total_ports || '0');
            const portsOnline = parseFloat(conf.ports_online || conf.active_ports || '0');
            
            if (portsTotal > 0) {
              const portUsedPercent = (portsOnline / portsTotal) * 100;
              metrics.push({
                objectId: itemId, objectName: label, objectType: 'san',
                metricName: 'port_utilization_percent', metricValue: Math.round(portUsedPercent * 100) / 100, timestamp
              });
            } else {
              const portUtil = parseFloat(conf.port_utilization || conf.bandwidth_percent || conf.utilization || '0');
              if (portUtil > 0) {
                metrics.push({
                  objectId: itemId, objectName: label, objectType: 'san',
                  metricName: 'port_utilization_percent', metricValue: portUtil, timestamp
                });
              }
            }
          }

          // 3. Generic performance
          const cpu = parseFloat(conf.cpu_utilization || conf.cpu_usage || conf.processor_utilization || '0');
          if (cpu > 0) {
            metrics.push({
              objectId: itemId, objectName: label, objectType: finalType,
              metricName: 'cpu_usage_percent', metricValue: cpu, timestamp
            });
          }

        } catch (err: any) {
          if (err.response?.status === 402) {
            console.warn(`[XormonForecast] Licensing Issue (402) for ${label}: API license for this technology is missing in Xormon.`);
          } else {
            console.warn(`[XormonForecast] Failed to fetch config for ${label}: ${err.message}`);
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
