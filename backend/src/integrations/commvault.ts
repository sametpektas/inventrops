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
  private apiPrefix: string = '';

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

  private async requestGet(path: string, headers: any): Promise<any> {
    const prefixes = [
      this.apiPrefix,
      '/SearchSvc/CVWebService.svc',
      '/webconsole/api',
      '/commandcenter/api',
      '/api',
      ''
    ];
    const uniquePrefixes = Array.from(new Set(prefixes));

    let lastErr: any = null;
    for (const prefix of uniquePrefixes) {
      const fullPath = prefix ? `${prefix}${path}`.replace('//', '/') : path;
      try {
        const res = await this.client.get(fullPath, { headers });
        if (res && (res.status === 200 || res.status === 201) && res.data) {
          if (prefix && !this.apiPrefix) {
            this.apiPrefix = prefix;
            console.log(`[Commvault] Discovered active API prefix: ${this.apiPrefix}`);
          }
          return res;
        }
      } catch (err: any) {
        lastErr = err;
        const status = err.response?.status;
        if (status === 404 || status === 401 || status === 500) {
          continue;
        }
      }
    }
    if (lastErr) throw lastErr;
    throw new Error(`GET ${path} failed across all known Commvault API prefixes`);
  }

  private async authenticate(): Promise<string> {
    if (this.config.api_key) return this.config.api_key;
    if (this.token) return this.token;

    try {
      console.log(`[Commvault] Authenticating with ${this.config.url}...`);
      
      const rawPassword = this.config.password || '';
      const base64Password = Buffer.from(rawPassword).toString('base64');
      
      const prefixes = ['', '/SearchSvc/CVWebService.svc', '/webconsole/api', '/commandcenter/api', '/api'];
      const endpoints = ['/Login', '/V4/Login', '/login'];
      const passwords = [base64Password, rawPassword];

      let response: any = null;
      let lastError: any = null;
      let successfulPrefix = '';

      for (const prefix of prefixes) {
        for (const endpoint of endpoints) {
          const fullEndpoint = prefix ? `${prefix}${endpoint}`.replace('//', '/') : endpoint;
          for (const pwd of passwords) {
            try {
              response = await this.client.post(fullEndpoint, {
                username: this.config.username,
                password: pwd
              });
              if (response && (response.headers['authtoken'] || response.headers['Authtoken'] || response.data?.token || response.data?.authtoken || response.data?.tokenResponse?.token)) {
                successfulPrefix = prefix;
                break;
              }
            } catch (err: any) {
              lastError = err;
              const status = err.response?.status;
              if (status === 404 || status === 401 || status === 500) {
                continue;
              }
              throw err;
            }
          }
          if (response && (response.headers['authtoken'] || response.headers['Authtoken'] || response.data?.token || response.data?.authtoken || response.data?.tokenResponse?.token)) {
            break;
          }
        }
        if (response && (response.headers['authtoken'] || response.headers['Authtoken'] || response.data?.token || response.data?.authtoken || response.data?.tokenResponse?.token)) {
          break;
        }
      }

      if (!response) {
        throw lastError || new Error('Failed to reach Commvault login endpoint across all prefixes and paths');
      }

      const token = response.headers['authtoken'] || response.headers['Authtoken'] || response.data?.token || response.data?.authtoken || response.data?.tokenResponse?.token;

      if (!token) {
        console.error(`[Commvault] Auth response:`, JSON.stringify(response.data).substring(0, 500));
        throw new Error('No authtoken found in Commvault login response');
      }

      this.token = token;
      if (successfulPrefix && !this.apiPrefix) {
        this.apiPrefix = successfulPrefix;
        console.log(`[Commvault] Discovered API prefix during login: ${this.apiPrefix}`);
      }
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
      'authtoken': token,
      'Authorization': `Bearer ${token}`,
      'QSDK-Token': token,
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
          const response = await this.requestGet(ep.path, headers);
          const data = response.data || {};
          const rawList = Array.isArray(data)
            ? data
            : data.tapeStorage || data.diskStorage || data.tapeStorageList || data.diskStorageList || data.storageList || data.libraryInfoList || data.libraries || data.libraryList || data.librariesList || data.response || data.data || [];

          const itemsArray = Array.isArray(rawList) ? rawList : (rawList && typeof rawList === 'object' ? [rawList] : []);
          console.log(`[Commvault] Endpoint ${ep.path} returned ${itemsArray.length} items. Keys:`, Object.keys(data));

          for (const item of itemsArray) {
            const lib = item.library || item.libraryEntity || item.libraryInfo || item.entityInfo || item.tapeStorage || item.diskStorage || item;
            const libId = String(lib.libraryId || lib.id || lib.LibraryId || lib.entityId || lib.tapeStorageId || lib.diskStorageId || lib.storageId || item.libraryId || item.id || item.LibraryId || item.entityInfo?.id || item.entityInfo?.libraryId || item.library?.id || item.library?.libraryId || '');
            if (!libId) {
              console.warn(`[Commvault] Skipping item with missing ID from ${ep.path}. Keys:`, Object.keys(item), `Sample:`, JSON.stringify(item).substring(0, 300));
              continue;
            }

            const libName = lib.libraryName || lib.name || lib.LibraryName || lib.displayName || lib.tapeStorageName || lib.diskStorageName || lib.storageName || item.libraryName || item.name || item.LibraryName || item.displayName || item.entityInfo?.name || item.entityInfo?.displayName || item.library?.libraryName || item.library?.name || `Library-${libId}`;
            const isTape = Boolean(ep.isTapeHint || lib.isTapeLibrary || libName.toLowerCase().includes('tape') || libName.toLowerCase().includes('msl') || libName.toLowerCase().includes('ts4') || libName.toLowerCase().includes('ts3') || libName.toLowerCase().includes('quantum') || libName.toLowerCase().includes('scalar') || lib.libraryType === 1 || String(lib.libraryType).toLowerCase().includes('tape'));

            let assignedMediaCount = lib.assignedMediaCount !== undefined ? Number(lib.assignedMediaCount) : (lib.assignedMedia !== undefined ? Number(lib.assignedMedia) : (lib.numOfAssignedMedia !== undefined ? Number(lib.numOfAssignedMedia) : undefined));
            let spareMediaCount = lib.spareMediaCount !== undefined ? Number(lib.spareMediaCount) : (lib.spareMedia !== undefined ? Number(lib.spareMedia) : (lib.numOfSpareMediaInLib !== undefined ? Number(lib.numOfSpareMediaInLib) : undefined));
            let totalMediaCount = lib.totalMediaCount !== undefined ? Number(lib.totalMediaCount) : (lib.totalMedia !== undefined ? Number(lib.totalMedia) : undefined);

            // Broadly check capacity fields across library root and summary objects
            const getBytes = (obj: any, keys: string[]): number => {
              if (!obj || typeof obj !== 'object') return 0;
              for (const k of keys) {
                if (obj[k] !== undefined && obj[k] !== null && !isNaN(Number(obj[k]))) {
                  return Number(obj[k]);
                }
              }
              return 0;
            };

            let capTotalBytes = getBytes(lib, ['capacityBytes', 'totalCapacity', 'capacity', 'totalCapacityBytes', 'diskCapacity', 'totalSpace']) || getBytes(lib.summary || lib.diskSummary || lib.storageSummary || lib.mountPathSummary, ['totalCapacity', 'capacityBytes', 'totalSpace']);
            let capFreeBytes = getBytes(lib, ['freeSpaceBytes', 'freeCapacity', 'freeSpace', 'availableSpace']) || getBytes(lib.summary || lib.diskSummary || lib.storageSummary || lib.mountPathSummary, ['freeCapacity', 'freeSpaceBytes', 'availableSpace']);
            let capUsedBytes = getBytes(lib, ['usedSpaceBytes', 'usedCapacity', 'consumedSpace']) || getBytes(lib.summary || lib.diskSummary || lib.storageSummary || lib.mountPathSummary, ['usedCapacity', 'usedSpaceBytes', 'consumedSpace']) || (capTotalBytes > capFreeBytes ? capTotalBytes - capFreeBytes : 0);

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
                  const detailRes = await this.requestGet(dEp, headers);
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

                    const dTotal = getBytes(detailObj, ['capacityBytes', 'totalCapacity', 'capacity', 'totalCapacityBytes', 'diskCapacity', 'totalSpace']) || getBytes(detailObj.summary || detailObj.diskSummary || detailObj.storageSummary || detailObj.mountPathSummary, ['totalCapacity', 'capacityBytes', 'totalSpace']);
                    const dFree = getBytes(detailObj, ['freeSpaceBytes', 'freeCapacity', 'freeSpace', 'availableSpace']) || getBytes(detailObj.summary || detailObj.diskSummary || detailObj.storageSummary || detailObj.mountPathSummary, ['freeCapacity', 'freeSpaceBytes', 'availableSpace']);
                    const dUsed = getBytes(detailObj, ['usedSpaceBytes', 'usedCapacity', 'consumedSpace']) || getBytes(detailObj.summary || detailObj.diskSummary || detailObj.storageSummary || detailObj.mountPathSummary, ['usedCapacity', 'usedSpaceBytes', 'consumedSpace']) || (dTotal > dFree ? dTotal - dFree : 0);

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
                      const mediaRes = await this.requestGet(mEp, headers);
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

            const capacityTotalGiB = capTotalBytes ? capTotalBytes / (1024 * 1024 * 1024) : (Number(lib.capacityTotalGiB || lib.capacityGiB || lib.totalCapacityGiB || 0));
            const capacityFreeGiB = capFreeBytes ? capFreeBytes / (1024 * 1024 * 1024) : (Number(lib.capacityFreeGiB || lib.freeSpaceGiB || lib.freeCapacityGiB || 0));
            const capacityUsedGiB = capUsedBytes ? capUsedBytes / (1024 * 1024 * 1024) : (Number(lib.capacityUsedGiB || lib.usedSpaceGiB || lib.usedCapacityGiB || (capacityTotalGiB > capacityFreeGiB ? capacityTotalGiB - capacityFreeGiB : 0)));

            const existing = resultMap.get(libId);
            if (existing) {
              if (capacityTotalGiB > existing.capacityTotalGiB) existing.capacityTotalGiB = capacityTotalGiB;
              if (capacityUsedGiB > existing.capacityUsedGiB) existing.capacityUsedGiB = capacityUsedGiB;
              if (capacityFreeGiB > existing.capacityFreeGiB) existing.capacityFreeGiB = capacityFreeGiB;
              if (assignedMediaCount !== undefined && (existing.assignedMediaCount === undefined || assignedMediaCount > existing.assignedMediaCount)) existing.assignedMediaCount = assignedMediaCount;
              if (spareMediaCount !== undefined && (existing.spareMediaCount === undefined || spareMediaCount > existing.spareMediaCount)) existing.spareMediaCount = spareMediaCount;
              if (totalMediaCount !== undefined && (existing.totalMediaCount === undefined || totalMediaCount > existing.totalMediaCount)) existing.totalMediaCount = totalMediaCount;
            } else {
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
        response = await this.requestGet('/Subclient', headers);
      } catch (err: any) {
        try {
          response = await this.requestGet('/V4/Subclient', headers);
        } catch {
          response = { data: {} };
        }
      }
      const data = response.data || {};
      let rawList = Array.isArray(data)
        ? data
        : data.subclientProperties || data.subclientList || data.subClientList || data.subclients || data.data || data.response || [];

      let itemsArray = Array.isArray(rawList) ? rawList : (rawList && typeof rawList === 'object' ? [rawList] : []);
      console.log(`[Commvault] getSubclients initially parsed ${itemsArray.length} entries from keys:`, Object.keys(data));

      // If initial /Subclient query returns empty, Commvault environment often requires client-specific query via /Client
      if (itemsArray.length === 0) {
        console.log(`[Commvault] /Subclient returned 0 entries. Fetching clients via /Client to query subclients per client...`);
        try {
          const clientRes = await this.requestGet('/Client', headers);
          const cData = clientRes.data || {};
          const cList = Array.isArray(cData) ? cData : cData.clientProperties || cData.clientList || cData.clients || cData.response || [];
          const clients = Array.isArray(cList) ? cList : (cList && typeof cList === 'object' ? [cList] : []);
          console.log(`[Commvault] Found ${clients.length} clients to query subclients.`);

          // Limit query to top 50 clients to stay fast
          for (const cl of clients.slice(0, 50)) {
            const cEntity = cl.clientEntity || cl.client || cl;
            const clientId = cEntity.clientId || cEntity.id || cl.clientId || cl.id;
            if (!clientId) continue;

            try {
              const scRes = await this.requestGet(`/Subclient?clientId=${clientId}`, headers);
              const scData = scRes.data || {};
              const scList = Array.isArray(scData) ? scData : scData.subclientProperties || scData.subclientList || scData.subClientList || scData.subclients || scData.data || scData.response || [];
              const scArr = Array.isArray(scList) ? scList : (scList && typeof scList === 'object' ? [scList] : []);
              if (scArr.length > 0) {
                itemsArray.push(...scArr);
              }
            } catch {
              continue;
            }
          }
          console.log(`[Commvault] Total subclients compiled via /Client loop: ${itemsArray.length}`);
        } catch (err: any) {
          console.warn(`[Commvault] Failed fetching per-client subclients: ${err.message}`);
        }
      }

      const result: CommvaultSubclient[] = [];
      const seenIds = new Set<string>();

      for (const item of itemsArray) {
        const sc = item.subclientEntity || item.subClientEntity || item.subclient || item.subClient || item.entityInfo || item;
        const subclientId = String(sc.subclientId || sc.id || sc.subClientId || sc.entityId || item.subclientId || item.id || item.subClientId || item.entityInfo?.id || item.entityInfo?.subclientId || '');
        if (!subclientId || seenIds.has(subclientId)) {
          continue;
        }
        seenIds.add(subclientId);

        const subclientName = sc.subclientName || sc.name || sc.subClientName || sc.displayName || item.subclientName || item.name || item.displayName || item.entityInfo?.name || item.entityInfo?.displayName || `Subclient-${subclientId}`;
        const clientName = sc.clientName || sc.client?.name || sc.displayName || item.clientName || item.client?.name || 'Unknown-Client';
        const appName = sc.appName || sc.instanceName || sc.agentName;

        const bytes = Number(item.applicationSize || item.backupSize || sc.applicationSize || sc.backupSize || item.size || sc.size || item.lastBackupSize || sc.lastBackupSize || item.totalSize || sc.totalSize || 0);
        const backupSizeGiB = bytes > 0 ? bytes / (1024 * 1024 * 1024) : (Number(item.backupSizeGiB || sc.backupSizeGiB || item.sizeGiB || sc.sizeGiB || item.lastBackupSizeGiB || sc.lastBackupSizeGiB || 0));

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
      const endpoints = ['/Commserv/SLA', '/SLA', '/V4/SLA', '/v4/sla', '/commandcenter/api/v4/SLA', '/V4/SLA/Summary', '/v4/sla/summary'];
      for (const ep of endpoints) {
        try {
          const response = await this.requestGet(ep, headers);
          const slaData = response.data?.slaInfo || response.data?.sla || response.data?.slaSummary || response.data || {};
          let slaVal = parseFloat(String(slaData.slaPercentage || slaData.percentage || slaData.value || slaData.SLA || slaData.overallSLA || slaData.totalSLA || '0'));
          if (isNaN(slaVal) || slaVal <= 0) {
            const list = response.data?.slaList || response.data?.slas || response.data?.data || (Array.isArray(response.data) ? response.data : []);
            if (Array.isArray(list) && list.length > 0) {
              const firstItem = list[0] || {};
              slaVal = parseFloat(String(firstItem.slaPercentage || firstItem.percentage || firstItem.value || firstItem.SLA || '0'));
            }
          }
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
      // Clean up ONLY Commvault library items from active inventory (NOT real storage devices)
      // Only target items with commvault- serial prefix (synthetic entries created by CommvaultAdapter)
      try {
        const deleted = await prisma.inventoryItem.deleteMany({
          where: {
            serial_number: { startsWith: 'commvault-' }
          }
        });
        if (deleted.count > 0) {
          console.log(`[Commvault] Cleaned up ${deleted.count} synthetic library items from active inventory.`);
        }
      } catch (e: any) {
        console.warn(`[Commvault] Could not clean up old libraries from inventory: ${e.message}`);
      }

      console.log('[Commvault] Returning 0 devices for active inventory (kept for bulletin only).');
      return [];
    } catch (error: any) {
      console.error(`[Commvault] Sync failed: ${error.message}`);
      throw error;
    }
  }
}
