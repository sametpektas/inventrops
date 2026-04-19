import axios, { AxiosInstance } from 'axios';
import https from 'https';
import { DiscoveredDevice } from './dell';

export class XormonAdapter {
  private client: AxiosInstance;
  private apiKey: string | null = null;

  constructor(private config: any) {
    this.client = axios.create({
      baseURL: this.config.url,
      timeout: 60000,
      httpsAgent: new https.Agent({
        rejectUnauthorized: false
      }),
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    });
  }

  private async authenticate(): Promise<string> {
    if (this.config.api_key) return this.config.api_key;
    if (this.apiKey) return this.apiKey;

    try {
      console.log(`[Xormon] Authenticating with ${this.config.url}...`);
      const response = await this.client.post('/api/public/v1/auth', {
        username: this.config.username,
        password: this.config.password
      });

      const dataObj = response.data?.data || response.data;
      const key = dataObj?.apiKey || dataObj?.api_key || dataObj?.apikey;

      if (!key) {
        console.error(`[Xormon] Auth response structure:`, JSON.stringify(response.data).substring(0, 500));
        throw new Error('No API Key found in auth response');
      }

      this.apiKey = key;
      console.log(`[Xormon] Authentication successful.`);
      return key;
    } catch (error: any) {
      const status = error.response?.status || 'N/A';
      const body = JSON.stringify(error.response?.data || {}).substring(0, 300);
      throw new Error(`Xormon Auth Failed (HTTP ${status}): ${error.message} | Body: ${body}`);
    }
  }

  async testConnection(): Promise<boolean> {
    try {
      await this.authenticate();
      return true;
    } catch {
      return false;
    }
  }

