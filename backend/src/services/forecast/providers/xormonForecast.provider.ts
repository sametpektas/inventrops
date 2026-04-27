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

      // 1. Get device list from multiple architecture endpoints
      const endpoints = [
        '/api/public/v1/architecture/devices',
        '/api/public/v1/architecture/storage',
        '/api/public/v1/architecture/san'
      ];

      let allDevicesMap = new Map<string, any>();
      for (const endpoint of endpoints) {
        try {
          const devResponse = await client.get(endpoint, { headers });
          const rawDevices = devResponse.data;
          let items: any[] = (Array.isArray(rawDevices) ? rawDevices : (rawDevices?.data || rawDevices?.items || []));
          for (const item of items) {
            const id = String(item.item_id || item.id || '');
            if (id && !allDevicesMap.has(id)) allDevicesMap.set(id, item);
          }
        } catch (err) {}
      }

      const devices = Array.from(allDevicesMap.values());
      console.log(`[XormonForecast] Found ${devices.length} devices for targeted sync.`);

      for (const device of devices) {
        const itemId = String(device.item_id || device.id || '');
        const label = String(device.label || device.hostname || itemId);
        const hwType = String(device.hw_type || '').toLowerCase();
        const vendor = String(device.vendor || '').toLowerCase();
        const deviceClass = String(device.class || '').toLowerCase();
        
        let finalType = deviceClass;
        if (hwType.includes('brcd') || vendor.includes('brocade') || label.toLowerCase().includes('sw') || finalType === 'san') {
          finalType = 'san';
        } else {
          finalType = 'storage'; // Default for targeted sync
        }

        if (finalType === 'storage') {
          // --- STORAGE FLOW: Timeseries with History ---
          try {
            // Check if we have history to determine start date
            const existing = await prisma.forecastMetricSnapshot.findFirst({
              where: { object_id: itemId },
              orderBy: { captured_at: 'desc' }
            });

            const endTime = Date.now();
            // If exists, just 2 days. If first sync, 180 days (6 months)
            const daysToFetch = existing ? 2 : 180;
            const startTime = endTime - (daysToFetch * 24 * 3600 * 1000);

            console.log(`[XormonForecast] Storage ${label}: Syncing ${daysToFetch} days...`);

            const tsRes = await client.post('/api/public/v1/exporter/timeseries', {
              uuids: [itemId],
              metric: ["capacity_total", "capacity_used", "capacity_used_percent", "capacity_free"],
              start: startTime / 1000, // User example showed seconds with decimals
              end: endTime / 1000,
              format: "json"
            }, { headers });

            const series = Array.isArray(tsRes.data) ? tsRes.data : (tsRes.data?.data || []);
            for (const s of series) {
              const mName = s.metric || s.metric_name;
              const values = s.values || s.data || [];
              if (!Array.isArray(values)) continue;

              for (const point of values) {
                const ts = point.t || point[0];
                const val = point.v || point[1];
                if (ts && val !== undefined && val !== null) {
                  let normalizedMetric = '';
                  if (mName === 'capacity_total') normalizedMetric = 'capacity_total';
                  else if (mName === 'capacity_used_percent' || mName === 'capacity_usage') normalizedMetric = 'capacity_used_percent';
                  
                  if (normalizedMetric) {
                    metrics.push({
                      objectId: itemId, objectName: label, objectType: 'storage',
                      metricName: normalizedMetric, metricValue: parseFloat(String(val)),
                      timestamp: new Date(ts > 9999999999 ? ts : ts * 1000)
                    });
                  }
                }
              }
            }
          } catch (e: any) {
            console.warn(`[XormonForecast] Storage ${label} failed: ${e.message}`);
          }
        } else {
          // --- SAN FLOW: Configuration (No History) ---
          try {
            const confRes = await client.post('/api/public/v1/exporter/configuration', {
              uuids: [itemId],
              format: "json"
            }, { headers });

            const confData = Array.isArray(confRes.data) ? confRes.data[0] : (confRes.data?.data?.[0] || {});
            const conf = confData.configuration || {};
            
            const availablePorts = parseFloat(String(conf.available_ports || '0'));
            const freePorts = parseFloat(String(conf.free_ports || '0'));

            if (availablePorts > 0) {
              const usedPorts = availablePorts - freePorts;
              const usagePercent = (usedPorts / availablePorts) * 100;
              
              console.log(`[XormonForecast] SAN ${label}: ${usedPorts}/${availablePorts} used (${usagePercent.toFixed(2)}%)`);
              
              metrics.push({
                objectId: itemId, objectName: label, objectType: 'san',
                metricName: 'port_utilization_percent', 
                metricValue: Math.round(usagePercent * 100) / 100,
                timestamp: new Date()
              });
            }
          } catch (e: any) {
            console.warn(`[XormonForecast] SAN ${label} failed: ${e.message}`);
          }
        }
      }

      console.log(`[XormonForecast] Targeted sync complete. Collected ${metrics.length} points.`);
    } catch (error) {
      console.error(`[XormonForecast] Fatal Error:`, (error as Error).message);
    }

    return metrics;
  }
}
