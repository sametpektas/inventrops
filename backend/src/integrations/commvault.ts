import axios, { AxiosInstance } from 'axios';
import https from 'https';
import { DiscoveredDevice } from './dell';

export interface CommvaultLibrary {
  libraryId: string;
  libraryName: string;
  isTape: boolean;
  assignedMediaCount?: number;
  spareMediaCount?: number;
  totalMediaCount?: number;
  capacityTotalGiB?: number;
  capacityUsedGiB?: number;
  capacityFreeGiB?: number;
  raw?: any;
}

export interface CommvaultSubclient {
  subclientId: string;
  subclientName: string;
  clientName: string;
  appName?: string;
  backupSizeGiB: number;
  lastBackupTime?: Date;
  raw?: any;
}

export class CommvaultAdapter {
  private client: AxiosInstance;
  private token: string | null = null;

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
    if (this.token) return this.token;

    try {
      console.log(`[Commvault] Authenticating with ${this.config.url}...`);
      
      const rawPassword = this.config.password || '';
      const base64Password = Buffer.from(rawPassword).toString('base64');
      
      // We try both Base64-encoded password (standard Commvault API requirement) and raw password, across common endpoints
      const endpoints = ['/Login', '/V4/Login', '/login'];
      const passwords = [base64Password, rawPassword];

      let response: any = null;
      let lastError: any = null;

      for (const endpoint of endpoints) {
        for (const pwd of passwords) {
          try {
            response = await this.client.post(endpoint, {
              username: this.config.username,
              password: pwd
            });
            if (response && (response.headers['authtoken'] || response.headers['Authtoken'] || response.data?.token || response.data?.authtoken || response.data?.tokenResponse?.token)) {
              break;
            }
          } catch (err: any) {
            lastError = err;
            const status = err.response?.status;
            // If 404 (endpoint not found) or 401/500 (auth error due to password format), continue trying next variation
            if (status === 404 || status === 401 || status === 500) {
              continue;
            }
            // If other unexpected error (e.g. timeout or network unreachable), break and throw
            throw err;
          }
        }
        if (response && (response.headers['authtoken'] || response.headers['Authtoken'] || response.data?.token || response.data?.authtoken || response.data?.tokenResponse?.token)) {
          break;
        }
      }

      if (!response) {
        throw lastError || new Error('Failed to reach Commvault login endpoint');
      }

      const token = response.headers['authtoken'] || response.headers['Authtoken'] || response.data?.token || response.data?.authtoken || response.data?.tokenResponse?.token;

      if (!token) {
        console.error(`[Commvault] Auth response:`, JSON.stringify(response.data).substring(0, 500));
        throw new Error('No authtoken found in Commvault login response');
      }

      this.token = token;
      console.log(`[Commvault] Authentication successful.`);
      return token;
    } catch (error: any) {
      const status = error.response?.status || 'N/A';
      const body = JSON.stringify(error.response?.data || {}).substring(0, 300);
      throw new Error(`Commvault Auth Failed (HTTP ${status}): ${error.message} | Body: ${body}`);
    }
  }

  private async getHeaders(): Promise<Record<string, string>> {
    const token = await this.authenticate();
    return {
      'Authtoken': token,
      'Accept': 'application/json'
    };
  }

  async testConnection(): Promise<boolean> {
    try {
      await this.authenticate();
      return true;
    } catch {
      return false;
    }
  }

  async getLibraries(): Promise<CommvaultLibrary[]> {
    try {
      const headers = await this.getHeaders();
      let response: any;
      try {
        response = await this.client.get('/Library', { headers });
      } catch (err: any) {
        if (err.response?.status === 404) {
          response = await this.client.get('/V4/Library', { headers });
        } else {
          throw err;
        }
      }
      const data = response.data || {};
      const rawList = Array.isArray(data)
        ? data
        : data.libraryInfoList || data.libraries || data.libraryList || data.librariesList || data.data || data.response || [];

      const itemsArray = Array.isArray(rawList) ? rawList : (rawList && typeof rawList === 'object' ? [rawList] : []);
      console.log(`[Commvault] getLibraries parsed ${itemsArray.length} raw library entries from keys:`, Object.keys(data));

      const result: CommvaultLibrary[] = [];
      for (const item of itemsArray) {
        const lib = item.library || item.libraryEntity || item.libraryInfo || item;
        const libId = String(lib.libraryId || lib.id || lib.LibraryId || '');
        if (!libId) continue;

        const libName = lib.libraryName || lib.name || lib.LibraryName || `Library-${libId}`;
        const isTape = Boolean(lib.isTapeLibrary || libName.toLowerCase().includes('tape') || lib.libraryType === 1);

        let assignedMediaCount = lib.assignedMediaCount !== undefined ? Number(lib.assignedMediaCount) : undefined;
        let spareMediaCount = lib.spareMediaCount !== undefined ? Number(lib.spareMediaCount) : undefined;
        let totalMediaCount = lib.totalMediaCount !== undefined ? Number(lib.totalMediaCount) : undefined;

        // If tape library and counts not in main summary, try fetching media or details
        if (isTape && (assignedMediaCount === undefined || spareMediaCount === undefined)) {
          try {
            const detailRes = await this.client.get(`/Library/${libId}`, { headers });
            const detailObj = detailRes.data?.libraryInfo || detailRes.data?.library || detailRes.data || {};
            assignedMediaCount = detailObj.assignedMediaCount !== undefined ? Number(detailObj.assignedMediaCount) : (assignedMediaCount || 0);
            spareMediaCount = detailObj.spareMediaCount !== undefined ? Number(detailObj.spareMediaCount) : (spareMediaCount || 0);
            totalMediaCount = assignedMediaCount + spareMediaCount;
          } catch (err: any) {
            console.warn(`[Commvault] Could not fetch details for tape library ${libName}: ${err.message}`);
          }
        }

        const capTotalBytes = Number(lib.capacityBytes || lib.totalCapacity || lib.capacity || 0);
        const capFreeBytes = Number(lib.freeSpaceBytes || lib.freeCapacity || lib.freeSpace || 0);
        const capUsedBytes = Number(lib.usedSpaceBytes || lib.usedCapacity || (capTotalBytes > capFreeBytes ? capTotalBytes - capFreeBytes : 0));

        const capacityTotalGiB = capTotalBytes ? capTotalBytes / (1024 * 1024 * 1024) : (lib.capacityTotalGiB || 0);
        const capacityFreeGiB = capFreeBytes ? capFreeBytes / (1024 * 1024 * 1024) : (lib.capacityFreeGiB || 0);
        const capacityUsedGiB = capUsedBytes ? capUsedBytes / (1024 * 1024 * 1024) : (lib.capacityUsedGiB || 0);

        result.push({
          libraryId: libId,
          libraryName: libName,
          isTape,
          assignedMediaCount,
          spareMediaCount,
          totalMediaCount,
          capacityTotalGiB,
          capacityUsedGiB,
          capacityFreeGiB,
          raw: lib
        });
      }
      return result;
    } catch (error: any) {
      console.warn(`[Commvault] getLibraries failed: ${error.message}`);
      return [];
    }
  }

  async getSubclients(): Promise<CommvaultSubclient[]> {
    try {
      const headers = await this.getHeaders();
      let response: any;
      try {
        response = await this.client.get('/Subclient', { headers });
      } catch (err: any) {
        if (err.response?.status === 404) {
          response = await this.client.get('/V4/Subclient', { headers });
        } else {
          throw err;
        }
      }
      const data = response.data || {};
      const rawList = Array.isArray(data)
        ? data
        : data.subclientProperties || data.subclientList || data.subClientList || data.subclients || data.data || data.response || [];

      const itemsArray = Array.isArray(rawList) ? rawList : (rawList && typeof rawList === 'object' ? [rawList] : []);
      console.log(`[Commvault] getSubclients parsed ${itemsArray.length} raw subclient entries from keys:`, Object.keys(data));

      const result: CommvaultSubclient[] = [];
      for (const item of itemsArray) {
        const sc = item.subclientEntity || item.subClientEntity || item.subclient || item.subClient || item;
        const subclientId = String(sc.subclientId || sc.id || sc.subClientId || '');
        if (!subclientId) continue;

        const subclientName = sc.subclientName || sc.name || sc.subClientName || `Subclient-${subclientId}`;
        const clientName = sc.clientName || sc.client?.name || sc.displayName || 'Unknown-Client';
        const appName = sc.appName || sc.instanceName || sc.agentName;

        const bytes = Number(item.applicationSize || item.backupSize || sc.applicationSize || sc.backupSize || 0);
        const backupSizeGiB = bytes > 0 ? bytes / (1024 * 1024 * 1024) : (Number(item.backupSizeGiB || sc.backupSizeGiB || 0));

        result.push({
          subclientId,
          subclientName,
          clientName,
          appName,
          backupSizeGiB,
          raw: item
        });
      }
      return result;
    } catch (error: any) {
      console.warn(`[Commvault] getSubclients failed: ${error.message}`);
      return [];
    }
  }

  async getSlaPercentage(): Promise<number | null> {
    try {
      const headers = await this.getHeaders();
      const response = await this.client.get('/Commserv/SLA', { headers }).catch(() => 
        this.client.get('/SLA', { headers })
      );
      const slaData = response.data?.slaInfo || response.data?.sla || response.data || {};
      const slaVal = parseFloat(String(slaData.slaPercentage || slaData.percentage || slaData.value || '0'));
      return !isNaN(slaVal) && slaVal > 0 ? slaVal : null;
    } catch (error: any) {
      console.warn(`[Commvault] getSlaPercentage failed: ${error.message}`);
      return null;
    }
  }

  async fetchInventory(): Promise<DiscoveredDevice[]> {
    console.log(`[Commvault] Starting inventory sync from ${this.config.url}...`);
    try {
      const libraries = await this.getLibraries();
      const devices: DiscoveredDevice[] = libraries.map(lib => ({
        serial_number: `commvault-lib-${lib.libraryId}`,
        hostname: lib.libraryName,
        vendor_name: 'Commvault',
        model_name: lib.isTape ? 'Tape Library' : 'Disk Library',
        device_type: 'backup',
        metadata: {
          commvault_id: lib.libraryId,
          is_tape: lib.isTape,
          assigned_media: lib.assignedMediaCount,
          spare_media: lib.spareMediaCount,
          total_media: lib.totalMediaCount,
          capacity_total: lib.capacityTotalGiB,
          capacity_used: lib.capacityUsedGiB,
          capacity_free: lib.capacityFreeGiB,
          sync_mode: 'full'
        }
      }));

      console.log(`[Commvault] Discovered ${devices.length} backup library items.`);
      return devices;
    } catch (error: any) {
      console.error(`[Commvault] Sync failed: ${error.message}`);
      throw error;
    }
  }
}
