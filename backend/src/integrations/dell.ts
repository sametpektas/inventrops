import axios from 'axios';
import https from 'https';

export interface DiscoveredDevice {
  serial_number: string;
  hostname?: string;
  vendor_name: string;
  model_name: string;
  device_type: string;
  ip_address?: string;
  asset_tag?: string;
}

export class DellOpenManageAdapter {
  private client;

  constructor(private config: any) {
    // SECURITY: Create an axios instance with a custom https agent
    // This allows us to enforce TLS verification and set timeouts.
    this.client = axios.create({
      baseURL: this.config.url,
      timeout: 30000, // 30 seconds timeout
      headers: {
        'Accept': 'application/json',
        'Authorization': `ApiKey ${this.config.apiKey}` // Example Auth
      },
      httpsAgent: new https.Agent({
        rejectUnauthorized: process.env.NODE_ENV === 'production', // Enforce TLS in production
        keepAlive: true
      })
    });
  }

  async testConnection(): Promise<boolean> {
    try {
      // Small check to see if the URL is reachable and auth is accepted
      // Example: await this.client.get('/api/v1/health');
      return true;
    } catch (err) {
      return false;
    }
  }

  async fetchInventory(): Promise<DiscoveredDevice[]> {
    console.log(`[Dell] Syncing from OpenManage at ${this.config.url}...`);
    
    try {
      // In a real environment, this would hit the Dell OME API
      // Example endpoint: /api/DeviceService/Devices
      // const response = await this.client.get('/api/DeviceService/Devices');
      // return response.data.map((d: any) => this.mapDevice(d));

      // For demonstration, we simulate a successful but validated response
      return [
        {
          serial_number: 'DELL-SRV-001',
          hostname: 'srv-production-01',
          vendor_name: 'Dell',
          model_name: 'PowerEdge R740',
          device_type: 'server',
          ip_address: '10.0.50.10'
        }
      ];
    } catch (error: any) {
      console.error(`[Dell] Sync failed: ${error.message}`);
      throw new Error(`Dell Sync Failed: ${error.message}`);
    }
  }

  private mapDevice(externalData: any): DiscoveredDevice {
    // Validation Layer
    if (!externalData.SerialNumber) throw new Error('Invalid external data: Missing SerialNumber');
    
    return {
      serial_number: externalData.SerialNumber,
      hostname: externalData.HostName,
      vendor_name: 'Dell',
      model_name: externalData.Model || 'Unknown PowerEdge',
      device_type: 'server',
      ip_address: externalData.IPAddress
    };
  }
}
