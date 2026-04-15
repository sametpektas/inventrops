import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { prisma } from '../lib/prisma';
import { DellOpenManageAdapter, DiscoveredDevice } from '../integrations/dell';
import { HPEOneViewAdapter } from '../integrations/hpe';
import { XormonAdapter } from '../integrations/xormon';

const connection = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379/0', {
  maxRetriesPerRequest: null
});

export const integrationQueue = new Queue('integration-sync', { connection });

async function getOrCreateVendor(name: string) {
  let vendor = await prisma.vendor.findUnique({ where: { name } });
  if (!vendor) {
    vendor = await prisma.vendor.create({ data: { name } });
  }
  return vendor;
}

async function getOrCreateModel(device: DiscoveredDevice, vendorId: number) {
  let model = await prisma.model.findFirst({
    where: { vendor_id: vendorId, name: device.model_name || 'Unknown' }
  });
  if (!model) {
    model = await prisma.model.create({
      data: {
        vendor_id: vendorId,
        name: device.model_name || 'Unknown',
        device_type: device.device_type as any,
        rack_units: 1
      }
    });
  }
  return model;
}

async function syncDevice(device: DiscoveredDevice, integration: any) {
  if (!device.serial_number) return 'skipped';

  const vendor = await getOrCreateVendor(device.vendor_name || 'Unknown');
  const hwModel = await getOrCreateModel(device, vendor.id);

  const existing = await prisma.inventoryItem.findUnique({
    where: { serial_number: device.serial_number }
  });

  if (existing) {
    let updated = false;
    const updateData: any = {};

    if (device.hostname && existing.hostname !== device.hostname) {
      updateData.hostname = device.hostname;
      updated = true;
    }
    if (device.ip_address && existing.ip_address !== device.ip_address) {
      updateData.ip_address = device.ip_address;
      updated = true;
    }
    if (hwModel.id && existing.model_id !== hwModel.id) {
      updateData.model_id = hwModel.id;
      updated = true;
    }
    if (device.asset_tag && existing.asset_tag !== device.asset_tag) {
      updateData.asset_tag = device.asset_tag;
      updated = true;
    }
    if (device.firmware_version && existing.firmware_version !== device.firmware_version) {
      updateData.firmware_version = device.firmware_version;
      updateData.firmware_updated_at = new Date();
      updated = true;
    }
    if (device.metadata) {
      updateData.metadata = device.metadata;
      updated = true;
    }
    
    // Always update sync metadata
    updateData.last_sync_at = new Date();
    updateData.last_sync_status = device.sync_error ? 'warning' : 'success';
    updateData.last_sync_error = device.sync_error || null;
    updated = true;

    if (existing.discovered_via !== integration.integration_type) {
      updateData.discovered_via = integration.integration_type;
      updated = true;
    }

    if (updated) {
      await prisma.inventoryItem.update({
        where: { id: existing.id },
        data: updateData
      });
      return 'updated';
    }
    return 'skipped';
  }

  // Create new
  await prisma.inventoryItem.create({
    data: {
      serial_number: device.serial_number,
      hostname: device.hostname,
      model_id: hwModel.id,
      status: 'active',
      team_id: integration.team_id,
      ip_address: device.ip_address,
      asset_tag: device.asset_tag,
      firmware_version: device.firmware_version,
      firmware_updated_at: device.firmware_version ? new Date() : null,
      metadata: device.metadata as any,
      discovered_via: integration.integration_type,
      last_sync_at: new Date(),
      last_sync_status: device.sync_error ? 'warning' : 'success',
      last_sync_error: device.sync_error || null
    }
  });

  return 'created';
}

export const startIntegrationWorker = () => {
  const worker = new Worker('integration-sync', async (job) => {
    if (job.name === 'sync-all') {
      console.log('[Worker] Starting global sync for all active integrations...');
      const activeIntegrations = await prisma.integrationConfig.findMany({
        where: { is_active: true }
      });
      for (const integration of activeIntegrations) {
        await integrationQueue.add('sync-one', { integrationId: integration.id });
      }
      return;
    }

    const { integrationId } = job.data;
    console.log(`[Worker] Syncing integration ${integrationId}...`);

    const integration = await prisma.integrationConfig.findUnique({
      where: { id: integrationId },
      include: { team: true }
    });

    if (!integration || !integration.is_active) return;

    // Log start
    const syncLog = await prisma.syncLog.create({
      data: {
        integration_id: integrationId,
        status: 'success'
      }
    });

    try {
      let devices: DiscoveredDevice[] = [];
      if (integration.integration_type === 'dell_openmanage') {
        const adapter = new DellOpenManageAdapter(integration);
        devices = await adapter.fetchInventory();
      } else if (integration.integration_type === 'hpe_oneview') {
        const adapter = new HPEOneViewAdapter(integration);
        devices = await adapter.fetchInventory();
      } else if (integration.integration_type === 'xormon') {
        const adapter = new XormonAdapter(integration);
        devices = await adapter.fetchInventory();
      }

      let created = 0, updated = 0, skipped = 0;
      for (const device of devices) {
        const result = await syncDevice(device, integration);
        if (result === 'created') created++;
        else if (result === 'updated') updated++;
        else skipped++;
      }

      await prisma.syncLog.update({
        where: { id: syncLog.id },
        data: {
          items_discovered: devices.length,
          items_created: created,
          items_updated: updated,
          items_skipped: skipped,
          completed_at: new Date()
        }
      });

      await prisma.integrationConfig.update({
        where: { id: integrationId },
        data: { last_sync_at: new Date() }
      });

    } catch (err: any) {
      console.error(err);
      await prisma.syncLog.update({
        where: { id: syncLog.id },
        data: {
          status: 'failed',
          error_message: err.message,
          completed_at: new Date()
        }
      });
    }
  }, { connection });
};

export const startIntegrationScheduler = async () => {
  // Add repeatable job for global sync (Every day at 00:00)
  const jobs = await integrationQueue.getRepeatableJobs();
  const exists = jobs.some(j => j.name === 'sync-all');
  
  if (!exists) {
    console.log('[Scheduler] Initializing global integration sync schedule (Daily at 00:00)');
    await integrationQueue.add('sync-all', {}, {
      repeat: { pattern: '0 0 * * *' }
    });
  }
};
