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
            console.log(`[Xormon DEBUG] Raw Match Data Keys:`, Object.keys(itemDetails));
        }

        const properties = Array.isArray(itemDetails.properties) ? itemDetails.properties : [];
        
        const getValue = (patterns: string[], fieldLabel: string) => {
          // Priority 1: Properties array
          for (const p of properties) {
             const name = p.property_name?.toLowerCase() || '';
             const label = p.label?.toLowerCase() || '';
             if (patterns.some(pattern => name.includes(pattern) || label.includes(pattern))) {
               console.log(`[Xormon] ${fieldLabel} matched via properties array: ${name} = ${p.value}`);
               return p.value;
             }
          }

          // Priority 2: Direct or Nested object keys
          const scanObject = (obj: any, depth: number = 0): any => {
            if (!obj || depth > 2) return undefined;
            const keys = Object.keys(obj);
            
            // Try direct keys first at this level
            const foundKey = keys.find(k => patterns.some(pattern => k.toLowerCase().includes(pattern)));
            if (foundKey && typeof obj[foundKey] !== 'object') return obj[foundKey];

            // Special case: dive into 'configuration' or other likely sub-objects
            for (const key of ['configuration', 'config', 'details', 'data']) {
                if (obj[key]) {
                    let subObj = obj[key];
                    // Try to parse if it's a JSON string
                    if (typeof subObj === 'string' && subObj.trim().startsWith('{')) {
                        try { subObj = JSON.parse(subObj); } catch(e) {}
                    }
                    if (typeof subObj === 'object') {
                        const val = scanObject(subObj, depth + 1);
                        if (val) return val;
                    }
                }
            }
            return undefined;
          };

          const resultVal = scanObject(itemDetails);
          if (resultVal) {
              console.log(`[Xormon] ${fieldLabel} matched via scanning: ${resultVal}`);
              return resultVal;
          }
          return undefined;
        };

        const serial = getValue(['cluster_guid', 'guid', 'serial', 'sn', 'wwn', 'uuid', 'key', 'no'], 'Serial');
        const ip = getValue(['ip_address', 'ip', 'addr', 'address', 'mgmt', 'host'], 'IP');
        const model = getValue(['model', 'product', 'hardware', 'version', 'machine', 'type'], 'Model');
        const hostname = getValue(['cluster_name', 'hostname', 'name', 'label', 'display', 'title'], 'Hostname');

        let vendorStr = d.vendor || d.manufacturer || 'Dell EMC';
        if (d.hw_type === 'isilon') vendorStr = 'Dell EMC';
        else if (d.hw_type?.toLowerCase().includes('huawei')) vendorStr = 'Huawei';
        else if (d.hw_type === 'pure') vendorStr = 'Pure Storage';
        else if (d.hw_type === 'netapp') vendorStr = 'NetApp';
        else if (d.hw_type === 'vmware') vendorStr = 'VMware';

        const result = {
          serial_number: String(serial || itemId),
          hostname: String(hostname || d.label || d.name || 'Unnamed'),
          vendor_name: String(vendorStr),
          model_name: String(model || d.hw_type || 'Unknown'),
          device_type: String(d.class || 'storage'),
          ip_address: String(ip || '0.0.0.0')
        };
        
        console.log(`[Xormon] FINAL SYNC ITEM for ${itemId}:`, JSON.stringify(result, null, 2));
        return result;
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
