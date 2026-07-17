import { prisma } from '../../../lib/prisma';
import { decrypt } from '../../../utils/crypto';
import { NormalizedMetric, ForecastProvider } from './index';
import { CommvaultAdapter } from '../../../integrations/commvault';

export class CommvaultForecastProvider implements ForecastProvider {
  async collectMetrics(sourceId: number): Promise<NormalizedMetric[]> {
    const source = await prisma.integrationConfig.findUnique({ where: { id: sourceId } });
    if (!source || source.integration_type !== 'commvault') throw new Error('Invalid Commvault source');

    const metrics: NormalizedMetric[] = [];
    const now = new Date();

    const config = {
      url: source.url,
      username: source.username,
      password: source.password ? decrypt(source.password) : undefined,
      api_key: source.api_key ? decrypt(source.api_key) : undefined
    };

    const adapter = new CommvaultAdapter(config);

    try {
      // 1. Collect Libraries (Tape & Disk)
      const libraries = await adapter.getLibraries();
      for (const lib of libraries) {
        const objId = `commvault-lib-${lib.libraryId}`;
        const objName = lib.libraryName;
        const isGdp = (lib.libraryName || '').toUpperCase().includes('GDP');
        const objType = lib.isTape ? 'tape_library' : (isGdp ? 'gdp_pool' : 'disk_library');

        if (lib.capacityTotalGiB !== undefined && lib.capacityTotalGiB >= 0) {
          metrics.push({
            objectId: objId, objectName: objName, objectType: objType,
            metricName: 'capacity_total',
            metricValue: lib.capacityTotalGiB,
            timestamp: now
          });
        }
        if (lib.capacityUsedGiB !== undefined && lib.capacityUsedGiB >= 0) {
          metrics.push({
            objectId: objId, objectName: objName, objectType: objType,
            metricName: 'capacity_used',
            metricValue: lib.capacityUsedGiB,
            timestamp: now
          });
        }
        if (lib.capacityFreeGiB !== undefined && lib.capacityFreeGiB >= 0) {
          metrics.push({
            objectId: objId, objectName: objName, objectType: objType,
            metricName: 'capacity_free',
            metricValue: lib.capacityFreeGiB,
            timestamp: now
          });
        }
        if (lib.capacityTotalGiB && lib.capacityUsedGiB !== undefined && lib.capacityTotalGiB > 0) {
          const usedPct = (lib.capacityUsedGiB / lib.capacityTotalGiB) * 100;
          metrics.push({
            objectId: objId, objectName: objName, objectType: objType,
            metricName: 'capacity_used_percent',
            metricValue: Number(usedPct.toFixed(2)),
            timestamp: now
          });
        }

        // Tape specific media counts
        if (lib.isTape) {
          if (lib.assignedMediaCount !== undefined && !isNaN(lib.assignedMediaCount)) {
            metrics.push({
              objectId: objId, objectName: objName, objectType: objType,
              metricName: 'assigned_media',
              metricValue: lib.assignedMediaCount,
              timestamp: now
            });
          }
          if (lib.spareMediaCount !== undefined && !isNaN(lib.spareMediaCount)) {
            metrics.push({
              objectId: objId, objectName: objName, objectType: objType,
              metricName: 'spare_media',
              metricValue: lib.spareMediaCount,
              timestamp: now
            });
          }
          if (lib.totalMediaCount !== undefined && !isNaN(lib.totalMediaCount)) {
            metrics.push({
              objectId: objId, objectName: objName, objectType: objType,
              metricName: 'total_media',
              metricValue: lib.totalMediaCount,
              timestamp: now
            });
          }
        }
      }

      // 2. Collect SLA percentage
      const slaPercentage = await adapter.getSlaPercentage();
      if (slaPercentage !== null && !isNaN(slaPercentage)) {
        metrics.push({
          objectId: 'commvault-system',
          objectName: 'Commvault System SLA',
          objectType: 'backup_sla',
          metricName: 'sla_percent',
          metricValue: slaPercentage,
          timestamp: now
        });
      }

      // 3. Collect Subclients and their sizes
      const subclients = await adapter.getSubclients();
      for (const sc of subclients) {
        if (sc.backupSizeGiB !== undefined && sc.backupSizeGiB >= 0) {
          metrics.push({
            objectId: `commvault-sc-${sc.subclientId}`,
            objectName: `${sc.subclientName} (${sc.clientName})`,
            objectType: 'backup_subclient',
            metricName: 'subclient_backup_gib',
            metricValue: sc.backupSizeGiB,
            timestamp: now
          });
        }
      }

      console.log(`[CommvaultForecast] Collected ${metrics.length} metrics for integration #${sourceId}.`);
    } catch (error: any) {
      console.error(`[CommvaultForecast] Error collecting metrics:`, error.message);
    }

    return metrics;
  }
}