  async fetchInventory(): Promise<DiscoveredDevice[]> {
    console.log(`[Xormon] Starting inventory sync from ${this.config.url}...`);

    try {
      const key = await this.authenticate();
      const headers = {
        'apiKey': key,
        'X-API-KEY': key,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      };

      // === STEP 1: Get List of Devices ===
      const devResponse = await this.client.get('/api/public/v1/architecture/devices', { headers });
      const devices = this.extractItems(devResponse.data);

      if (devices.length === 0) {
        console.log(`[Xormon] No devices found.`);
        return [];
      }

      const uuids = devices.map((d: any) => d.item_id || d.id).filter(Boolean);
      console.log(`[Xormon] Found ${devices.length} devices. UUIDs: ${uuids.length}`);

      // === STEP 2: Fetch Deep Configurations one by one (Xormon API fails on chunks) ===
      const chunkSize = 1;
      let allConfigs: any[] = [];

      for (let i = 0; i < uuids.length; i += chunkSize) {
        const chunk = uuids.slice(i, i + chunkSize);
        const chunkNum = Math.floor(i / chunkSize) + 1;

        try {
          console.log(`[Xormon] Fetching config chunk ${chunkNum} (${chunk.length} UUIDs)...`);

          const configResponse = await this.client.post(
            '/api/public/v1/exporter/configuration',
            { uuids: chunk, format: 'json' },
            { headers }
          );

          // VERBOSE DEBUG: Log exactly what the API returns
          const rawData = configResponse.data;
          const rawType = typeof rawData;
          const isArr = Array.isArray(rawData);

          console.log(`[Xormon] Chunk ${chunkNum} response → type: ${rawType}, isArray: ${isArr}, status: ${configResponse.status}`);

          if (isArr) {
            console.log(`[Xormon] Chunk ${chunkNum} returned ${rawData.length} items directly as array.`);
            allConfigs = [...allConfigs, ...rawData];
          } else if (rawData && typeof rawData === 'object') {
            // Try to extract nested data
            const nested = rawData.data || rawData.items || rawData.results;
            if (Array.isArray(nested)) {
              console.log(`[Xormon] Chunk ${chunkNum} returned ${nested.length} items via nested key.`);
              allConfigs = [...allConfigs, ...nested];
            } else {
              // Maybe it's a keyed object { uuid: config, uuid: config }
              const keys = Object.keys(rawData);
              console.log(`[Xormon] Chunk ${chunkNum} returned object with keys: ${keys.slice(0, 5).join(', ')}...`);
              const items = keys.map(k => {
                const val = rawData[k];
                if (typeof val === 'object' && val !== null) {
                  return { item_id: k, ...val };
                }
                return null;
              }).filter(Boolean);
              allConfigs = [...allConfigs, ...items];
            }
          } else {
            console.warn(`[Xormon] Chunk ${chunkNum} returned unexpected data: ${JSON.stringify(rawData).substring(0, 200)}`);
          }
        } catch (err: any) {
          const status = err.response?.status || 'N/A';
          const errBody = JSON.stringify(err.response?.data || {}).substring(0, 300);
          console.error(`[Xormon] Chunk ${chunkNum} FAILED (HTTP ${status}): ${err.message} | Body: ${errBody}`);
        }
      }

      console.log(`[Xormon] Total configurations retrieved: ${allConfigs.length} / ${uuids.length} devices`);

      // === STEP 3: Map Device + Configuration ===
      return devices.map((d: any) => {
        const itemId = String(d.item_id || d.id || '');
        const label = String(d.label || d.hostname || '');

        // Match: item_id or label (case-insensitive)
        const configEntry = allConfigs.find((c: any) => {
          const cId = String(c.item_id || '');
          const cLabel = String(c.label || '');
          return (cId.toLowerCase() === itemId.toLowerCase() && itemId !== '') ||
                 (cLabel.toLowerCase() === label.toLowerCase() && label !== '');
        });

        const conf = configEntry?.configuration || configEntry?.config || {};
        const hasConfig = !!configEntry && Object.keys(conf).length > 0;

        // Extract fields from configuration (matching real Xormon API response structure)
        const serial = conf.serial || conf.id || itemId;
        const hostname = conf.node_name || conf.cluster_name || conf.machine_name || conf.chassis_name || conf.name || label;
        const model = conf.model || conf.product_name || d.hw_type || 'Unknown';
        const version = conf.version || conf.patch_version;

        // IP extraction: handle comma-separated IPs
        let ip = conf.ip_address || conf.mgmt_ip || conf.ctla || d.ip_address || '0.0.0.0';
        if (typeof ip === 'string' && ip.includes(',')) {
          ip = ip.split(',')[0].trim();
        }

        // Vendor heuristic based on hw_type and model
        let vendor = d.hw_vendor || 'Unknown';
        let finalModel = String(model);
        let finalHostname = String(hostname);
        const hwType = String(d.hw_type || '').toLowerCase();
        const modelLower = String(model).toLowerCase();

        if (hwType === 'isilon') vendor = 'Dell EMC';
        else if (hwType === 'oceanstor' || hwType === 'oceanstorpacific' || modelLower.includes('oceanstor')) vendor = 'Huawei';
        else if (hwType === 'pure' || hwType === 'pureblade' || modelLower.includes('flashblade') || modelLower.includes('purestorage')) vendor = 'Pure Storage';
        else if (hwType === 'netapp') vendor = 'NetApp';
        else if (hwType === 'sanbrcd' || modelLower.includes('brocade')) vendor = 'Brocade';
        else if (hwType === 'vmware') vendor = 'VMware';
        else if (hwType === 'commvault') vendor = 'Commvault';
        else if (hwType === 'swiz') {
          vendor = 'IBM';
          // Use product_name if available (e.g., "IBM FlashSystem 7200" -> "FlashSystem 7200"), else fallback to "Flashsystem"
          finalModel = conf.product_name ? String(conf.product_name).replace(/^IBM\s+/i, '') : 'Flashsystem';
          // IBM nodes often report "node1, node2" for node_name, so we force label or machine_name
          finalHostname = String(label || conf.machine_name || hostname);
        }
        else if (modelLower.includes('ibm') || modelLower.includes('flashsystem')) vendor = 'IBM';
        else if (modelLower.includes('hitachi') || modelLower.includes('vsp')) vendor = 'Hitachi';

        // Device type from class field
        const deviceType = d.class || 'storage';

        const result: DiscoveredDevice = {
          serial_number: String(serial),
          hostname: finalHostname,
          vendor_name: vendor,
          model_name: finalModel,
          device_type: deviceType,
          ip_address: (ip === '0.0.0.0' || !ip) ? undefined : String(ip),
          firmware_version: version ? String(version) : undefined,
          sync_error: !hasConfig ? 'Deep configuration could not be fetched.' : undefined,
          metadata: {
            hw_type: d.hw_type,
            xormon_id: itemId,
            wwn: conf.wwn,
            capacity_total: conf.capacity_total,
            health_status: conf.health_status || conf.running_status,
            sync_mode: hasConfig ? 'full' : 'basic'
          }
        };

        console.log(`[Xormon] ${hostname} → SN: ${serial}, IP: ${ip}, Vendor: ${vendor}, Config: ${hasConfig ? 'YES' : 'NO'}`);
        return result;
      });

    } catch (error: any) {
      console.error(`[Xormon] Sync failed: ${error.message}`);
      throw error;
    }
  }

  private extractItems(data: any): any[] {
    if (!data) return [];
    if (Array.isArray(data)) return data;
    const body = data.data || data.items || data.members;
    if (Array.isArray(body)) return body;
    if (body && typeof body === 'object') {
      return Object.entries(body).map(([key, val]: [string, any]) => {
        if (typeof val === 'object' && val !== null) return { item_id: key, ...val };
        return { item_id: key, _value: val };
      });
    }
    return [];
  }
}
