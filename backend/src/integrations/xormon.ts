import axios, { AxiosInstance } from 'axios';
import https from 'https';
import { DiscoveredDevice } from './dell';

export class XormonAdapter {
  private client: AxiosInstance;
  private apiKey: string | null = null;

  constructor(private config: any) {
    this.client = axios.create({
      baseURL: this.config.url,
      timeout: 60000,
      httpsAgent: new https.Agent({
        rejectUnauthorized: false
      })
    });
  }

  private async authenticate(): Promise<string> {
    if (this.config.api_key) return this.config.api_key;
    if (this.apiKey) return this.apiKey;

    try {
      console.log(`[Xormon] Authenticating with ${this.config.url}...`);
      const response = await this.client.post('/api/public/v1/auth', {
        username: this.config.username,
        password: this.config.password
      });

      const dataObj = response.data.data || response.data;
      const key = dataObj.apiKey || dataObj.api_key || dataObj.apikey;

      if (!key) throw new Error('No API Key found in response');
      this.apiKey = key;
      return key;
    } catch (error: any) {
      throw new Error(`Xormon Auth Failed: ${error.message}`);
    }
  }

  async testConnection(): Promise<boolean> {
    try {
      await this.authenticate();
      return true;
    } catch {
      return false;
    }
  }

  async fetchInventory(): Promise<DiscoveredDevice[]> {
    console.log(`[Xormon] Starting inventory sync from ${this.config.url}...`);

    try {
      const key = await this.authenticate();
      const headers = { 'apiKey': key };

      // 1. Get List of Devices
      const devResponse = await this.client.get('/api/public/v1/architecture/devices', { headers });
      const devices = this.extractItems(devResponse.data);
      if (devices.length === 0) return [];

      // 2. Fetch Deep Configurations in Chunks (Batch size 20 to avoid timeouts)
      const uuids = devices.map((d: any) => d.item_id || d.id).filter(Boolean);
      const chunkSize = 20;
      let allConfigs: any[] = [];

      for (let i = 0; i < uuids.length; i += chunkSize) {
        const chunk = uuids.slice(i, i + chunkSize);
        try {
          const configResponse = await this.client.post('/api/public/v1/exporter/configuration', {
            uuids: chunk,
            format: 'json'
          }, { headers });
          
          const chunkData = this.extractItems(configResponse.data);
          allConfigs = [...allConfigs, ...chunkData];
        } catch (err: any) {
          console.error(`[Xormon] Chunk ${i/chunkSize + 1} failed: ${err.message}`);
        }
      }

      // 3. Map and Merge Data
      return devices.map((d: any) => {
        const itemId = String(d.item_id || d.id);
        
        // Match logic: Priority to item_id, then fallback to property matching
        const configEntry = allConfigs.find((c: any) => 
          String(c.item_id || c.id || '') === itemId || 
          String(c.hostcfg_id || '') === itemId ||
          c.label === d.label
        );

        const config = configEntry?.configuration || configEntry?.config || configEntry || {};
        
        // Intelligent Extraction
        const serial = String(config.serial || config.id || getValue(config, ['serial', 'sn', 'id']) || itemId);
        const hostname = config.node_name || config.label || d.label || d.hostname;
        const model = config.model || d.hw_type || 'storage';
        
        let ip = config.ip_address || config.mgmt_ip || d.ip_address || '0.0.0.0';
        if (typeof ip === 'string' && ip.includes(',')) ip = ip.split(',')[0].trim();

        // Vendor heuristic
        let vendor = d.hw_vendor || 'Unknown';
        const modelLower = String(model).toLowerCase();
        if (modelLower.includes('oceanstor') || modelLower.includes('huawei')) vendor = 'Huawei';
        if (modelLower.includes('isilon') || d.hw_type === 'isilon') vendor = 'Dell EMC';

        const result: DiscoveredDevice = {
          serial_number: serial,
          hostname: hostname,
          vendor_name: vendor,
          model_name: model,
          device_type: 'storage',
          ip_address: ip === '0.0.0.0' ? undefined : ip,
          sync_error: !configEntry ? 'Deep configuration could not be fetched.' : undefined,
          metadata: {
            ...config,
            hw_type: d.hw_type,
            xormon_id: itemId
          }
        };

        console.log(`[Xormon] Sync Result for ${hostname}: SN=${serial}, IP=${ip}`);
        return result;
      });

    } catch (error: any) {
      console.error(`[Xormon] Sync failed: ${error.message}`);
      throw error;
    }
  }

  private extractItems(data: any): any[] {
    if (!data) return [];
    if (Array.isArray(data)) return data;
    const body = data.data || data.items || data;
    if (Array.isArray(body)) return body;
    if (typeof body === 'object') return Object.values(body);
    return [];
  }
}

// Utility to find values in nested objects by key patterns
function getValue(obj: any, patterns: string[]): any {
  if (!obj || typeof obj !== 'object') return undefined;
  for (const key of Object.keys(obj)) {
    if (patterns.some(p => key.toLowerCase().includes(p.toLowerCase()))) {
      if (typeof obj[key] !== 'object') return obj[key];
    }
  }
  // One level deep scan
  for (const key of ['configuration', 'config', 'details']) {
    if (obj[key] && typeof obj[key] === 'object') {
       const val = getValue(obj[key], patterns);
       if (val) return val;
    }
  }
  return undefined;
}
