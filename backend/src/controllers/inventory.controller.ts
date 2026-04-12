import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';

export const getItems = async (req: Request, res: Response) => {
  const { rack, search, device_type, status = 'active', page = '1' } = req.query;
  const skip = (parseInt(page as string) - 1) * 25;
  const { team_id, role } = (req as any).user || {};

  try {
    const where: any = {};
    if (status !== 'all') {
      where.status = status as string;
    }
    
    // Team Scoping: Only filter by team if user is not admin
    if (role !== 'admin' && team_id) {
      where.team_id = team_id;
    }

    if (rack) where.rack_id = parseInt(rack as string);
    if (search) {
      where.OR = [
        { serial_number: { contains: search as string, mode: 'insensitive' } },
        { hostname: { contains: search as string, mode: 'insensitive' } },
        { ip_address: { contains: search as string, mode: 'insensitive' } },
      ];
    }
    if (device_type) {
      where.model = { device_type: device_type as any };
    }

    const [items, count] = await Promise.all([
      prisma.inventoryItem.findMany({
        where,
        include: { 
          model: { include: { vendor: true } }, 
          rack: { include: { room: { include: { datacenter: true } } } },
          team: true 
        },
        orderBy: { created_at: 'desc' },
        skip,
        take: 25
      }),
      prisma.inventoryItem.count({ where })
    ]);

    const results = items.map(item => ({
      ...item,
      model_name: `${item.model.vendor.name} ${item.model.name}`,
      rack_name: item.rack?.name,
      room_name: item.rack?.room?.name,
      datacenter_name: item.rack?.room?.datacenter?.name,
      team_name: item.team?.name,
      location_display: item.rack 
        ? `${item.rack.room.datacenter.name} / ${item.rack.room.name} / ${item.rack.name}`
        : (item.model.category === 'software' ? 'Cloud / Licensing' : 'Storage/Depot')
    }));

    res.json({ results, count });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch items' });
  }
};

