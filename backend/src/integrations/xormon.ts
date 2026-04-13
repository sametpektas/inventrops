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
    console.log(`[Xormon] Syncing from ${this.config.url}...`);

    try {
      const key = await this.authenticate();
      const headers = { 'apiKey': key };

      // 1. Fetch Compute Devices
      console.log(`[Xormon] Fetching devices from /api/public/v1/architecture/devices...`);
      const devResponse = await this.client.get('/api/public/v1/architecture/devices', { headers });
      const devItems = this.extractItems(devResponse.data);

      // 2. Fetch Storage Systems (Isilon, etc.)
      console.log(`[Xormon] Fetching storage from /api/public/v1/architecture/storage...`);
      let storageItems: any[] = [];
      try {
        const storageResponse = await this.client.get('/api/public/v1/architecture/storage', { headers });
        storageItems = this.extractItems(storageResponse.data);
      } catch (e: any) {
        console.warn(`[Xormon] Storage fetch failed or not supported: ${e.message}`);
      }

      const allItems = [...devItems, ...storageItems];
      console.log(`[Xormon] Found total ${allItems.length} items (${devItems.length} devices, ${storageItems.length} storage).`);

      return allItems.map((d: any) => {
        // Advanced mapping for various Xormon device types (Isilon, etc.)
        const serial = d.serial || d.serial_number || d.serial_no || d.item_id || d.id || `XRM-${Date.now()}`;
        const name = d.label || d.name || d.hostname || d.display_name || 'Unnamed Device';
        
        let vendor = d.vendor || d.manufacturer || 'Unknown';
        if (d.hw_type === 'isilon') vendor = 'Dell EMC';
        else if (d.hw_type === 'pure') vendor = 'Pure Storage';
        else if (d.hw_type === 'netapp') vendor = 'NetApp';

        return {
          serial_number: serial,
          hostname: name,
          vendor_name: vendor,
          model_name: d.model || d.product || d.hw_type || 'Unknown',
          device_type: d.class || (storageItems.some((s: any) => s === d) ? 'storage' : 'server'),
          ip_address: d.ip || d.ip_address || d.management_ip || '0.0.0.0'
        };
      });
    } catch (error: any) {
      console.error(`[Xormon] Sync failed: ${error.message}`);
      throw new Error(`Xormon Sync Failed: ${error.message}`);
    }
  }

  private extractItems(data: any): any[] {
    if (Array.isArray(data)) return data;
    if (data.data && Array.isArray(data.data)) return data.data;
    if (data.items && Array.isArray(data.items)) return data.items;
    return [];
  }
}
