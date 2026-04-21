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
      timeout: 60000,
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

  private async fetchPaginated(endpoint: string, pageSize = 200): Promise<any[]> {
    try {
      const initialResponse = await this.client.get(`${endpoint}?$top=1`);
      const totalCount = initialResponse.data['@odata.count'] || 0;
      
      const pages = Math.ceil(totalCount / pageSize) || 1;
      let allItems: any[] = [];

      for (let i = 0; i < pages; i++) {
        const skip = i * pageSize;
        const response = await this.client.get(`${endpoint}?$top=${pageSize}&$skip=${skip}`);
        const pageItems = response.data.value || (Array.isArray(response.data) ? response.data : []);
        allItems = [...allItems, ...pageItems];
      }
      return allItems;
    } catch (err: any) {
      console.warn(`[Dell] Paginated fetch failed for ${endpoint}: ${err.message}`);
      return [];
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

  private sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async getDeviceList(): Promise<any[]> {
    if (!this.authToken) await this.login();
    return this.fetchPaginated('/api/DeviceService/Devices');
  }

  async getWarrantyMap(): Promise<Record<number, any>> {
    const allWarranties = await this.fetchPaginated('/api/WarrantyService/Warranties');
    const warrantyMap: Record<number, any> = {};
    allWarranties.forEach((w: any) => {
      if (!warrantyMap[w.DeviceId] || new Date(w.EndDate) > new Date(warrantyMap[w.DeviceId].EndDate)) {
        warrantyMap[w.DeviceId] = w;
      }
    });
    return warrantyMap;
  }

  async getDeviceDetails(d: any, warrantyMap?: Record<number, any>): Promise<DiscoveredDevice> {
    if (!this.authToken) await this.login();
    
    let cpuModel: string | undefined = undefined;
    let ramMb: number | undefined = undefined;
    let osName: string | undefined = undefined;

    const targets = [
      { type: 'serverProcessors', setter: (val: string) => cpuModel = val },
      { type: 'serverMemoryDevices', setter: (val: any) => ramMb = val },
      { type: 'serverOperatingSystems', setter: (val: string) => osName = val }
    ];

    for (const target of targets) {
      try {
        const res = await this.client.get(`/api/DeviceService/Devices(${d.Id})/InventoryDetails('${target.type}')`);
        const data = res.data;
        let items = data.InventoryInfo || data.InventoryDetails || (Array.isArray(data.value) ? data.value[0]?.InventoryInfo : null) || [];
        
        if (target.type === 'serverOperatingSystems' && (!items || items.length === 0)) {
          for (const fallbackType of osTypes) {
            if (fallbackType === 'serverOperatingSystems') continue;
            try {
              const fRes = await this.client.get(`/api/DeviceService/Devices(${d.Id})/InventoryDetails('${fallbackType}')`);
              const fd = fRes.data;
              const fItems = fd.InventoryInfo || fd.InventoryDetails || (Array.isArray(fd.value) ? fd.value[0]?.InventoryInfo : null) || [];
              if (fItems?.length > 0) { items = fItems; break; }
            } catch (e) {}
          }
        }

        if (!items || items.length === 0) continue;

        if (target.type === 'serverProcessors') {
          const firstCpu = Array.isArray(items[0]) ? items[0][0] : items[0];
          const m = (firstCpu.ModelName || firstCpu.Model || firstCpu.BrandName || firstCpu.Brand || firstCpu.Name || firstCpu.ProcessorModel || '').toString().trim();
          if (m) cpuModel = m;
        } else if (target.type === 'serverMemoryDevices') {
          ramMb = items.reduce((sum: number, m: any) => {
            let sizeStr = (m.Size || m.Capacity || m.MemorySize || '0').toString().toUpperCase();
            let size = parseFloat(sizeStr);
            if (sizeStr.includes('GB')) size *= 1024;
            else if (sizeStr.includes('TB')) size *= 1024 * 1024;
            return sum + (isNaN(size) ? 0 : size);
          }, 0);
        } else if (target.type === 'serverOperatingSystems') {
          const item = Array.isArray(items[0]) ? items[0][0] : items[0];
          const baseName = item.OsName || item.Description || item.Name || item.OperatingSystem || item.OperatingSystemName || item.MajorVersion;
          const version = item.OsVersion || item.Version || item.OperatingSystemVersion || item.MinorVersion;
          const fullOs = (baseName && version && baseName !== version) ? `${baseName} ${version}`.trim() : (baseName || version);
          if (fullOs && fullOs !== 'Not Available' && fullOs !== 'Unknown') osName = fullOs;
        }
      } catch (err) {}
    }

    return this.mapDevice(d, warrantyMap?.[d.Id], { model: cpuModel, ramMb, os: osName });
  }

  async fetchInventory(): Promise<DiscoveredDevice[]> {
    console.log(`[Dell] Legacy sequential sync started...`);
    try {
      const allDevices = await this.getDeviceList();
      const warrantyMap = await this.getWarrantyMap();
      const results: DiscoveredDevice[] = [];
      for (const d of allDevices) {
        const details = await this.getDeviceDetails(d, warrantyMap);
        results.push(details);
        await this.sleep(100);
      }
      return results;
    } catch (error: any) {
      console.error(`[Dell] Sync failed: ${error.message}`);
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

    // Service Tag extraction
      let serial = d.SerialNumber || d.Identifier || d.ServiceTag;
      if (!serial || serial === 'Not Available' || serial === 'Unknown') {
          // Try DeviceManagement nested SN
          if (Array.isArray(d.DeviceManagement) && d.DeviceManagement[0].DeviceServiceTag) {
              serial = d.DeviceManagement[0].DeviceServiceTag;
          }
      }
      // Ultimate fallback
      if (!serial || serial === 'Not Available' || serial === 'Unknown') {
          serial = `DELL-OME-${d.Id}`;
      }

      // Model extraction refinement
      let modelName = d.Model || 'Dell Server';
      if (modelName === 'System' || modelName === 'Chassis' || modelName === 'Unknown') {
          modelName = d.DeviceTypeName || modelName;
      }

      return {
        serial_number: String(serial).trim(),
        hostname: d.Hostname || d.DeviceName,
        vendor_name: 'Dell EMC',
        model_name: modelName,
        device_type: this.mapDeviceType(parseInt(d.DeviceType || '1000'), d.DeviceTypeName),
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
  
    private mapDeviceType(typeId: number, typeName?: string): string {
      const name = String(typeName || '').toLowerCase();
      
      // Explicit name matches first
      if (name.includes('server') || name.includes('blade') || name.includes('modular')) return 'server';
      if (name.includes('chassis') || name.includes('mx7000') || name.includes('m1000e')) return 'chassis';
      if (name.includes('storage') || name.includes('me4') || name.includes('powervault')) return 'storage';
      if (name.includes('switch') || name.includes('network') || name.includes('iom')) return 'network_switch';
  
      // Type ID mapping
      switch (typeId) {
        case 1000: case 17000: return 'server'; // 17000 is SLE (Server)
        case 2000: return 'chassis';
        case 3000: return 'storage';
        case 4000: return 'network_switch';
        case 5000: return 'ups';
        case 6000: return 'pdu';
        default: return 'infrastructure';
      }
    }
}
