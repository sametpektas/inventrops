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

  private async authenticate(): Promise<string> {
    if (this.config.api_key) return this.config.api_key;
    if (this.apiKey) return this.apiKey;

    try {
      console.log(`[Xormon] Attempting login on ${this.config.url}/api/public/v1/auth...`);
      const response = await this.client.post('/api/public/v1/auth', {
        username: this.config.username,
        password: this.config.password
      });

      const dataObj = response.data.data || response.data;
      const key = dataObj.apiKey || dataObj.api_key || dataObj.apikey;

      if (!key) {
        throw new Error('Xormon authentication failed: No API Key found in response');
      }

      this.apiKey = key;
      return this.apiKey!;
    } catch (error: any) {
      const msg = error.response?.data?.message || error.message;
      throw new Error(`Xormon Authentication Failed: ${msg}`);
    }
  }

  async testConnection(): Promise<boolean> {
    try {
      await this.authenticate();
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

      const devResponse = await this.client.get('/api/public/v1/architecture/devices', { headers });
      const items = this.extractItems(devResponse.data);
      
      if (items.length === 0) return [];

      const uuids = items.map((i: any) => i.item_id || i.id).filter(Boolean);
      console.log(`[Xormon] Found ${items.length} items. Fetching detailed configuration...`);

      const configResponse = await this.client.post('/api/public/v1/exporter/configuration', {
        uuids: uuids,
        format: 'json'
      }, { headers });

      const detailsRaw = configResponse.data?.data || configResponse.data || [];
      const detailsArray = this.extractItems(detailsRaw);

      console.log(`[Xormon DEBUG] Details search space: ${detailsArray.length} records. Target IDs: ${uuids.join(', ')}`);

      return items.map((d: any) => {
        const itemId = String(d.item_id || d.id);
        
        let itemDetails = detailsArray.find((p: any) => String(p.item_id || p.id) === itemId);
        
        if (!itemDetails && typeof detailsRaw === 'object' && detailsRaw !== null && !Array.isArray(detailsRaw)) {
            const rawItem = detailsRaw[itemId];
            if (rawItem) itemDetails = { item_id: itemId, ...rawItem };
        }

        if (!itemDetails && items.length === 1 && detailsArray.length === 1) {
            console.log(`[Xormon DEBUG] Emergency fallback triggered for ${itemId}`);
            itemDetails = detailsArray[0];
        }

        itemDetails = itemDetails || {};
        if (Object.keys(itemDetails).length > 0) {
            console.log(`[Xormon DEBUG] DATA MATCHED for ${itemId}`);
        }

        const properties = Array.isArray(itemDetails.properties) ? itemDetails.properties : [];
        
        const getValue = (patterns: string[]) => {
          for (const p of properties) {
             const name = p.property_name?.toLowerCase() || '';
             const label = p.label?.toLowerCase() || '';
             if (patterns.some(pattern => name.includes(pattern) || label.includes(pattern))) return p.value;
          }
          const allKeys = Object.keys(itemDetails);
          const foundKey = allKeys.find(k => patterns.some(pattern => k.toLowerCase().includes(pattern)));
          return foundKey ? itemDetails[foundKey] : undefined;
        };

        const serial = getValue(['guid', 'serial', 'sn', 'wwn', 'uuid', 'key', 'no', 'identifier']) || itemId;
        const ip = getValue(['ip_address', 'ip', 'addr', 'address', 'mgmt', 'host']) || '0.0.0.0';
        const model = getValue(['model', 'product', 'hardware', 'version', 'type']) || d.hw_type || 'Unknown';
        const hostname = getValue(['cluster_name', 'hostname', 'name', 'label', 'display']) || d.label || d.name || 'Unnamed';

        return {
          serial_number: String(serial),
          hostname: String(hostname),
          vendor_name: String(d.vendor || d.manufacturer || 'Dell EMC'),
          model_name: String(model),
          device_type: String(d.class || 'storage'),
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
    
    if (typeof data === 'object' && data !== null) {
       return Object.entries(data).map(([key, val]: [string, any]) => {
         if (typeof val === 'object' && val !== null) {
            return { item_id: key, ...val };
         }
         return val;
       }).filter(v => typeof v === 'object' && v !== null);
    }
    
    return [];
  }
}
