import axios from 'axios';
import https from 'https';
import { sharedHttpsAgent } from '../utils/http';

// Inventory category types to look for in OME responses
const cpuTypes = ['serverProcessors', 'centralProcessor', 'Processors', 'processors', 'processor'];
const memTypes = ['serverMemoryDevices', 'memory', 'Memory', 'memoryDevices', 'MemoryDevices'];
const osTypes = ['serverOperatingSystems', 'operatingSystem', 'operatingSystemDetails', 'system', 'ServerOperatingSystem'];
const HYPERVISOR_KEYWORDS = ['vmware', 'esxi', 'esx', 'hyper-v', 'proxmox', 'xen server', 'vmdk', 'ovirt', 'citrix', 'hyperv', 'kvm', 'vsphere', 'vcenter'];

export interface DiscoveredDevice {
  serial_number: string;
  hostname?: string;
  vendor_name: string;
  model_name: string;
  device_type: string;
  ip_address?: string;
  asset_tag?: string;
  firmware_version?: string;
  operating_system?: string;
  cpu_model?: string;
  ram_gb?: number;
  purchase_date?: string;
  warranty_expiry?: string;
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
      httpsAgent: sharedHttpsAgent
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

      // Fetch Warranties
      let warrantyMap: Record<number, any> = {};
      try {
        const warrantyResponse = await this.client.get('/api/WarrantyService/Warranties');
        const warranties = warrantyResponse.data.value || (Array.isArray(warrantyResponse.data) ? warrantyResponse.data : []);
        warranties.forEach((w: any) => {
          // Store the latest warranty for each device
          if (!warrantyMap[w.DeviceId] || new Date(w.EndDate) > new Date(warrantyMap[w.DeviceId].EndDate)) {
            warrantyMap[w.DeviceId] = w;
          }
        });
      } catch (wErr) {
        console.warn('[Dell] Could not fetch warranty information.');
      }

      // Fetch CPU info per device (batch with limited concurrency to avoid overloading OME)
      const cpuMap: Record<number, { model?: string; ramMb?: number }> = {};
      // Fetch CPU/RAM/OS info per device in batches
      const BATCH_SIZE = 10;
      for (let i = 0; i < allDevices.length; i += BATCH_SIZE) {
        const batch = allDevices.slice(i, i + BATCH_SIZE);
        await Promise.all(batch.map(async (d: any) => {
          let cpuModel: string | undefined;
          let ramMb: number | undefined;
          let osName: string | undefined;

          // Fetch only the 3 types we actually need using the confirmed URL format
          const targets = [
            { type: 'serverProcessors', setter: (val: string) => cpuModel = val },
            { type: 'serverMemoryDevices', setter: (val: any) => ramMb = val },
            { type: 'serverOperatingSystems', setter: (val: string) => osName = val }
          ];

          for (const target of targets) {
            try {
              const res = await this.client.get(`/api/DeviceService/Devices(${d.Id})/InventoryDetails('${target.type}')`);
              const data = res.data;
              const items = data.InventoryInfo || data.InventoryDetails || (Array.isArray(data.value) ? data.value[0]?.InventoryInfo : null) || [];
              if (!items || items.length === 0) continue;

              if (target.type === 'serverProcessors') {
                const firstCpu = Array.isArray(items[0]) ? items[0][0] : items[0];
                const model = (firstCpu.ModelName || firstCpu.Model || firstCpu.BrandName || firstCpu.Brand || firstCpu.Name || firstCpu.ProcessorModel || '').toString().trim();
                if (model) target.setter(model);
              } else if (target.type === 'serverMemoryDevices') {
                const totalMb = items.reduce((sum: number, m: any) => {
                  let sizeStr = (m.Size || m.Capacity || m.MemorySize || '0').toString().toUpperCase();
                  let size = parseFloat(sizeStr);
                  if (sizeStr.includes('GB')) size *= 1024;
                  else if (sizeStr.includes('TB')) size *= 1024 * 1024;
                  return sum + (isNaN(size) ? 0 : size);
                }, 0);
                if (totalMb > 0) target.setter(totalMb);
              } else if (target.type === 'serverOperatingSystems') {
                const item = Array.isArray(items[0]) ? items[0][0] : items[0];
                const baseName = item.OsName || item.Description || item.Name || item.OperatingSystem || item.OperatingSystemName;
                const version = item.OsVersion || item.Version || item.OperatingSystemVersion;
                const fullOs = (baseName && version) ? `${baseName} ${version}`.trim() : (baseName || version);
                if (fullOs && fullOs !== 'Not Available' && fullOs !== 'Unknown') {
                  target.setter(fullOs);
                  console.log(`[Dell] Discovered OS for device ${d.Id}: ${fullOs}`);
                }
              }
            } catch (err) {
              // If specific type fails, we'll try the common fallbacks if we don't have data yet
            }
          }

          // Fallback logic for older OME versions or different endpoint names if needed
          if (!cpuModel || !ramMb || !osName) {
             // ... existing logic to find other types if essential ...
          }

          if (cpuModel || ramMb || osName) {
            cpuMap[d.Id] = { model: cpuModel, ramMb, os: osName } as any;
          }
        }));
      }

