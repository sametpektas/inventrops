import 'dotenv/config';
import { prisma } from '../lib/prisma';
import bcrypt from 'bcryptjs';

async function main() {
  console.log('--- Generating Comprehensive Mock Data ---');

  const password = await bcrypt.hash('admin123', 12);

  // 1. Teams
  const teams = [
    { name: 'Server Team', description: 'Enterprise compute and OS management' },
    { name: 'Storage Team', description: 'SAN, NAS, Backup and Flash Storage' },
    { name: 'Network Team', description: 'Switching, Routing and Security' },
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
    { username: 'admin', email: 'admin@inventrops.local', role: 'admin', team: 'Server Team' },
    { username: 'server_lead', email: 's.lead@inventrops.local', role: 'manager', team: 'Server Team' },
    { username: 'storage_op', email: 'st.op@inventrops.local', role: 'operator', team: 'Storage Team' },
    { username: 'network_op', email: 'nw.op@inventrops.local', role: 'operator', team: 'Network Team' },
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
        require_password_change: false,
        is_ldap: false
      },
    });
  }

  // 3. Infrastructure (DCs, Rooms, Racks)
  const dcIstanbul = await prisma.datacenter.upsert({
    where: { name: 'Istanbul DC' },
    update: {},
    create: { name: 'Istanbul DC', team_id: teamMap['Server Team'].id },
  });

  const rooms = ['System Room A', 'System Room B'];
  const roomMap: Record<string, any> = {};
  for (const rName of rooms) {
    roomMap[rName] = await prisma.room.upsert({
      where: { datacenter_id_name: { datacenter_id: dcIstanbul.id, name: rName } },
      update: {},
      create: { name: rName, datacenter_id: dcIstanbul.id },
    });
  }

  const racks = [
    { name: 'RACK-A01', room: 'System Room A', units: 42 },
    { name: 'RACK-A02', room: 'System Room A', units: 42 },
    { name: 'RACK-B01', room: 'System Room B', units: 47 },
  ];

  const rackMap: Record<string, any> = {};
  for (const r of racks) {
    rackMap[r.name] = await prisma.rack.upsert({
      where: { room_id_name: { room_id: roomMap[r.room].id, name: r.name } },
      update: {},
      create: { name: r.name, total_units: r.units, room_id: roomMap[r.room].id },
    });
  }

  // 4. Vendors
  const vendors = ['Dell Technologies', 'HPE', 'Cisco', 'Brocade', 'Palo Alto', 'VMware', 'Pure Storage'];
  const vendorMap: Record<string, any> = {};
  for (const v of vendors) {
    vendorMap[v] = await prisma.vendor.upsert({
      where: { name: v },
      update: {},
      create: { name: v },
    });
  }

  // 5. Models
  const models = [
    // Servers
    { name: 'PowerEdge R750', vendor: 'Dell Technologies', cat: 'hardware', type: 'server', u: 2 },
    { name: 'PowerEdge R650', vendor: 'Dell Technologies', cat: 'hardware', type: 'server', u: 1 },
    { name: 'ProLiant DL380 Gen10', vendor: 'HPE', cat: 'hardware', type: 'server', u: 2 },
    { name: 'ProLiant DL360 Gen11', vendor: 'HPE', cat: 'hardware', type: 'server', u: 1 },
    // Storage
    { name: 'PowerStore 1000T', vendor: 'Dell Technologies', cat: 'hardware', type: 'storage', u: 2 },
    { name: 'FlashArray //X', vendor: 'Pure Storage', cat: 'hardware', type: 'storage', u: 3 },
    { name: 'DS-6620B SAN Switch', vendor: 'Brocade', cat: 'hardware', type: 'san_switch', u: 1 },
    // Network
    { name: 'Nexus 93180YC-FX', vendor: 'Cisco', cat: 'hardware', type: 'network_switch', u: 1 },
    { name: 'Catalyst 9300-48P', vendor: 'Cisco', cat: 'hardware', type: 'network_switch', u: 1 },
    { name: 'PA-3250 Firewall', vendor: 'Palo Alto', cat: 'hardware', type: 'firewall', u: 1 },
    // Software
    { name: 'vCenter Server', vendor: 'VMware', cat: 'software', type: 'software', u: 0 },
    { name: 'Panorama Management', vendor: 'Palo Alto', cat: 'software', type: 'software', u: 0 },
    { name: 'SANnav Portal', vendor: 'Brocade', cat: 'software', type: 'software', u: 0 },
  ];

  const modelMap: Record<string, any> = {};
  for (const m of models) {
    modelMap[m.name] = await prisma.model.upsert({
      where: { vendor_id_name: { vendor_id: vendorMap[m.vendor].id, name: m.name } },
      update: { category: m.cat as any, device_type: m.type as any, rack_units: m.u },
      create: {
        name: m.name,
        vendor_id: vendorMap[m.vendor].id,
        category: m.cat as any,
        device_type: m.type as any,
        rack_units: m.u,
      },
    });
  }

  // 6. Bulk Inventory Generation
  console.log('Building inventory items...');
  const inventoryData = [];

  // Server Team Data
  for (let i = 1; i <= 10; i++) {
    inventoryData.push({
      serial_number: `SRV-DELL-L${1000 + i}`,
      hostname: `prod-app-srv-${i}`,
      team: 'Server Team',
      model: i % 2 === 0 ? 'PowerEdge R750' : 'PowerEdge R650',
      rack: 'RACK-A01',
      u_start: i * 2,
      status: 'active'
    });
  }

  // Storage Team Data
  for (let i = 1; i <= 5; i++) {
    inventoryData.push({
      serial_number: `STO-PURE-S${5000 + i}`,
      hostname: `flash-storage-0${i}`,
      team: 'Storage Team',
      model: 'FlashArray //X',
      rack: 'RACK-B01',
      u_start: i * 4,
      status: 'active'
    });
  }

  // Network Team Data
  for (let i = 1; i <= 8; i++) {
    inventoryData.push({
      serial_number: `NET-CIS-N${9000 + i}`,
      hostname: `edge-switch-0${i}`,
      team: 'Network Team',
      model: 'Catalyst 9300-48P',
      rack: 'RACK-A02',
      u_start: i * 2,
      status: 'active'
    });
  }

  // Software Licenses
  inventoryData.push(
    { serial_number: 'LIC-VMW-VC-001', hostname: 'vcenter-prod', team: 'Server Team', model: 'vCenter Server', rack: null, u_start: null, status: 'active' },
    { serial_number: 'LIC-PL-PAN-001', hostname: 'firewall-mgr', team: 'Network Team', model: 'Panorama Management', rack: null, u_start: null, status: 'active' }
  );

  // Inactive Items (In Warehouse)
  inventoryData.push(
    { serial_number: 'OLD-SRV-DELL-01', hostname: 'srv-deprecated-01', team: 'Server Team', model: 'PowerEdge R750', rack: null, u_start: null, status: 'inactive' },
    { serial_number: 'DEP-SW-CISCO-01', hostname: 'sw-spare-01', team: 'Network Team', model: 'Catalyst 9300-48P', rack: null, u_start: null, status: 'inactive' }
  );

  for (const item of inventoryData) {
    await prisma.inventoryItem.upsert({
      where: { serial_number: item.serial_number },
      update: {
        status: item.status as any,
        team_id: teamMap[item.team].id,
        model_id: modelMap[item.model].id,
        rack_id: item.rack ? rackMap[item.rack].id : null,
        rack_unit_start: item.u_start,
      },
      create: {
        serial_number: item.serial_number,
        hostname: item.hostname,
        team_id: teamMap[item.team].id,
        model_id: modelMap[item.model].id,
        rack_id: item.rack ? rackMap[item.rack].id : null,
        rack_unit_start: item.u_start,
        rack_unit_size: modelMap[item.model].rack_units,
        status: item.status as any,
        ip_address: item.u_start ? `10.10.1.${10 + (item.u_start || 0)}` : null,
        storage_location: item.status === 'inactive' ? 'Central Warehouse - Shelf B' : null,
      },
    });
  }

  console.log('--- Mock Data Generation Seed Successful ---');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
