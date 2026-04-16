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
      // Send both common header variants for Xormon
      const headers = { 
        'apiKey': key,
        'X-API-KEY': key 
      };

      // 1. Get List of Devices
      const devResponse = await this.client.get('/api/public/v1/architecture/devices', { headers });
      const devices = this.extractItems(devResponse.data);
      if (devices.length === 0) {
        console.log(`[Xormon] No devices found in basic discovery.`);
        return [];
      }

      // 2. Fetch Deep Configurations in Chunks (Batch size 20)
      const uuids = devices.map((d: any) => d.item_id || d.id).filter(Boolean);
      const chunkSize = 20;
      let allConfigs: any[] = [];

      console.log(`[Xormon] Fetching configurations for ${uuids.length} devices...`);

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

      console.log(`[Xormon] Total configurations retrieved: ${allConfigs.length}`);

      // 3. Map and Merge Data
      return devices.map((d: any) => {
        const itemId = String(d.item_id || d.id);
        const label = String(d.label || d.hostname || '');
        
        // Match logic: Check item_id, id, hostcfg_id or label fallback
        const configEntry = allConfigs.find((c: any) => {
          const cId = String(c.item_id || c.id || c.hostcfg_id || '');
          return cId === itemId || c.label === label;
        });

        const config = configEntry?.configuration || configEntry?.config || configEntry || {};
        const hasDeepConfig = !!configEntry;
        
        // Extraction
        const serial = String(config.serial || config.id || getValue(config, ['serial', 'sn', 'id']) || itemId);
        const hostname = config.node_name || config.label || label || itemId;
        const model = config.model || config.model_name || d.hw_type || 'storage';
        
        let ip = config.ip_address || config.mgmt_ip || config.ip || d.ip_address || '0.0.0.0';
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
          sync_error: !hasDeepConfig ? 'Deep configuration could not be fetched (no match).' : undefined,
          metadata: {
            ...config,
            hw_type: d.hw_type,
            xormon_id: itemId,
            sync_status: hasDeepConfig ? 'success' : 'basic_only'
          }
        };

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
    // Xormon sometimes wraps data in a 'data' or 'items' key
    const body = data.data || data.items || data;
    if (Array.isArray(body)) return body;
    // If it's an object with numeric or UUID keys, convert to array
    if (typeof body === 'object' && body !== null) {
       return Object.entries(body).map(([key, val]: [string, any]) => {
         if (typeof val === 'object' && val !== null) {
            return { item_id: key, ...val };
         }
         return { item_id: key, value: val };
       });
    }
    return [];
  }
}

// Utility to find values in nested objects by key patterns
function getValue(obj: any, patterns: string[]): any {
  if (!obj || typeof obj !== 'object') return undefined;
  for (const key of Object.keys(obj)) {
    if (patterns.some(p => key.toLowerCase().includes(p.toLowerCase()))) {
      if (typeof obj[key] !== 'object' && obj[key] !== null) return obj[key];
    }
  }
  // Search in common sub-folders
  for (const key of ['configuration', 'config', 'details', 'data']) {
    if (obj[key] && typeof obj[key] === 'object') {
       const val = getValue(obj[key], patterns);
       if (val) return val;
    }
  }
  return undefined;
}
