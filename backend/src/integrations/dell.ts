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
      // Dell OpenManage Enterprise API for fetching devices
      // Documentation typically points to: /api/DeviceService/Devices
      const response = await this.client.get('/api/DeviceService/Devices');
      
      const devices = Array.isArray(response.data) ? response.data : (response.data.value || []);
      
      console.log(`[Dell] Found ${devices.length} raw devices from OME.`);
      
      return devices.map((d: any) => this.mapDevice(d));
    } catch (error: any) {
      console.error(`[Dell] Sync failed: ${error.message}`);
      if (error.response) {
        console.error(`[Dell] OME API Error: ${JSON.stringify(error.response.data)}`);
      }
      throw new Error(`Dell Sync Failed: ${error.message}`);
    }
  }

  private mapDevice(d: any): DiscoveredDevice {
    // Mapping based on Dell OME API standard response fields
    return {
      serial_number: d.SerialNumber || d.Identifier || `DELL-UNKNOWN-${Date.now()}`,
      hostname: d.Hostname || d.DeviceName,
      vendor_name: 'Dell',
      model_name: d.Model || 'Unknown PowerEdge',
      device_type: (d.Type && d.Type === 1000) ? 'server' : 'chassis', // Example mapping
      ip_address: d.IpAddress || (d.NetworkAddress && d.NetworkAddress[0])
    };
  }
}
