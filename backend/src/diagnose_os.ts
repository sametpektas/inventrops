const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const HYPERVISOR_KEYWORDS = ['vmware', 'esxi', 'esx', 'hyper-v', 'proxmox', 'xen server', 'vmdk', 'ovirt', 'citrix', 'hyperv', 'kvm', 'vsphere', 'vcenter'];

async function diagnose() {
  console.log('--- Inventory OS Diagnosis ---');
  
  const items = await prisma.inventoryItem.findMany({
    where: { status: 'active' },
    select: {
      id: true,
      serial_number: true,
      hostname: true,
      operating_system: true,
    }
  });

  console.log(`Total active items: ${items.length}`);

  const servers = items; // Assuming they are all servers for this check
  
  let virtualization = 0;
  let bareMetal = 0;
  let nullOs = 0;

  console.log('\nSample of problematic items (ESX in Bare Metal?):');
  
  for (const item of servers) {
    const os = item.operating_system || '';
    const isVirtual = HYPERVISOR_KEYWORDS.some(k => os.toLowerCase().includes(k));
    
    if (isVirtual) {
      virtualization++;
    } else {
      bareMetal++;
      if (os === null) nullOs++;
      
      // If OS looks like it should be virtual but isn't flagged
      if (os.toLowerCase().includes('esx') || os.toLowerCase().includes('vmware')) {
        console.log(`[MISMATCH] ID: ${item.id} | SN: ${item.serial_number} | Host: ${item.hostname} | OS: "${os}"`);
      }
    }
  }

  console.log('\n--- Summary ---');
  console.log(`Virtualization (detected by JS): ${virtualization}`);
  console.log(`Bare Metal (detected by JS): ${bareMetal} (of which ${nullOs} have NULL OS)`);
  
  await prisma.$disconnect();
}

diagnose().catch(err => {
  console.error(err);
  process.exit(1);
});
