import axios from 'axios';
import https from 'https';
import { sharedHttpsAgent } from '../utils/http';
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
      httpsAgent: sharedHttpsAgent
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

  async getDeviceList(): Promise<any[]> {
    if (!this.sessionID) await this.login();
    console.log(`[HPE] Fetching device list from ${this.config.url}...`);
    
    let members: any[] = [];
    let nextUri: string | null = '/rest/server-hardware';

    while (nextUri) {
      const response: any = await this.client.get(nextUri);
      const pageMembers = response.data.members || [];
      members = [...members, ...pageMembers];
      nextUri = response.data.nextPageUri || null;
    }
    return members;
  }

  async getDeviceDetails(summary: any): Promise<DiscoveredDevice> {
    if (!this.sessionID) await this.login();
    
    let m = summary;
    try {
      // Try to fetch full details for this specific hardware
      const res = await this.client.get(summary.uri);
      m = res.data;
    } catch (err) {
      // Fallback to summary if detail fetch fails
    }

    // Deep inspection for OS info - Prioritize rich strings over IDs
    const potentialOS = [
      m.operatingSystem, 
      m.OsName, 
      m.hostOs, 
      m.osName, 
      m.osVersion,
      m.mpHostInfo?.operatingSystem,
      m.mpHostInfo?.osName,
      m.mpHostInfo?.majorOsName,
      m.hostOsType
    ];

    let osRaw = potentialOS.find(val => val && typeof val === 'string' && val.length > 3);
    
    // Fallback to any truthy value if no long string found
    if (!osRaw) {
      osRaw = potentialOS.find(val => val !== undefined && val !== null);
    }

    let os = osRaw ? String(osRaw) : undefined;

    // IP extraction
    let ip = undefined;
    if (m.mpHostInfo && Array.isArray(m.mpHostInfo.mpIpAddresses) && m.mpHostInfo.mpIpAddresses.length > 0) {
      ip = m.mpHostInfo.mpIpAddresses[0].address;
    }
    ip = ip || m.ipv4Address || m.shortName;

    return {
      serial_number: m.serialNumber || m.uuid || `HPE-OME-${m.uri?.split('/').pop()}`,
      hostname: m.serverName || m.name,
      ip_address: ip,
      vendor_name: 'HPE',
      model_name: m.model || 'ProLiant Server',
      device_type: 'server',
      firmware_version: m.romVersion || m.mpFirmwareVersion || m.firmwareVersion,
      cpu_model: m.processorType || m.processorModel || undefined,
      ram_gb: m.memoryMb ? Math.round(m.memoryMb / 1024) : undefined,
      operating_system: os,
      metadata: {
        uri: m.uri,
        status: m.status,
        state: m.state,
        powerState: m.powerState,
        processorCount: m.processorCount,
        processorCoreCount: m.processorCoreCount,
        generation: m.generation,
        hostOsType: m.hostOsType,
        mpHostInfo: m.mpHostInfo
      }
    };
  }

  async fetchInventory(): Promise<DiscoveredDevice[]> {
    console.log(`[HPE] Start sequential sync...`);
    try {
      const members = await this.getDeviceList();
      const results: DiscoveredDevice[] = [];
      for (const m of members) {
        const details = await this.getDeviceDetails(m);
        results.push(details);
      }
      return results;
    } catch (error: any) {
      console.error(`[HPE] Sync failed: ${error.message}`);
      throw error;
    }
  }
}
