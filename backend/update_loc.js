const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function updateDeviceLocation() {
  try {
    const serialNumber = '781V9N4';
    const dcName = 'AVM';

    console.log(`Starting location update for device: ${serialNumber}`);

    // 1. Check if device exists
    const device = await prisma.inventoryItem.findUnique({
      where: { serial_number: serialNumber }
    });

    if (!device) {
      console.log(`Device ${serialNumber} not found!`);
      process.exit(1);
    }

    // 2. Find or create Datacenter
    let dc = await prisma.datacenter.findFirst({
      where: { name: { contains: dcName, mode: 'insensitive' } }
    });

    if (!dc) {
      console.log(`Datacenter '${dcName}' not found. Creating...`);
      let team = await prisma.team.findFirst();
      if (!team) {
        team = await prisma.team.create({
          data: { name: 'Default Team', description: 'Auto-created' }
        });
      }
      dc = await prisma.datacenter.create({
        data: { name: dcName, team_id: team.id }
      });
    }

    // 3. Find or create Room
    let room = await prisma.room.findFirst({
      where: { datacenter_id: dc.id }
    });

    if (!room) {
      console.log(`No room found in DC '${dc.name}'. Creating 'Sistem Odasi'...`);
      room = await prisma.room.create({
        data: { name: 'Sistem Odasi', datacenter_id: dc.id }
      });
    }

    // 4. Find or create Rack
    let rack = await prisma.rack.findFirst({
      where: { room_id: room.id }
    });

    if (!rack) {
      console.log(`No rack found in Room '${room.name}'. Creating 'Rack-01'...`);
      rack = await prisma.rack.create({
        data: { name: 'Rack-01', room_id: room.id, total_units: 42 }
      });
    }

    // 5. Update Device
    const updated = await prisma.inventoryItem.update({
      where: { serial_number: serialNumber },
      data: { rack_id: rack.id }
    });

    console.log(`Success! Device ${serialNumber} is now assigned to Datacenter: ${dc.name} -> Room: ${room.name} -> Rack: ${rack.name}`);

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

updateDeviceLocation();
