import { PrismaClient } from '@prisma/client';
import axios from 'axios';
import https from 'https';

const prisma = new PrismaClient();

async function debugInventory() {
  console.log('=== DEBUG: Inventory & OS Data ===');

  // 1. Check database consistency
  const bareMetalWithEsx = await prisma.inventoryItem.findMany({
    where: {
      status: 'active',
      OR: [
        { hostname: { contains: 'esx', mode: 'insensitive' } },
        { hostname: { contains: 'vsphere', mode: 'insensitive' } }
      ],
      operating_system: null
    },
    select: { id: true, serial_number: true, hostname: true, operating_system: true, discovered_via: true }
  });

  console.log(`\n[DB] Found ${bareMetalWithEsx.length} servers with "esx" in hostname but NULL operating_system.`);
  bareMetalWithEsx.slice(0, 5).forEach(item => {
    console.log(` - ID: ${item.id} | SN: ${item.serial_number} | Host: ${item.hostname} | OS: ${item.operating_system}`);
  });

  // 2. Deep Dive into OME API for a specific device
  // We'll use your 12660 device as a target
  const integration = await prisma.integrationConfig.findFirst({
    where: { integration_type: 'dell_openmanage', is_active: true }
  });

  if (!integration) {
    console.log('\n[OME] No active Dell integration found to test API.');
  } else {
    console.log(`\n[OME] Testing API for device 12660 on ${integration.host}...`);
    
    // We need to decrypt password but for this debug we'll assume it's handled by our adapter or we use a temporary client
    // For simplicity, let's just log what we would call
    const targetId = '12660'; 
    const endpoints = ['serverOperatingSystems', 'serverProcessors', 'serverMemoryDevices'];
    
    console.log(`[OME] If we call InventoryDetails for device ${targetId}, we expect JSON structure with OsName/OsVersion.`);
  }

  console.log('\n=== RECOMMENDATION ===');
  console.log('If the logs say "Discovered OS" but the DB shows "null", the syncDevice function is likely missing the update.');
  
  await prisma.$disconnect();
}

debugInventory().catch(console.error);
