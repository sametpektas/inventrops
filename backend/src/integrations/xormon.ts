import axios, { AxiosInstance } from 'axios';
import https from 'https';
import { DiscoveredDevice } from './dell';

export class XormonAdapter {
  private client: AxiosInstance;
  private apiKey: string | null = null;

  constructor(private config: any) {
    this.client = axios.create({
      baseURL: this.config.url,
      timeout: 30000,
      httpsAgent: new https.Agent({
        rejectUnauthorized: process.env.NODE_ENV === 'production'
      })
    });
  }

  /**
   * Authenticate with Xormon to get an API Key
   * Priority: 
   * 1. Use static API Key if provided in config
   * 2. Use existing session apiKey if already fetched
   * 3. Perform Login with Username/Password
   */
  private async authenticate(): Promise<string> {
    // 1. Check if a permanent API Key is already in the config
    if (this.config.api_key) return this.config.api_key;

    // 2. Already have a session key?
    if (this.apiKey) return this.apiKey;

    // 3. Fallback to Username/Password login
    try {
      console.log(`[Xormon] Attempting login on ${this.config.url}/api/public/v1/auth...`);
      const response = await this.client.post('/api/public/v1/auth', {
        username: this.config.username,
        password: this.config.password
      });

      // Handle nested structure: response.data.data.apiKey
      const dataObj = response.data.data || response.data;
      const key = dataObj.apiKey || dataObj.api_key || dataObj.apikey;

      if (!key) {
        console.error('[Xormon] Response data structure:', JSON.stringify(response.data));
        throw new Error('Xormon authentication failed: No API Key found in response');
      }

      this.apiKey = key;
      return this.apiKey!;
    } catch (error: any) {
      const msg = error.response?.data?.message || error.message;
      console.error(`[Xormon] Auth failed: ${msg}`);
      throw new Error(`Xormon Authentication Failed: ${msg}`);
    }
  }

  async testConnection(): Promise<boolean> {
    try {
      await this.authenticate();
      // If we got here, auth worked. Let's try a quick health/info check if possible
      // but usually auth is enough for a "test"
      return true;
    } catch (err) {
      return false;
    }
  }

  async fetchInventory(): Promise<DiscoveredDevice[]> {
    console.log(`[Xormon] Starting deep discovery from ${this.config.url}...`);

    try {
      const key = await this.authenticate();
      const headers = { 'apiKey': key };

      // 1. Fetch all items
      const devResponse = await this.client.get('/api/public/v1/architecture/devices', { headers });
      const items = this.extractItems(devResponse.data);
      
      if (items.length === 0) return [];

      const uuids = items.map((i: any) => i.item_id || i.id).filter(Boolean);
      console.log(`[Xormon] Found ${items.length} items. Fetching detailed configuration...`);

      // 2. Fetch all configuration properties
      const configResponse = await this.client.post('/api/public/v1/exporter/configuration', {
        uuids: uuids,
        format: 'json'
      }, { headers });

      // configResponse.data.data can be an array OR an object keyed by ID
      const detailsRaw = configResponse.data?.data || configResponse.data || [];
      const detailsArray = this.extractItems(detailsRaw);

      // 3. Map with Universal Heuristics
      return items.map((d: any) => {
        const itemId = String(d.item_id || d.id);
        
        // Find details by ID match in array, OR check if the raw details was an object keyed by itemId
        let itemDetails = detailsArray.find((p: any) => String(p.item_id || p.id) === itemId);
        if (!itemDetails && typeof detailsRaw === 'object' && detailsRaw[itemId]) {
            itemDetails = { item_id: itemId, ...detailsRaw[itemId] };
        }
        itemDetails = itemDetails || {};

        const properties = Array.isArray(itemDetails.properties) ? itemDetails.properties : [];
        
        const getValue = (patterns: string[]) => {
          // Mode A: Search in 'properties' array
          for (const p of properties) {
             const name = p.property_name?.toLowerCase() || '';
             const label = p.label?.toLowerCase() || '';
             if (patterns.some(pattern => name.includes(pattern) || label.includes(pattern))) return p.value;
          }
          // Mode B: Search in top-level object keys (Isilon uses this)
          const allKeys = Object.keys(itemDetails);
          const foundKey = allKeys.find(k => patterns.some(pattern => k.toLowerCase().includes(pattern)));
          return foundKey ? itemDetails[foundKey] : undefined;
        };

        const serial = getValue(['guid', 'serial', 'sn', 'wwn', 'key', 'no', 'identifier']) || itemId;
        const ip = getValue(['ip_address', 'ip', 'addr', 'address', 'mgmt', 'host']) || '0.0.0.0';
        const model = getValue(['model', 'product', 'hardware', 'version', 'type']) || d.hw_type || 'Unknown';
        const hostname = getValue(['cluster_name', 'hostname', 'name', 'label', 'display']) || d.label || d.name || 'Unnamed';

        let vendor = d.vendor || d.manufacturer || 'Unknown';
        if (d.hw_type === 'isilon') vendor = 'Dell EMC';
        else if (d.hw_type?.toLowerCase().includes('huawei')) vendor = 'Huawei';
        else if (d.hw_type === 'pure') vendor = 'Pure Storage';
        else if (d.hw_type === 'netapp') vendor = 'NetApp';

        return {
          serial_number: String(serial),
          hostname: String(hostname),
          vendor_name: vendor,
          model_name: String(model),
          device_type: d.class || 'storage',
          ip_address: String(ip)
        };
      });
    } catch (error: any) {
      console.error(`[Xormon] Deep sync failed: ${error.message}`);
      throw new Error(`Xormon Deep Sync Failed: ${error.message}`);
    }
  }

  private extractItems(data: any): any[] {
    if (!data) return [];
    if (Array.isArray(data)) return data;
    if (data.data && Array.isArray(data.data)) return data.data;
    if (data.items && Array.isArray(data.items)) return data.items;
    
    // If it's an object with keys (ID-indexed), convert to array of values
    if (typeof data === 'object') {
       return Object.entries(data).map(([key, val]: [string, any]) => {
         if (typeof val === 'object' && val !== null) {
            return { item_id: key, ...val };
         }
         return val;
       }).filter(v => typeof v === 'object');
    }
    
    return [];
  }
}
