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
  private authToken: string | null = null;

  constructor(private config: any) {
    this.client = axios.create({
      baseURL: this.config.url,
      timeout: 30000,
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      httpsAgent: new https.Agent({
        rejectUnauthorized: false, 
        keepAlive: true
      })
    });
  }

  private async login(): Promise<string> {
    try {
      const response = await this.client.post('/api/SessionService/Sessions', {
        UserName: this.config.username,
        Password: this.config.password,
        SessionType: 'API'
      });

      const token = response.headers['x-auth-token'];
      if (!token) throw new Error('X-Auth-Token not found in login response');
      
      this.authToken = token;
      this.client.defaults.headers.common['X-Auth-Token'] = token;
      return token;
    } catch (err: any) {
      console.error(`[Dell] Authentication failed: ${err.message}`);
      throw new Error(`Dell OME Auth Failed: ${err.message}`);
    }
  }

  async testConnection(): Promise<boolean> {
    try {
      await this.login();
      return true;
    } catch (err) {
      return false;
    }
  }

  async fetchInventory(): Promise<DiscoveredDevice[]> {
    console.log(`[Dell] Syncing from OpenManage at ${this.config.url}...`);
    
    try {
      if (!this.authToken) await this.login();

      // First check the total count
      const initialResponse = await this.client.get('/api/DeviceService/Devices?$top=1');
      const totalCount = initialResponse.data['@odata.count'] || 0;
      
      const pageSize = 200;
      const pages = Math.ceil(totalCount / pageSize) || 1;
      let allDevices: any[] = [];

      for (let i = 0; i < pages; i++) {
        const skip = i * pageSize;
        const response = await this.client.get(`/api/DeviceService/Devices?$top=${pageSize}&$skip=${skip}`);
        const pageDevices = response.data.value || (Array.isArray(response.data) ? response.data : []);
        allDevices = [...allDevices, ...pageDevices];
      }

      console.log(`[Dell] Found ${allDevices.length} devices from OME (Total: ${totalCount}).`);
      
      return allDevices.map((d: any) => this.mapDevice(d));
    } catch (error: any) {
      console.error(`[Dell] Sync failed: ${error.message}`);
      if (error.response?.status === 401) {
        // Token might have expired, clear it for next attempt
        this.authToken = null;
      }
      throw error;
    }
  }

  private mapDevice(d: any): DiscoveredDevice {
    // Extract metadata from OME response
    const metadata = {
      Id: d.Id,
      Type: d.Type,
      Status: d.Status,
      LastKnownIP: d.IpAddress,
      AssetTag: d.AssetTag,
      GlobalStatus: d.Health
    };

    return {
      serial_number: d.SerialNumber || d.Identifier || `DELL-UNKNOWN-${d.Id}`,
      hostname: d.Hostname || d.DeviceName,
      vendor_name: 'Dell',
      model_name: d.Model || 'Generic Dell Device',
      device_type: this.mapDeviceType(d.Type),
      ip_address: d.IpAddress,
      asset_tag: d.AssetTag,
      firmware_version: d.FirmwareVersion,
      metadata: metadata
    };
  }

  private mapDeviceType(typeId: number): string {
    // OME Device Type Mapping (Common ones)
    switch (typeId) {
      case 1000: return 'server';
      case 2000: return 'chassis';
      case 3000: return 'storage';
      case 4000: return 'network';
      default: return 'infrastructure';
    }
  }
}