export const getItemDetail = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { team_id, role } = (req as any).user || {};

  try {
    const item = await prisma.inventoryItem.findUnique({
      where: { id: parseInt(id as string) },
      include: { 
        model: { include: { vendor: true } }, 
        rack: { include: { room: { include: { datacenter: true } } } },
        team: true
      }
    });

    if (!item) return res.status(404).json({ error: 'Item not found' });

    // Team Scoping check
    if (role !== 'admin' && item.team_id !== team_id) {
       return res.status(403).json({ error: 'Not authorized to view this item' });
    }
    
    res.json({
       ...item,
       model_name: `${item.model.vendor.name} ${item.model.name}`,
       rack_name: item.rack?.name,
       room_name: item.rack?.room?.name,
       datacenter_name: item.rack?.room?.datacenter?.name,
       team_name: item.team?.name,
       location_display: item.rack 
         ? `${item.rack.room.datacenter.name} / ${item.rack.room.name} / ${item.rack.name}`
         : (item.model.category === 'software' ? 'Cloud / Licensing' : 'Storage/Depot')
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch item detail' });
  }
};

export const getModels = async (req: Request, res: Response) => {
  try {
    const models = await prisma.model.findMany({
      include: { vendor: true }
    });
    const results = models.map(m => ({
      ...m,
      vendor_name: m.vendor.name
    }));
    res.json({ results });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch models' });
  }
};

export const getVendors = async (req: Request, res: Response) => {
  try {
    const vendors = await prisma.vendor.findMany({
      orderBy: { name: 'asc' }
    });
    res.json({ results: vendors });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch vendors' });
  }
};

export const getAnalytics = async (req: Request, res: Response) => {
  const { team_id, role } = (req as any).user || {};
  
  try {
    const where: any = {};
    if (role !== 'admin' && team_id) where.team_id = team_id;

    const total = await prisma.inventoryItem.count({ where });
    
    const items = await prisma.inventoryItem.findMany({
      where,
      include: { model: { include: { vendor: true } } }
    });

    const vendorMap: Record<string, number> = {};
    items.forEach(item => {
      const vName = item.model.vendor.name;
      vendorMap[vName] = (vendorMap[vName] || 0) + 1;
    });

    const vendor_data = Object.entries(vendorMap).map(([name, count]) => ({
      vendor_name: name,
      count,
      percentage: total ? Number(((count / total) * 100).toFixed(1)) : 0
    })).sort((a, b) => b.count - a.count);

    const today = new Date();
    const periods = [
      { label: '180 days', days: 180 },
      { label: '360 days', days: 360 },
      { label: '720 days', days: 720 },
    ];

    const warranty_data = periods.map(p => {
      const deadline = new Date(today);
      deadline.setDate(today.getDate() + p.days);
      const expiringItems = items.filter(i => 
        i.status === 'active' && 
        i.warranty_expiry && 
        i.warranty_expiry <= deadline && 
        i.warranty_expiry >= today
      );

      return {
        period: p.label,
        count: expiringItems.length,
        days: p.days,
        items: expiringItems.map(i => ({
          id: i.id,
          serial_number: i.serial_number,
          hostname: i.hostname,
          ip_address: i.ip_address,
          warranty_expiry: i.warranty_expiry?.toISOString().split('T')[0],
          vendor_name: i.model.vendor.name,
          model_name: i.model.name
        }))
      };
    });

    const typeMap: Record<string, number> = {};
    items.forEach(item => {
      const type = item.model?.device_type || 'other';
      typeMap[type] = (typeMap[type] || 0) + 1;
    });

    const type_data = Object.entries(typeMap).map(([type, count]) => ({
      device_type: type,
      count
    }));

    const statusMap: Record<string, number> = {};
    items.forEach(item => {
      statusMap[item.status] = (statusMap[item.status] || 0) + 1;
    });
    const status_data = Object.entries(statusMap).map(([status, count]) => ({
      status,
      count
    }));

    res.json({
      total_items: total,
      vendor_distribution: vendor_data,
      warranty_expiry: warranty_data,
      device_type_distribution: type_data,
      status_distribution: status_data
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch analytics' });
  }
};

export const createItem = async (req: Request, res: Response) => {
  const data = req.body;
  const { team_id, role } = (req as any).user || {};
  
  try {
    const model = await prisma.model.findUnique({ where: { id: parseInt(data.model) } });
    if (!model) return res.status(400).json({ model: ['Model not found'] });

    // Basic rack placement validation (Only for Hardware)
    if (model.category === 'hardware' && data.rack && data.rack_unit_start) {
      const rackId = parseInt(data.rack);
      const startU = parseInt(data.rack_unit_start);
      const size = parseInt(data.rack_unit_size || 1);
      const endU = startU + size - 1;

      const rack = await prisma.rack.findUnique({ where: { id: rackId } });
      if (rack && endU > rack.total_units) {
        return res.status(400).json({ rack: [`Placement U${startU}–U${endU} exceeds rack capacity (${rack.total_units}U).`] });
      }

      const conflicts = await prisma.inventoryItem.findMany({
        where: {
          rack_id: rackId,
          status: 'active',
          NOT: { rack_unit_start: null }
        }
      });

      for (const item of conflicts) {
        const itemStart = item.rack_unit_start!;
        const itemEnd = itemStart + item.rack_unit_size - 1;
        if (startU <= itemEnd && endU >= itemStart) {
          return res.status(400).json({ rack: [`U-slot conflict with ${item.serial_number} (U${itemStart}–U${itemEnd}).`] });
        }
      }
    }

    const newItem = await prisma.inventoryItem.create({
      data: {
        serial_number: data.serial_number,
        hostname: data.hostname,
        ip_address: data.ip_address,
        model_id: model.id,
        rack_id: model.category === 'hardware' && data.rack ? parseInt(data.rack) : null,
        rack_unit_start: model.category === 'hardware' && data.rack_unit_start ? parseInt(data.rack_unit_start) : null,
        rack_unit_size: data.rack_unit_size ? parseInt(data.rack_unit_size) : 1,
        purchase_date: data.purchase_date ? new Date(data.purchase_date) : null,
        warranty_expiry: data.warranty_expiry ? new Date(data.warranty_expiry) : null,
        status: data.status || 'active',
        notes: data.notes,
        team_id: role === 'admin' && data.team ? parseInt(data.team) : (team_id || null)
      }
    });

    res.status(201).json(newItem);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create item' });
  }
};

export const updateItem = async (req: Request, res: Response) => {
  const { id } = req.params;
  const data = req.body;
  const { team_id, role } = (req as any).user || {};

  try {
    const item = await prisma.inventoryItem.findUnique({ where: { id: parseInt(id as string) } });
    if (!item) return res.status(404).json({ error: 'Item not found' });

    if (role !== 'admin' && item.team_id !== team_id) {
       return res.status(403).json({ error: 'Not authorized to update this item' });
    }

    const updated = await prisma.inventoryItem.update({
      where: { id: item.id },
      data: {
        hostname: data.hostname,
        ip_address: data.ip_address,
        rack_id: data.rack ? parseInt(data.rack) : null,
        rack_unit_start: data.rack_unit_start ? parseInt(data.rack_unit_start) : null,
        rack_unit_size: data.rack_unit_size ? parseInt(data.rack_unit_size) : undefined,
        purchase_date: data.purchase_date ? new Date(data.purchase_date) : null,
        warranty_expiry: data.warranty_expiry ? new Date(data.warranty_expiry) : null,
        status: data.status,
        notes: data.notes,
        storage_location: data.storage_location,
        team_id: role === 'admin' && data.team ? parseInt(data.team) : undefined
      }
    });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update item' });
  }
};

export const setStatus = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { status, storage_location } = req.body;
  const { team_id, role } = (req as any).user || {};

  try {
    const item = await prisma.inventoryItem.findUnique({ where: { id: parseInt(id as string) } });
    if (!item) return res.status(404).json({ error: 'Item not found' });

    if (role !== 'admin' && item.team_id !== team_id) {
       return res.status(403).json({ error: 'Not authorized to change status' });
    }

    const updated = await prisma.inventoryItem.update({
      where: { id: item.id },
      data: { 
        status, 
        storage_location: storage_location || null,
        deactivated_at: status === 'inactive' ? new Date() : null,
        ...(status === 'inactive' && { rack_id: null, rack_unit_start: null })
      }
    });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: 'Failed to set status' });
  }
};

export const createVendor = async (req: Request, res: Response) => {
  const { name, website } = req.body;
  try {
    const vendor = await prisma.vendor.create({
      data: { name, website }
    });
    res.status(201).json(vendor);
  } catch (err) {
    res.status(400).json({ error: 'Vendor name must be unique' });
  }
};

export const createModel = async (req: Request, res: Response) => {
  const { name, vendor_id, vendor, device_type, rack_units, rack_unit_size, category } = req.body;
  try {
    const model = await prisma.model.create({
      data: {
        name,
        vendor_id: parseInt(vendor_id || vendor),
        device_type: device_type as any,
        category: category as any || 'hardware',
        rack_units: parseInt(rack_units || rack_unit_size || '1')
      }
    });
    res.status(201).json(model);
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: 'Failed to create model' });
  }
};

export const deleteVendor = async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    await prisma.vendor.delete({ where: { id: parseInt(id as string) } });
    res.status(204).send();
  } catch (err) {
    res.status(400).json({ error: 'Cannot delete vendor with associated models' });
  }
};

export const deleteModel = async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    await prisma.model.delete({ where: { id: parseInt(id as string) } });
    res.status(204).send();
  } catch (err) {
    res.status(400).json({ error: 'Cannot delete model with associated items' });
  }
};
