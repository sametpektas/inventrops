import axios from 'axios';
import https from 'https';
import { DiscoveredDevice } from './dell';

export class HPEOneViewAdapter {
  private client;

  constructor(private config: any) {
    this.client = axios.create({
      baseURL: this.config.url,
      timeout: 30000,
      headers: {
        'X-API-Version': '1200',
        'auth': this.config.token
      },
      httpsAgent: new https.Agent({
        rejectUnauthorized: process.env.NODE_ENV === 'production'
      })
    });
  }

  async fetchInventory(): Promise<DiscoveredDevice[]> {
    console.log(`[HPE] Syncing from OneView at ${this.config.url}...`);
    try {
      // In a real environment: await this.client.get('/rest/server-hardware');
      return [
        {
          serial_number: 'HPE-SRV-999',
          hostname: 'hpe-proliant-gen10-01',
          vendor_name: 'HPE',
          model_name: 'ProLiant DL380 Gen10',
          device_type: 'server',
          ip_address: '192.168.20.100'
        }
      ];
    } catch (error: any) {
      console.error(`[HPE] Sync failed: ${error.message}`);
      throw new Error(`HPE Sync Failed: ${error.message}`);
    }
  }
}
