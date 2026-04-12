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
      console.log(`[Xormon] No static key found. Attempting login for ${this.config.username}...`);
      const response = await this.client.post('/api/public/v1/auth', {
        username: this.config.username,
        password: this.config.password
      });

      if (!response.data.apiKey) {
        throw new Error('Xormon authentication failed: No API Key returned');
      }

      this.apiKey = response.data.apiKey;
      return this.apiKey!;
    } catch (error: any) {
      console.error(`[Xormon] Auth failed: ${error.response?.data?.message || error.message}`);
      throw new Error(`Xormon Authentication Failed: ${error.message}`);
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
      
      const response = await this.client.get('/api/public/v1/inventory', {
        headers: { 'apiKey': key }
      });

      // Xormon typically returns an array of items under a data property or directly
      const items = Array.isArray(response.data) ? response.data : (response.data.items || []);

      return items.map((d: any) => ({
        serial_number: d.serial || d.serial_number || d.id,
        hostname: d.name || d.hostname,
        vendor_name: d.vendor || 'Unknown',
        model_name: d.model || 'Unknown',
        device_type: d.type || 'server',
        ip_address: d.ip || d.ip_address
      }));
    } catch (error: any) {
       console.error(`[Xormon] Sync failed: ${error.message}`);
       throw new Error(`Xormon Sync Failed: ${error.message}`);
    }
  }
}
