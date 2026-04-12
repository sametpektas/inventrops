import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';

export const getDatacenters = async (req: Request, res: Response) => {
  try {
    const datacenters = await prisma.datacenter.findMany({
      include: {
        _count: { select: { rooms: true } }
      }
    });
    res.json({ results: datacenters.map(dc => ({
      ...dc,
      room_count: dc._count.rooms
    })) });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch datacenters' });
  }
};

export const getRooms = async (req: Request, res: Response) => {
  const { datacenter } = req.query;
  try {
    const rooms = await prisma.room.findMany({
      where: {
        ...(datacenter && { datacenter_id: parseInt(datacenter as string) })
      },
      include: {
        datacenter: true,
        _count: { select: { racks: true } }
      }
    });
    res.json({ results: rooms.map(r => ({
      ...r,
      datacenter_name: r.datacenter.name,
      rack_count: r._count.racks
    })) });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch rooms' });
  }
};

export const getRacks = async (req: Request, res: Response) => {
  const { room } = req.query;
  try {
    const racks = await prisma.rack.findMany({
      where: {
        ...(room && { room_id: parseInt(room as string) })
      },
      include: {
        room: true,
        items: true
      }
    });
    res.json({ results: racks.map(r => ({
      ...r,
      room_name: r.room.name,
      utilization_percent: Math.round((r.items.length / r.total_units) * 100)
    })) });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch racks' });
  }
};

export const getRackDetail = async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const rack = await prisma.rack.findUnique({
      where: { id: parseInt(id) },
      include: { room: { include: { datacenter: true } } }
    });
    if (!rack) return res.status(404).json({ error: 'Rack not found' });
    res.json(rack);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch rack detail' });
  }
};

export const createDatacenter = async (req: Request, res: Response) => {
  const { name, location, address, team } = req.body;
  try {
    // If no team specified, pick the first one as default to avoid null constraint
    let teamId = team ? parseInt(team) : null;
    if (!teamId) {
      const firstTeam = await prisma.team.findFirst();
      if (firstTeam) teamId = firstTeam.id;
    }

    const dc = await prisma.datacenter.create({
      data: { 
        name, 
        location, 
        address,
        team_id: teamId || 1 // Fallback to 1 if no teams exist at all
      }
    });
    res.status(201).json(dc);
  } catch (err) {
    res.status(400).json({ error: 'Datacenter name must be unique' });
  }
};

export const createRoom = async (req: Request, res: Response) => {
  const { name, datacenter_id, datacenter, floor } = req.body;
  console.log('[Room] Create request:', req.body);
  try {
    const dId = parseInt(datacenter_id || datacenter);
    if (isNaN(dId)) {
      console.error('[Room] Invalid datacenter ID');
      return res.status(400).json({ error: 'Invalid datacenter ID' });
    }

    const room = await prisma.room.create({
      data: {
        name,
        datacenter_id: dId,
        floor: floor ? floor.toString() : '0'
      }
    });
    res.status(201).json(room);
  } catch (err: any) {
    console.error('[Room] Create error:', err);
    if (err.code === 'P2002') {
      return res.status(400).json({ error: 'Room name already exists in this datacenter' });
    }
    res.status(400).json({ error: 'Failed to create room. Ensure all fields are valid.' });
  }
};

export const createRack = async (req: Request, res: Response) => {
  const { name, room_id, room, total_units } = req.body;
  try {
    const rack = await prisma.rack.create({
      data: {
        name,
        room_id: parseInt(room_id || room),
        total_units: parseInt(total_units || '42')
      }
    });
    res.status(201).json(rack);
  } catch (err) {
    res.status(400).json({ error: 'Rack name must be unique within a room' });
  }
};

export const deleteDatacenter = async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    await prisma.datacenter.delete({ where: { id: parseInt(id) } });
    res.status(204).send();
  } catch (err) {
    res.status(400).json({ error: 'Cannot delete datacenter with associated rooms' });
  }
};
