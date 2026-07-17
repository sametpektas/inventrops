import axios, { AxiosInstance } from 'axios';
import https from 'https';
import { DiscoveredDevice } from './dell';
import { prisma } from '../lib/prisma';

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
      const endpointsToTry = [
        { path: '/V4/Storage/Tape', isTapeHint: true },
        { path: '/Storage/Tape', isTapeHint: true },
        { path: '/V4/Storage/Disk', isTapeHint: false },
        { path: '/Storage/Disk', isTapeHint: false },
        { path: '/Library', isTapeHint: false },
        { path: '/V4/Library', isTapeHint: false }
      ];

      const resultMap = new Map<string, CommvaultLibrary>();

      for (const ep of endpointsToTry) {
        try {
          const response = await this.client.get(ep.path, { headers });
          const data = response.data || {};
          const rawList = Array.isArray(data)
            ? data
            : data.tapeStorageList || data.diskStorageList || data.storageList || data.libraryInfoList || data.libraries || data.libraryList || data.librariesList || data.response || data.data || [];

          const itemsArray = Array.isArray(rawList) ? rawList : (rawList && typeof rawList === 'object' ? [rawList] : []);
          console.log(`[Commvault] Endpoint ${ep.path} returned ${itemsArray.length} items. Keys:`, Object.keys(data));

          for (const item of itemsArray) {
            const lib = item.library || item.libraryEntity || item.libraryInfo || item.entityInfo || item.tapeStorage || item.diskStorage || item;
            const libId = String(lib.libraryId || lib.id || lib.LibraryId || lib.entityId || lib.tapeStorageId || lib.diskStorageId || lib.storageId || item.libraryId || item.id || item.LibraryId || item.entityInfo?.id || item.entityInfo?.libraryId || item.library?.id || item.library?.libraryId || '');
            if (!libId) {
              console.warn(`[Commvault] Skipping item with missing ID from ${ep.path}. Keys:`, Object.keys(item), `Sample:`, JSON.stringify(item).substring(0, 300));
              continue;
            }

            if (resultMap.has(libId)) continue; // Already processed

            const libName = lib.libraryName || lib.name || lib.LibraryName || lib.displayName || lib.tapeStorageName || lib.diskStorageName || lib.storageName || item.libraryName || item.name || item.LibraryName || item.displayName || item.entityInfo?.name || item.entityInfo?.displayName || item.library?.libraryName || item.library?.name || `Library-${libId}`;
            const isTape = Boolean(ep.isTapeHint || lib.isTapeLibrary || libName.toLowerCase().includes('tape') || libName.toLowerCase().includes('msl') || libName.toLowerCase().includes('ts4') || libName.toLowerCase().includes('ts3') || libName.toLowerCase().includes('quantum') || libName.toLowerCase().includes('scalar') || lib.libraryType === 1 || String(lib.libraryType).toLowerCase().includes('tape'));

            let assignedMediaCount = lib.assignedMediaCount !== undefined ? Number(lib.assignedMediaCount) : (lib.assignedMedia !== undefined ? Number(lib.assignedMedia) : (lib.numOfAssignedMedia !== undefined ? Number(lib.numOfAssignedMedia) : undefined));
            let spareMediaCount = lib.spareMediaCount !== undefined ? Number(lib.spareMediaCount) : (lib.spareMedia !== undefined ? Number(lib.spareMedia) : (lib.numOfSpareMediaInLib !== undefined ? Number(lib.numOfSpareMediaInLib) : undefined));
            let totalMediaCount = lib.totalMediaCount !== undefined ? Number(lib.totalMediaCount) : (lib.totalMedia !== undefined ? Number(lib.totalMedia) : undefined);

            let capTotalBytes = Number(lib.capacityBytes || lib.totalCapacity || lib.capacity || lib.totalCapacityBytes || lib.diskCapacity || lib.totalSpace || 0);
            let capFreeBytes = Number(lib.freeSpaceBytes || lib.freeCapacity || lib.freeSpace || lib.availableSpace || 0);
            let capUsedBytes = Number(lib.usedSpaceBytes || lib.usedCapacity || lib.consumedSpace || (capTotalBytes > capFreeBytes ? capTotalBytes - capFreeBytes : 0));

            // ALWAYS try fetching library details from /Library/{id} or /V4/Storage/Tape/{id}
            try {
              const detailEndpoints = [
                `/Library/${libId}`,
                `/V4/Library/${libId}`,
                `/V4/Storage/Tape/${libId}`,
                `/Storage/Tape/${libId}`,
                `/V4/Storage/Disk/${libId}`,
                `/Storage/Disk/${libId}`
              ];

              for (const dEp of detailEndpoints) {
                try {
                  const detailRes = await this.client.get(dEp, { headers });
                  const detailObj = detailRes.data?.libraryInfo || detailRes.data?.library || detailRes.data?.tapeStorage || detailRes.data?.diskStorage || detailRes.data || {};

                  if (Object.keys(detailObj).length > 0) {
                    if (detailObj.numOfAssignedMedia !== undefined || detailObj.assignedMediaCount !== undefined || detailObj.assignedMedia !== undefined) {
                      assignedMediaCount = detailObj.numOfAssignedMedia !== undefined ? Number(detailObj.numOfAssignedMedia) : (detailObj.assignedMediaCount !== undefined ? Number(detailObj.assignedMediaCount) : Number(detailObj.assignedMedia));
                    }
                    if (detailObj.numOfSpareMediaInLib !== undefined || detailObj.spareMediaCount !== undefined || detailObj.spareMedia !== undefined) {
                      spareMediaCount = detailObj.numOfSpareMediaInLib !== undefined ? Number(detailObj.numOfSpareMediaInLib) : (detailObj.spareMediaCount !== undefined ? Number(detailObj.spareMediaCount) : Number(detailObj.spareMedia));
                    }
                    if (assignedMediaCount !== undefined && spareMediaCount !== undefined) {
                      totalMediaCount = assignedMediaCount + spareMediaCount;
                    }

                    const dTotal = Number(detailObj.capacityBytes || detailObj.totalCapacity || detailObj.capacity || detailObj.totalCapacityBytes || detailObj.diskCapacity || detailObj.totalSpace || 0);
                    const dFree = Number(detailObj.freeSpaceBytes || detailObj.freeCapacity || detailObj.freeSpace || detailObj.availableSpace || 0);
                    const dUsed = Number(detailObj.usedSpaceBytes || detailObj.usedCapacity || detailObj.consumedSpace || (dTotal > dFree ? dTotal - dFree : 0));

                    if (dTotal > capTotalBytes) capTotalBytes = dTotal;
                    if (dFree > capFreeBytes) capFreeBytes = dFree;
                    if (dUsed > capUsedBytes) capUsedBytes = dUsed;

                    break;
                  }
                } catch {
                  continue;
                }
              }
            } catch (err: any) {
              console.warn(`[Commvault] Could not fetch detail endpoints for library ${libName}: ${err.message}`);
            }

            // If tape library, try fetching media from /V4/Storage/Tape/{id}/Media or /Library/{id}/Media if counts still undefined/0
            if (isTape || assignedMediaCount !== undefined || spareMediaCount !== undefined || libName.toLowerCase().includes('tape') || libName.toLowerCase().includes('lib')) {
              if (assignedMediaCount === undefined || spareMediaCount === undefined || (assignedMediaCount === 0 && spareMediaCount === 0 && isTape)) {
                try {
                  const mediaEndpoints = [
                    `/V4/Storage/Tape/${libId}/Media`,
                    `/Storage/Tape/${libId}/Media`,
                    `/Library/${libId}/Media`,
                    `/V4/Library/${libId}/Media`
                  ];

                  for (const mEp of mediaEndpoints) {
                    try {
                      const mediaRes = await this.client.get(mEp, { headers });
                      const mData = mediaRes.data || {};
                      const mList = Array.isArray(mData)
                        ? mData
                        : mData.mediaList || mData.media || mData.response || mData.data || [];

                      if (Array.isArray(mList) && mList.length > 0) {
                        console.log(`[Commvault] Media endpoint ${mEp} returned ${mList.length} media items for ${libName}. Sample:`, JSON.stringify(mList[0]).substring(0, 300));
                        let assigned = 0;
                        let spare = 0;
                        for (const m of mList) {
                          const mStr = JSON.stringify(m).toLowerCase();
                          const isAssigned = m.assigned || m.isAssigned || m.status === 'ASSIGNED' || m.state === 'ASSIGNED' || m.statusInfo?.mediaStatus === 'Assigned' || (mStr.includes('"assigned"') && !mStr.includes('"isassigned":false'));
                          if (isAssigned) {
                            assigned++;
                          } else {
                            spare++;
                          }
                        }
                        assignedMediaCount = assigned;
                        spareMediaCount = spare;
                        totalMediaCount = assigned + spare;
                        break;
                      }
                    } catch {
                      continue;
                    }
                  }
                } catch (err: any) {
                  console.warn(`[Commvault] Could not fetch media for library ${libName}: ${err.message}`);
                }
              }
            }

            const capacityTotalGiB = capTotalBytes ? capTotalBytes / (1024 * 1024 * 1024) : (lib.capacityTotalGiB || 0);
            const capacityFreeGiB = capFreeBytes ? capFreeBytes / (1024 * 1024 * 1024) : (lib.capacityFreeGiB || 0);
            const capacityUsedGiB = capUsedBytes ? capUsedBytes / (1024 * 1024 * 1024) : (lib.capacityUsedGiB || 0);

            resultMap.set(libId, {
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
        } catch (err: any) {
          // Endpoint might not exist or return 404, continue to next
          continue;
        }
      }

      const result = Array.from(resultMap.values());
      console.log(`[Commvault] getLibraries compiled total ${result.length} distinct library items across all storage endpoints.`);
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
        const sc = item.subclientEntity || item.subClientEntity || item.subclient || item.subClient || item.entityInfo || item;
        const subclientId = String(sc.subclientId || sc.id || sc.subClientId || sc.entityId || item.subclientId || item.id || item.subClientId || item.entityInfo?.id || item.entityInfo?.subclientId || '');
        if (!subclientId) {
          console.warn(`[Commvault] Skipping subclient item with missing ID. Keys:`, Object.keys(item), `Sample:`, JSON.stringify(item).substring(0, 300));
          continue;
        }

        const subclientName = sc.subclientName || sc.name || sc.subClientName || sc.displayName || item.subclientName || item.name || item.displayName || item.entityInfo?.name || item.entityInfo?.displayName || `Subclient-${subclientId}`;
        const clientName = sc.clientName || sc.client?.name || sc.displayName || item.clientName || item.client?.name || 'Unknown-Client';
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
      const endpoints = ['/Commserv/SLA', '/SLA', '/V4/SLA', '/v4/sla', '/commandcenter/api/v4/SLA'];
      for (const ep of endpoints) {
        try {
          const response = await this.client.get(ep, { headers });
          const slaData = response.data?.slaInfo || response.data?.sla || response.data || {};
          const slaVal = parseFloat(String(slaData.slaPercentage || slaData.percentage || slaData.value || slaData.SLA || '0'));
          if (!isNaN(slaVal) && slaVal > 0) return slaVal;
        } catch {
          continue;
        }
      }
      return null;
    } catch (error: any) {
      console.warn(`[Commvault] getSlaPercentage failed: ${error.message}`);
      return null;
    }
  }

  async fetchInventory(): Promise<DiscoveredDevice[]> {
    console.log(`[Commvault] Starting inventory sync check from ${this.config.url}...`);
    try {
      // Clean up any previously synced Commvault libraries (both Tape and Disk) from active inventory
      // so they never appear in frontend or device counts (these metrics are kept exclusively in ForecastMetricSnapshot for bulletins)
      try {
        const deleted = await prisma.inventoryItem.deleteMany({
          where: {
            OR: [
              { serial_number: { startsWith: 'commvault-' } },
              { discovered_via: 'commvault' },
              { model: { name: { in: ['Tape Library', 'Disk Library', 'Backup Library'] } } }
            ]
          }
        });
        console.log(`[Commvault] Cleaned up ${deleted.count} library items from active inventory.`);
      } catch (e: any) {
        console.warn(`[Commvault] Could not clean up old libraries from inventory: ${e.message}`);
      }

      console.log(`[Commvault] Returning 0 devices for active inventory (`bu bilgileri sadece bültende kullanacağız`).`);
      return [];
    } catch (error: any) {
      console.error(`[Commvault] Sync failed: ${error.message}`);
      throw error;
    }
  }
}
