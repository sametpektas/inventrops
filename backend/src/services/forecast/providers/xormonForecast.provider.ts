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

        // Fetch configuration to get capacity info
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
            const nested = configData.data || configData.items;
            if (Array.isArray(nested) && nested.length > 0) {
              conf = nested[0]?.configuration || nested[0]?.config || nested[0] || {};
            } else {
              // Keyed object { uuid: config }
              const keys = Object.keys(configData);
              if (keys.length > 0) {
                const val = configData[keys[0]];
                conf = val?.configuration || val?.config || val || {};
              }
            }
          }

          // Extract capacity metrics if available
          const capacityTotal = parseFloat(conf.capacity_total || conf.total_capacity || '0');
          const capacityUsed = parseFloat(conf.capacity_used || conf.used_capacity || '0');

          if (capacityTotal > 0) {
            metrics.push({
              objectId: itemId,
              objectName: label,
              objectType: deviceClass,
              metricName: 'capacity_total',
              metricValue: capacityTotal,
              timestamp
            });

            metrics.push({
              objectId: itemId,
              objectName: label,
              objectType: deviceClass,
              metricName: 'capacity_used',
              metricValue: capacityUsed,
              timestamp
            });

            const usedPercent = capacityTotal > 0 ? (capacityUsed / capacityTotal) * 100 : 0;
            metrics.push({
              objectId: itemId,
              objectName: label,
              objectType: deviceClass,
              metricName: 'capacity_used_percent',
              metricValue: Math.round(usedPercent * 100) / 100,
              timestamp
            });

            console.log(`[XormonForecast] ${label}: ${usedPercent.toFixed(1)}% used (${capacityUsed}/${capacityTotal})`);
          }

          // SAN port utilization if applicable
          if (deviceClass === 'san' || hwType === 'sanbrcd') {
            const portUtil = parseFloat(conf.port_utilization || conf.bandwidth_percent || '0');
            if (portUtil > 0) {
              metrics.push({
                objectId: itemId,
                objectName: label,
                objectType: 'san',
                metricName: 'port_utilization_percent',
                metricValue: portUtil,
                timestamp
              });
            }
          }
        } catch (err: any) {
          console.warn(`[XormonForecast] Failed to fetch config for ${label}: ${err.message}`);
        }
      }

      console.log(`[XormonForecast] Collected ${metrics.length} metrics from ${devices.length} devices.`);
    } catch (error) {
      console.warn(`[XormonForecast] Failed to fetch metrics:`, (error as Error).message);
    }

    return metrics;
  }
}