      return allDevices.map((d: any) => this.mapDevice(d, warrantyMap[d.Id], cpuMap[d.Id]));
    } catch (error: any) {
      console.error(`[Dell] Sync failed: ${error.message}`);
      if (error.response?.status === 401) {
        // Token might have expired, clear it for next attempt
        this.authToken = null;
      }
      throw error;
    }
  }

  private mapDevice(d: any, warranty?: any, cpuInfo?: { model?: string; ramMb?: number }): DiscoveredDevice {
    // Extract IP dynamically from nested structures if top-level is missing
    let ip = d.IpAddress || d.ManagementIp || d.RemoteAccessIp;
    if (!ip && Array.isArray(d.DeviceManagement) && d.DeviceManagement.length > 0) {
      ip = d.DeviceManagement[0].NetworkAddress || d.DeviceManagement[0].IpAddress;
    }

    // Separate Firmware and OS
    let firmware = d.FirmwareVersion;
    // OS priority: 1. Discovered from InventoryDetails, 2. Main Device summary fields
    let os = (cpuInfo as any)?.os || d.OsVersion || d.OSVersion || d.OperatingSystem;
    if (os === 'Not Available' || os === 'Unknown') {
      os = (cpuInfo as any)?.os || undefined;
    }
    
    if (!firmware && !os && Array.isArray(d.DeviceTypes) && d.DeviceTypes.length > 0) {
      firmware = d.DeviceTypes[0].FirmwareVersion || d.DeviceTypes[0].Version;
    }

    // Calculate RAM in GB from MB (round to nearest GB)
    const ramGb = cpuInfo?.ramMb ? Math.round(cpuInfo.ramMb / 1024) : undefined;

    // Extract metadata from OME response
    const metadata = {
      Id: d.Id,
      Type: d.Type,
      Status: d.Status,
      LastKnownIP: ip,
      AssetTag: d.AssetTag,
      GlobalStatus: d.Health,
      ServiceLevel: warranty?.ServiceLevelDescription
    };

    return {
      serial_number: d.SerialNumber || d.Identifier || d.ServiceTag || `DELL-UNKNOWN-${d.Id}`,
      hostname: d.Hostname || d.DeviceName,
      vendor_name: 'Dell EMC',
      model_name: d.Model || 'Dell Server',
      device_type: (d.DeviceType === 1000 || d.DeviceType === '1000' || String(d.DeviceTypeName).toLowerCase().includes('server')) ? 'server' : 'server',
      ip_address: ip,
      asset_tag: d.AssetTag,
      firmware_version: firmware,
      operating_system: os,
      cpu_model: cpuInfo?.model || d.ProcessorModel || d.ProcessorSummary || d.ProcessorType,
      ram_gb: ramGb || (d.MemoryMb ? Math.round(d.MemoryMb / 1024) : (d.TotalMemoryGb ? Math.round(d.TotalMemoryGb) : undefined)),
      purchase_date: warranty?.SystemShipDate ? new Date(warranty.SystemShipDate).toISOString().split('T')[0] : undefined,
      warranty_expiry: warranty?.EndDate ? new Date(warranty.EndDate).toISOString().split('T')[0] : undefined,
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
