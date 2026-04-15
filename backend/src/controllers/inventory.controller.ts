import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';

export const getItems = async (req: Request, res: Response) => {
  const { rack, search, device_type, vendor, model, status = 'active', page = '1', ordering = '-created_at' } = req.query;
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
    if (vendor) where.model = { vendor_id: parseInt(vendor as string) };
    if (model) where.model_id = parseInt(model as string);
    
    if (search) {
      where.OR = [
        { serial_number: { contains: search as string, mode: 'insensitive' } },
        { hostname: { contains: search as string, mode: 'insensitive' } },
        { ip_address: { contains: search as string, mode: 'insensitive' } },
        { model: { name: { contains: search as string, mode: 'insensitive' } } },
        { model: { vendor: { name: { contains: search as string, mode: 'insensitive' } } } },
      ];
    }
    if (device_type) {
      if (where.model) {
        where.model.device_type = device_type as any;
      } else {
        where.model = { device_type: device_type as any };
      }
    }

    // Dynamic ordering
    const ord = Array.isArray(ordering) ? String(ordering[0]) : String(ordering);
    const orderField = ord.replace('-', '') || 'created_at';
    const orderDir = ord.startsWith('-') ? 'desc' : 'asc';

    const [items, count] = await Promise.all([
      prisma.inventoryItem.findMany({
        where,
        include: { 
          model: { include: { vendor: true } }, 
          rack: { include: { room: { include: { datacenter: true } } } },
          team: true 
        },
        orderBy: { [orderField]: orderDir },
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
      created_at: item.created_at.toISOString().split('T')[0],
      updated_at: item.updated_at.toISOString().split('T')[0],
      purchase_date: item.purchase_date?.toISOString().split('T')[0],
      warranty_expiry: item.warranty_expiry?.toISOString().split('T')[0],
      firmware_version: item.firmware_version,
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

import * as XLSX from 'xlsx';

export const exportInventory = async (req: Request, res: Response) => {
  const { search, device_type, vendor, model, status, scope = 'filtered' } = req.query;
  const { team_id, role } = (req as any).user || {};

  try {
    const where: any = {};
    if (scope === 'filtered') {
      if (status && status !== 'all') where.status = status as string;
      if (vendor) where.model = { vendor_id: parseInt(vendor as string) };
      if (model) where.model_id = parseInt(model as string);
      if (device_type) {
         if (where.model) where.model.device_type = device_type as any;
         else where.model = { device_type: device_type as any };
      }
      if (search) {
        where.OR = [
          { serial_number: { contains: search as string, mode: 'insensitive' } },
          { hostname: { contains: search as string, mode: 'insensitive' } },
        ];
      }
    }
    
    if (role !== 'admin' && team_id) where.team_id = team_id;

    const items = await prisma.inventoryItem.findMany({
      where,
      include: { model: { include: { vendor: true } }, team: true }
    });

    const data = items.map(i => ({
      'Serial Number': i.serial_number,
      'Hostname': i.hostname || '',
      'IP Address': i.ip_address || '',
      'Vendor': i.model.vendor.name,
      'Model': i.model.name,
      'Category': i.model.category,
      'Type': i.model.device_type,
      'Status': i.status,
      'Firmware': i.firmware_version || '',
      'Purchase Date': i.purchase_date?.toISOString().split('T')[0] || '',
      'Warranty Expiry': i.warranty_expiry?.toISOString().split('T')[0] || '',
      'Team': i.team?.name || ''
    }));

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(data);
    XLSX.utils.book_append_sheet(wb, ws, 'Inventory');
    
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Disposition', 'attachment; filename="inventory_export.xlsx"');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buf);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Export failed' });
  }
};

export const importInventory = async (req: Request, res: Response) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const { team_id, role } = (req as any).user || {};

  try {
    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const data: any[] = XLSX.utils.sheet_to_json(sheet);

    let createdCount = 0;
    let errors = [];

    // Pre-fetch for mapping
    const models = await prisma.model.findMany({ include: { vendor: true } });

    for (const row of data) {
      const serial = String(row['Serial Number'] || '').trim();
      const vendorName = String(row['Vendor'] || '').trim();
      const modelName = String(row['Model'] || '').trim();
      
      if (!serial || !vendorName || !modelName) {
        errors.push(`Skipping row - Missing Serial/Vendor/Model`);
        continue;
      }

      let model = models.find(m => 
        m.name.toLowerCase() === modelName.toLowerCase() && 
        m.vendor.name.toLowerCase() === vendorName.toLowerCase()
      );

      if (!model) {
        errors.push(`Model "${vendorName} ${modelName}" not found. Please create it in settings first.`);
        continue;
      }

      try {
        await prisma.inventoryItem.create({
          data: {
            serial_number: serial,
            hostname: row['Hostname'] || null,
            ip_address: row['IP Address'] || null,
            model_id: model.id,
            status: (row['Status'] || 'active').toLowerCase(),
            purchase_date: row['Purchase Date'] ? new Date(row['Purchase Date']) : null,
            warranty_expiry: row['Warranty Expiry'] ? new Date(row['Warranty Expiry']) : null,
            team_id: role === 'admin' && row['Team ID'] ? parseInt(row['Team ID']) : (team_id || null),
            notes: row['Notes'] || null
          }
        });
        createdCount++;
      } catch (err: any) {
        if (err.code === 'P2002') {
          errors.push(`Serial ${serial} already exists.`);
        } else {
          errors.push(`Serial ${serial}: ${err.message}`);
        }
      }
    }

    res.json({ createdCount, totalRows: data.length, errors });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Import failed' });
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
       created_at: item.created_at?.toISOString().split('T')[0],
       updated_at: item.updated_at?.toISOString().split('T')[0],
       purchase_date: item.purchase_date?.toISOString().split('T')[0],
       warranty_expiry: item.warranty_expiry?.toISOString().split('T')[0],
       firmware_version: item.firmware_version,
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

    const vendorMap: Record<string, any> = {};
    const modelMap: Record<string, any> = {};
    
    items.forEach(item => {
      const vId = item.model.vendor_id;
      const vName = item.model.vendor.name;
      if (!vendorMap[vId]) vendorMap[vId] = { id: vId, name: vName, count: 0 };
      vendorMap[vId].count++;

      const mId = item.model_id;
      const mName = `${vName} ${item.model.name}`;
      if (!modelMap[mId]) modelMap[mId] = { id: mId, name: mName, count: 0 };
      modelMap[mId].count++;
    });

    const vendor_data = Object.values(vendorMap)
      .map((v: any) => ({
        vendor_id: v.id,
        vendor_name: v.name,
        count: v.count,
        percentage: total ? Number(((v.count / total) * 100).toFixed(1)) : 0
      }))
      .sort((a, b) => b.count - a.count);

    const model_data = Object.values(modelMap)
      .map((m: any) => ({
        model_id: m.id,
        model_name: m.name,
        count: m.count
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10); // Top 10 models

    const today = new Date();
    
    // Categorize expired separately
    const expiredItems = items.filter(i => 
      i.status === 'active' && 
      i.warranty_expiry && 
      i.warranty_expiry < today
    );

    const periods = [
      { label: 'Next 6 Months', min: 0, max: 180 },
      { label: 'Next 1 Year', min: 181, max: 365 },
      { label: 'Next 2 Years', min: 366, max: 730 },
    ];

    const warranty_data = periods.map(p => {
      const minDate = new Date(today);
      minDate.setDate(today.getDate() + p.min);
      
      const maxDate = new Date(today);
      maxDate.setDate(today.getDate() + p.max);

      const bucketItems = items.filter(i => 
        i.status === 'active' && 
        i.warranty_expiry && 
        i.warranty_expiry >= minDate && 
        i.warranty_expiry <= maxDate
      );

      return {
        period: p.label,
        count: bucketItems.length,
        items: bucketItems.map(i => ({
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

    // Add expired at the beginning
    const full_warranty_data = [
      {
        period: 'Expired!',
        count: expiredItems.length,
        items: expiredItems.map(i => ({
          id: i.id,
          serial_number: i.serial_number,
          hostname: i.hostname,
          ip_address: i.ip_address,
          warranty_expiry: i.warranty_expiry?.toISOString().split('T')[0],
          vendor_name: i.model.vendor.name,
          model_name: i.model.name
        }))
      },
      ...warranty_data
    ];

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
      model_distribution: model_data,
      warranty_expiry: full_warranty_data,
      device_type_distribution: type_data,
      status_distribution: status_data
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch analytics' });
  }
};

import { auditLog } from '../utils/logger';
import { z } from 'zod';

const CreateItemSchema = z.object({
  serial_number: z.string().min(3),
  hostname: z.string().optional().nullable(),
  ip_address: z.string().regex(/^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/).optional().nullable().or(z.literal('')),
  model: z.coerce.number(),
  rack: z.coerce.number().optional().nullable(),
  rack_unit_start: z.coerce.number().optional().nullable(),
  rack_unit_size: z.coerce.number().min(1).optional().default(1),
  purchase_date: z.string().datetime().optional().nullable().or(z.literal('')),
  warranty_expiry: z.string().datetime().optional().nullable().or(z.literal('')),
  status: z.enum(['active', 'inactive', 'maintenance', 'decommissioned']).default('active'),
  notes: z.string().optional().nullable(),
  team: z.coerce.number().optional().nullable()
});

export const createItem = async (req: Request, res: Response) => {
  const { team_id, role } = (req as any).user || {};
  
  const validation = CreateItemSchema.safeParse(req.body);
  if (!validation.success) {
    return res.status(400).json({ errors: validation.error.flatten().fieldErrors });
  }

  const data = validation.data;

  try {
    const newItem = await prisma.$transaction(async (tx) => {
      const model = await tx.model.findUnique({ where: { id: data.model } });
      if (!model) throw new Error('Model not found');

      // Basic rack placement validation (Only for Hardware)
      if (model.category === 'hardware' && data.rack && data.rack_unit_start) {
        const rackId = data.rack;
        const startU = data.rack_unit_start;
        const size = data.rack_unit_size;
        const endU = startU + size - 1;

        const rack = await tx.rack.findUnique({ where: { id: rackId } });
        if (!rack) throw new Error('Rack not found');

        if (endU > rack.total_units) {
          throw new Error(`Placement U${startU}–U${endU} exceeds rack capacity (${rack.total_units}U).`);
        }

        const conflicts = await tx.inventoryItem.findMany({
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
            throw new Error(`U-slot conflict with ${item.serial_number} (U${itemStart}–U${itemEnd}).`);
          }
        }
      }

      return tx.inventoryItem.create({
        data: {
          serial_number: data.serial_number,
          hostname: data.hostname,
          ip_address: data.ip_address,
          model_id: model.id,
          rack_id: model.category === 'hardware' && data.rack ? data.rack : null,
          rack_unit_start: model.category === 'hardware' && data.rack_unit_start ? data.rack_unit_start : null,
          rack_unit_size: data.rack_unit_size,
          purchase_date: data.purchase_date ? new Date(data.purchase_date) : null,
          warranty_expiry: data.warranty_expiry ? new Date(data.warranty_expiry) : null,
          status: data.status,
          notes: data.notes,
          team_id: role === 'admin' && data.team ? data.team : (team_id || null)
        }
      });
    });

    const user = (req as any).user;
    await auditLog(user?.id || null, 'ITEM_CREATED', `Device ${newItem.serial_number} (ID: ${newItem.id}) created`, newItem.team_id);

    res.status(201).json(newItem);
  } catch (err: any) {
    console.error(err);
    if (err.message && (err.message.includes('conflict') || err.message.includes('not found') || err.message.includes('exceeds'))) {
      return res.status(400).json({ error: err.message });
    }
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
