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
          model.includes('v7000') || model.includes('svc') || model.includes('oceanstor')
        ) {
          finalType = 'storage';
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

          // Helper for unit-aware parsing (Xormon sometimes returns "10.5 TB" or "10.5TB")
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

          // 1. Storage Capacity Metrics
          // Expanded aliases for IBM, Hitachi, and Dell EMC
          const totalVal = conf.capacity_total || conf.total_capacity || conf.pool_total_capacity || 
                           conf.physical_capacity || conf.real_capacity || conf.total_size || 
                           conf.size || conf.capacity || '0';
                           
          const usedVal = conf.capacity_used || conf.used_capacity || conf.pool_used_capacity || 
                          conf.physical_used_capacity || conf.used_real_capacity || 
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
            
            // Calculate percentage
            let usagePercent = (capUsedGB / capTotalGB) * 100;
            if (usagePercent > 100 && !label.toLowerCase().includes('overprovision')) usagePercent = 100;

            metrics.push({
              objectId: itemId, objectName: label, objectType: finalType,
              metricName: 'capacity_used_percent', 
              metricValue: Math.round(usagePercent * 100) / 100, 
              timestamp
            });
          } else {
            // Log available keys to help debug missing IBM metrics
            const availableKeys = Object.keys(conf).filter(k => k.includes('cap') || k.includes('size') || k.includes('used'));
            if (availableKeys.length > 0) {
              console.log(`[XormonForecast] Device ${label} has no capacity but found keys: ${availableKeys.join(', ')}`);
            }
          }

          // 2. SAN specific metrics (Ports)
          if (finalType === 'san' || hwType === 'sanbrcd' || hwType === 'brocade' || label.toLowerCase().includes('sw')) {
            const pTotal = conf.ports_total || conf.total_ports || conf.port_count || conf.ports || '0';
            const pOnline = conf.ports_online || conf.active_ports || conf.online_ports || conf.port_usage || '0';
            const pFree = conf.ports_free || conf.available_ports || '0';
            
            let portsTotal = parseFloat(String(pTotal));
            let portsOnline = parseFloat(String(pOnline));
            
            // Fallback: If we have total and free, calculate online
            if (portsTotal > 0 && portsOnline === 0 && parseFloat(String(pFree)) > 0) {
              portsOnline = portsTotal - parseFloat(String(pFree));
            }
            
            if (portsTotal > 0) {
              const portUsedPercent = (portsOnline / portsTotal) * 100;
              metrics.push({
                objectId: itemId, objectName: label, objectType: 'san',
                metricName: 'port_utilization_percent', metricValue: Math.round(portUsedPercent * 100) / 100, timestamp
              });
            } else {
              const portUtil = parseFloat(String(conf.port_utilization || conf.bandwidth_percent || conf.utilization || '0'));
              if (portUtil > 0) {
                metrics.push({
                  objectId: itemId, objectName: label, objectType: 'san',
                  metricName: 'port_utilization_percent', metricValue: portUtil, timestamp
                });
              }
            }
          }

          // 3. Generic performance
          const cpuVal = conf.cpu_utilization || conf.cpu_usage || conf.processor_utilization || '0';
          const cpu = parseFloat(String(cpuVal));
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
