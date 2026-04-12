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
        device_type: device.device_type,
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
      discovered_via: integration.integration_type
    }
  });

  return 'created';
}

export const startIntegrationWorker = () => {
  const worker = new Worker('integration-sync', async (job) => {
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
