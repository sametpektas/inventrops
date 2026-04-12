import 'dotenv/config';
import { prisma } from '../lib/prisma';
import bcrypt from 'bcryptjs';

async function main() {
  console.log('Seeding mock data for Team-Based Access and Software support...');

  const password = await bcrypt.hash('admin123', 10);

  // 1. Teams
  const teams = [
    { name: 'Server Team', description: 'Manages server hardware and OS' },
    { name: 'Storage Team', description: 'Manages storage, backup and SAN infrastructure' },
    { name: 'Network Team', description: 'Manages switches and firewalls' },
  ];

  const teamMap: Record<string, any> = {};
  for (const t of teams) {
    teamMap[t.name] = await prisma.team.upsert({
      where: { name: t.name },
      update: {},
      create: t,
    });
  }

  // 2. Users
  const users = [
    { username: 'admin', email: 'admin@inventrops.com', role: 'admin', team: 'Server Team' },
    { username: 'server_op', email: 'server@inventrops.com', role: 'operator', team: 'Server Team' },
    { username: 'storage_op', email: 'storage@inventrops.com', role: 'operator', team: 'Storage Team' },
    { username: 'network_op', email: 'network@inventrops.com', role: 'operator', team: 'Network Team' },
  ];

  for (const u of users) {
    await prisma.user.upsert({
      where: { username: u.username },
      update: { team_id: teamMap[u.team].id, role: u.role },
      create: {
        username: u.username,
        password,
        email: u.email,
        role: u.role,
        team_id: teamMap[u.team].id,
        require_password_change: u.username !== 'admin',
        is_ldap: false
      },
    });
  }

  // 3. Datacenters
  const dc = await prisma.datacenter.upsert({
    where: { name: 'Main DC' },
    update: {},
    create: { name: 'Main DC', team_id: teamMap['Server Team'].id },
  });

  const room = await prisma.room.upsert({
    where: { datacenter_id_name: { datacenter_id: dc.id, name: 'Room 01' } },
    update: {},
    create: { name: 'Room 01', datacenter_id: dc.id },
  });

  const rack = await prisma.rack.upsert({
    where: { room_id_name: { room_id: room.id, name: 'RACK-01' } },
    update: {},
    create: { name: 'RACK-01', total_units: 42, room_id: room.id },
  });

  // 4. Vendors
  const vendors = [
    { name: 'Dell Technologies' },
    { name: 'HPE' },
    { name: 'Cisco' },
    { name: 'Brocade' },
    { name: 'Palo Alto' },
  ];

  const vendorMap: Record<string, any> = {};
  for (const v of vendors) {
    vendorMap[v.name] = await prisma.vendor.upsert({
      where: { name: v.name },
      update: {},
      create: v,
    });
  }

  // 5. Models (Corrected naming to 'model')
  const models = [
    // Server Team Hardware
    { name: 'PowerEdge R750', vendor: 'Dell Technologies', category: 'hardware', device_type: 'server', units: 2 },
    { name: 'ProLiant DL380 Gen10', vendor: 'HPE', category: 'hardware', device_type: 'server', units: 2 },
    
    // Storage Team Hardware
    { name: 'PowerStore 500T', vendor: 'Dell Technologies', category: 'hardware', device_type: 'storage', units: 2 },
    { name: 'DS-6620B SAN Switch', vendor: 'Brocade', category: 'hardware', device_type: 'san_switch', units: 1 },
    
    // Network Team Hardware
    { name: 'Nexus 93180YC-EX', vendor: 'Cisco', category: 'hardware', device_type: 'network_switch', units: 1 },
    { name: 'PA-3220 Firewall', vendor: 'Palo Alto', category: 'hardware', device_type: 'firewall', units: 1 },

    // Software Models
    { name: 'SANnav Management Portal', vendor: 'Brocade', category: 'software', device_type: 'software', units: 0 },
    { name: 'Panorama', vendor: 'Palo Alto', category: 'software', device_type: 'software', units: 0 },
  ];

  const modelMap: Record<string, any> = {};
  for (const m of models) {
    modelMap[m.name] = await prisma.model.upsert({
      where: { vendor_id_name: { vendor_id: vendorMap[m.vendor].id, name: m.name } },
      update: { category: m.category as any, device_type: m.device_type as any },
      create: {
        name: m.name,
        vendor_id: vendorMap[m.vendor].id,
        category: m.category as any,
        device_type: m.device_type as any,
        rack_units: m.units,
      },
    });
  }

  // 6. Inventory Items
  const items = [
    // Server Team
    { serial_number: 'SRV-DL-001', hostname: 'server-app-01', model: 'PowerEdge R750', team: 'Server Team', rack_u: 1 },
    
    // Storage Team
    { serial_number: 'STO-BR-001', hostname: 'san-switch-01', model: 'DS-6620B SAN Switch', team: 'Storage Team', rack_u: 10 },
    { serial_number: 'SOFT-BR-001', hostname: 'sannav-mgmt-01', model: 'SANnav Management Portal', team: 'Storage Team', rack_u: null },
    
    // Network Team
    { serial_number: 'NET-CS-001', hostname: 'core-switch-01', model: 'Nexus 93180YC-EX', team: 'Network Team', rack_u: 40 },
  ];

  for (const i of items) {
    await prisma.inventoryItem.upsert({
      where: { serial_number: i.serial_number },
      update: {
        team_id: teamMap[i.team].id,
        model_id: modelMap[i.model].id,
        rack_id: i.rack_u ? rack.id : null,
        rack_unit_start: i.rack_u,
      },
      create: {
        serial_number: i.serial_number,
        hostname: i.hostname,
        team_id: teamMap[i.team].id,
        model_id: modelMap[i.model].id,
        rack_id: i.rack_u ? rack.id : null,
        rack_unit_start: i.rack_u,
        status: 'active',
      },
    });
  }

  console.log('Seed completed successfully with teams and software.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
