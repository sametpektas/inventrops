import 'dotenv/config';
import { prisma } from '../lib/prisma';
import bcrypt from 'bcryptjs';

async function main() {
  console.log('Seeding mock data...');

  const password = await bcrypt.hash('admin123', 10);

  // 1. Teams
  const teamIt = await prisma.team.upsert({
    where: { name: 'IT Infrastructure' },
    update: {},
    create: { name: 'IT Infrastructure', description: 'Core IT Infrastructure Team' },
  });

  const teamCloud = await prisma.team.upsert({
    where: { name: 'Cloud Operations' },
    update: {},
    create: { name: 'Cloud Operations', description: 'Cloud & DevOps Team' },
  });

  // 2. Users
  await prisma.user.upsert({
    where: { username: 'admin' },
    update: { team_id: teamIt.id, role: 'admin' },
    create: {
      username: 'admin',
      password,
      email: 'admin@inventrops.com',
      role: 'admin',
      team_id: teamIt.id,
    },
  });

  await prisma.user.upsert({
    where: { username: 'jdoe' },
    update: {},
    create: {
      username: 'jdoe',
      password,
      email: 'jdoe@inventrops.com',
      role: 'operator',
      team_id: teamIt.id,
    },
  });

  // 3. Datacenters
  const dcFrankfurt = await prisma.datacenter.upsert({
    where: { name: 'FRA-01 (Frankfurt)' },
    update: {},
    create: {
      name: 'FRA-01 (Frankfurt)',
      location: 'Frankfurt, Germany',
      address: 'Mainzer Landstraße 100',
      team_id: teamIt.id,
    },
  });

  const dcLondon = await prisma.datacenter.upsert({
    where: { name: 'LON-02 (London)' },
    update: {},
    create: {
      name: 'LON-02 (London)',
      location: 'London, UK',
      address: 'Slough Trading Estate',
      team_id: teamIt.id,
    },
  });

  // 4. Rooms
  const roomA = await prisma.room.upsert({
    where: { datacenter_id_name: { datacenter_id: dcFrankfurt.id, name: 'Data Hall A' } },
    update: {},
    create: {
      name: 'Data Hall A',
      floor: '1st Floor',
      datacenter_id: dcFrankfurt.id,
    },
  });

  // 5. Racks
  const rack01 = await prisma.rack.upsert({
    where: { room_id_name: { room_id: roomA.id, name: 'RACK-A-01' } },
    update: {},
    create: {
      name: 'RACK-A-01',
      total_units: 42,
      room_id: roomA.id,
    },
  });

  const rack02 = await prisma.rack.upsert({
    where: { room_id_name: { room_id: roomA.id, name: 'RACK-A-02' } },
    update: {},
    create: {
      name: 'RACK-A-02',
      total_units: 42,
      room_id: roomA.id,
    },
  });

  // 6. Vendors
  const dell = await prisma.vendor.upsert({
    where: { name: 'Dell Technologies' },
    update: {},
    create: { name: 'Dell Technologies', website: 'https://dell.com' },
  });

  const hpe = await prisma.vendor.upsert({
    where: { name: 'HPE' },
    update: {},
    create: { name: 'HPE', website: 'https://hpe.com' },
  });

  const cisco = await prisma.vendor.upsert({
    where: { name: 'Cisco' },
    update: {},
    create: { name: 'Cisco', website: 'https://cisco.com' },
  });

  // 7. Hardware Models
  const r750 = await prisma.hardwareModel.upsert({
    where: { vendor_id_name: { vendor_id: dell.id, name: 'PowerEdge R750' } },
    update: {},
    create: {
      name: 'PowerEdge R750',
      device_type: 'server',
      rack_units: 2,
      vendor_id: dell.id,
    },
  });

  const dl380 = await prisma.hardwareModel.upsert({
    where: { vendor_id_name: { vendor_id: hpe.id, name: 'ProLiant DL380 Gen10' } },
    update: {},
    create: {
      name: 'ProLiant DL380 Gen10',
      device_type: 'server',
      rack_units: 2,
      vendor_id: hpe.id,
    },
  });

  const nexus9300 = await prisma.hardwareModel.upsert({
    where: { vendor_id_name: { vendor_id: cisco.id, name: 'Nexus 9300-EX' } },
    update: {},
    create: {
      name: 'Nexus 9300-EX',
      device_type: 'switch',
      rack_units: 1,
      vendor_id: cisco.id,
    },
  });

  // 8. Inventory Items
  const items = [
    {
      serial_number: 'DELL-SRV-001',
      hostname: 'fra-prod-app-01',
      ip_address: '10.10.1.11',
      rack_unit_start: 1,
      rack_unit_size: 2,
      hardware_model_id: r750.id,
      rack_id: rack01.id,
      team_id: teamIt.id,
    },
    {
      serial_number: 'DELL-SRV-002',
      hostname: 'fra-prod-app-02',
      ip_address: '10.10.1.12',
      rack_unit_start: 3,
      rack_unit_size: 2,
      hardware_model_id: r750.id,
      rack_id: rack01.id,
      team_id: teamIt.id,
    },
    {
      serial_number: 'HPE-SRV-001',
      hostname: 'fra-prod-db-01',
      ip_address: '10.10.2.11',
      rack_unit_start: 10,
      rack_unit_size: 2,
      hardware_model_id: dl380.id,
      rack_id: rack01.id,
      team_id: teamIt.id,
    },
    {
      serial_number: 'CISCO-SW-001',
      hostname: 'fra-core-sw-01',
      ip_address: '10.10.0.1',
      rack_unit_start: 42,
      rack_unit_size: 1,
      hardware_model_id: nexus9300.id,
      rack_id: rack01.id,
      team_id: teamIt.id,
    },
  ];

  for (const item of items) {
    await prisma.inventoryItem.upsert({
      where: { serial_number: item.serial_number },
      update: { ...item },
      create: { ...item },
    });
  }

  console.log('Seed completed successfully.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
