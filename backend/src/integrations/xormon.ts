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

      let detailsRaw: any = [];
      try {
        const configResponse = await this.client.post('/api/public/v1/exporter/configuration', {
          uuids: uuids,
          format: 'json'
        }, { headers });
        detailsRaw = configResponse.data?.data || configResponse.data || [];
      } catch (err: any) {
        if (err.response?.status === 402) {
          console.warn(`[Xormon] Deep Configuration requires Enterprise License (402). Falling back to basic discovery...`);
        } else {
          console.warn(`[Xormon] Deep Configuration endpoint failed: ${err.message}. Proceeding with basic discovery.`);
        }
      }
      const detailsArray = this.extractItems(detailsRaw);

      console.log(`[Xormon DEBUG] Details search space: ${detailsArray.length} records. Target IDs: ${uuids.join(', ')}`);

      return items.map((d: any) => {
        const itemId = String(d.item_id || d.id);
        
        // Aggressive matching: Check itemId in root, id, or hostcfg_id
        let itemDetails = detailsArray.find((p: any) => 
            String(p.item_id || p.id || '') === itemId || 
            String(p.hostcfg_id || '') === itemId
        );
        
        // Secondary fallback: Map indexing if detailsRaw is an object
        if (!itemDetails && typeof detailsRaw === 'object' && detailsRaw !== null && !Array.isArray(detailsRaw)) {
            const rawItem = (detailsRaw as any).data ? (detailsRaw as any).data[itemId] : detailsRaw[itemId];
            if (rawItem) itemDetails = { item_id: itemId, ...(typeof rawItem === 'object' ? rawItem : {}) };
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
          // Inner function to scan for a SINGLE pattern at any depth
          const scanForPattern = (obj: any, pattern: string, depth: number = 0): any => {
            if (!obj || depth > 2) return undefined;
            const keys = Object.keys(obj);
            
            // 1. Check direct keys at this level
            const foundKey = keys.find(k => k.toLowerCase().includes(pattern.toLowerCase()));
            if (foundKey && typeof obj[foundKey] !== 'object') return obj[foundKey];

            // 2. Dive into sub-objects
            for (const key of ['configuration', 'config', 'details', 'data']) {
                if (obj[key]) {
                    let subObj = obj[key];
                    if (typeof subObj === 'string' && subObj.trim().startsWith('{')) {
                        try { subObj = JSON.parse(subObj); } catch(e) {}
                    }
                    if (typeof subObj === 'object') {
                        const val = scanForPattern(subObj, pattern, depth + 1);
                        if (val) return val;
                    }
                }
            }
            return undefined;
          };

          // Priority 1: Properties array (Xormon default style)
          for (const pattern of patterns) {
              for (const p of properties) {
                 const name = p.property_name?.toLowerCase() || '';
                 const label = p.label?.toLowerCase() || '';
                 if (name.includes(pattern) || label.includes(pattern)) {
                   console.log(`[Xormon] ${fieldLabel} matched via properties: ${name} = ${p.value}`);
                   return p.value;
                 }
              }
          }

          // Priority 2: Scan object/nested keys using pattern priority
          for (const pattern of patterns) {
              const val = scanForPattern(itemDetails, pattern);
              if (val) {
                  console.log(`[Xormon] ${fieldLabel} matched via deep scan (pattern: ${pattern}): ${val}`);
                  return val;
              }
          }
          return undefined;
        };

        const details = itemDetails.configuration || itemDetails.config || itemDetails || {};
        const hasDetails = Object.keys(details).length > 0;
        
        // 1. Direct Field Mapping (Highest Priority - based on user provided JSON)
        let serial = details.serial || details.id || details.serial_number;
        let ip = details.ip_address || details.mgmt_ip || details.ip;
        const model = details.model || details.model_name || getValue(['model', 'product', 'hardware'], 'Model');
        const hostname = details.node_name || details.label || d.label || getValue(['hostname', 'name', 'label'], 'Hostname');
        const firmware = details.version || details.patch_version;

        // 2. Heuristic Heuristic Fallback if direct fields are missing
        if (!serial) serial = getValue(['serial', 'sn', 'guid', 'uuid', 'id'], 'Serial');
        if (!ip) ip = getValue(['ip_address', 'ip', 'addr', 'host'], 'IP');

        // Cleanup: Handle multi-IP strings (take first or keep as is)
        if (typeof ip === 'string' && ip.includes(',')) {
          ip = ip.split(',')[0].trim();
        }


        if (!config || !config.configuration) {
          console.warn(`[Xormon] No deep configuration found for ${itemId} (${d.label}).`);
        }

        const conf = config?.configuration || {};
        
        // Extraction priority: configuration.serial > configuration.id > itemId
        const serial = String(conf.serial || conf.id || itemId);
        
        // IP Extraction: Handle comma-separated lists and prioritize configuration.ip_address
        let ip = "0.0.0.0";
        const rawIp = conf.ip_address || conf.ip || d.ip_address;
        if (rawIp && typeof rawIp === 'string') {
          ip = rawIp.split(',')[0].trim();
        }

        const result: DiscoveredDevice = {
          serial_number: serial,
          hostname: d.label,
          vendor_name: d.hw_vendor || (conf.model?.toLowerCase().includes('huawei') ? 'Huawei' : 
                       d.hw_type?.toLowerCase().includes('isilon') ? 'Dell EMC' : 'Generic Storage'),
          model_name: conf.model || d.hw_type || 'storage',
          device_type: 'storage',
          ip_address: ip === '0.0.0.0' ? undefined : ip,
          sync_error: !config ? 'Deep configuration could not be fetched for this device.' : undefined,
          metadata: {
            hw_type: d.hw_type,
            class: d.class,
            subsystem: d.subsystem,
            version: conf.version,
            wwn: conf.wwn,
            xormon_id: itemId
          }
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
