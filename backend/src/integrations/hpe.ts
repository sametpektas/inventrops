import axios from 'axios';
import https from 'https';
import { DiscoveredDevice } from './dell';

export class HPEOneViewAdapter {
  private client;
  private sessionID: string | null = null;
  private apiVersion: string;

  constructor(private config: any) {
    this.apiVersion = this.config.api_version || '1200';
    this.client = axios.create({
      baseURL: this.config.url,
      timeout: 30000,
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'X-Api-Version': this.apiVersion
      },
      httpsAgent: new https.Agent({
        rejectUnauthorized: false
      })
    });
  }

  private async login() {
    try {
      console.log(`[HPE] Authenticating with OneView at ${this.config.url}...`);
      const response = await this.client.post('/rest/login-sessions', {
        userName: this.config.username,
        password: this.config.password,
        loginMsgAck: true
      });

      this.sessionID = response.data.sessionID;
      if (!this.sessionID) throw new Error('Session ID not found in response');
      
      this.client.defaults.headers.common['auth'] = this.sessionID;
      return this.sessionID;
    } catch (err: any) {
      console.error(`[HPE] Login failed: ${err.message}`);
      throw new Error(`HPE OneView Auth Failed: ${err.message}`);
    }
  }

  async testConnection(): Promise<boolean> {
    try {
      await this.login();
      return true;
    } catch {
      return false;
    }
  }

  async fetchInventory(): Promise<DiscoveredDevice[]> {
    console.log(`[HPE] Syncing from OneView at ${this.config.url}...`);
    try {
      if (!this.sessionID) await this.login();

      // Fetch All Server Hardware (count=-1 ensures we bypass default pagination)
      const response = await this.client.get('/rest/server-hardware?count=-1');
      const members = response.data.members || [];
      
      console.log(`[HPE] Found ${members.length} members from OneView.`);

      return members.map((m: any) => this.mapDevice(m));
    } catch (error: any) {
      console.error(`[HPE] Sync failed: ${error.message}`);
      if (error.response?.status === 401) {
        this.sessionID = null;
      }
      throw error;
    }
  }

  private mapDevice(m: any): DiscoveredDevice {
    // OneView Server Hardware Mapping
    const metadata = {
      uri: m.uri,
      status: m.status,
      state: m.state,
      powerState: m.powerState,
      processorCount: m.processorCount,
      memoryMb: m.memoryMb,
      uuid: m.uuid
    };

    return {
      serial_number: m.serialNumber || m.uuid || `HPE-UNKNOWN-${m.uri.split('/').pop()}`,
      hostname: m.name,
      vendor_name: 'HPE',
      model_name: m.model || 'ProLiant Server',
      device_type: 'server',
      ip_address: m.shortName || (m.ipv4Address ? m.ipv4Address : undefined),
      firmware_version: m.romVersion,
      metadata: metadata
    };
  }
}
