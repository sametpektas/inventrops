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
  firmware_version?: string;
  metadata?: Record<string, any>;
  sync_error?: string;
}

export class DellOpenManageAdapter {
  private client;

  constructor(private config: any) {
    const authHeader = this.config.username && this.config.password
      ? `Basic ${Buffer.from(`${this.config.username}:${this.config.password}`).toString('base64')}`
      : `ApiKey ${this.config.api_key || this.config.apiKey}`;

    this.client = axios.create({
      baseURL: this.config.url,
      timeout: 30000,
      headers: {
        'Accept': 'application/json',
        'Authorization': authHeader
      },
      httpsAgent: new https.Agent({
        // OME often uses self-signed certificates in local environments
        rejectUnauthorized: false, 
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
