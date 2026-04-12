import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';

// Vendors
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

export const createVendor = async (req: Request, res: Response) => {
  try {
    const vendor = await prisma.vendor.create({
      data: req.body
    });
    res.status(201).json(vendor);
  } catch (err) {
    res.status(400).json({ error: 'Failed to create vendor' });
  }
};

// LDAP Config
export const getLDAPConfig = async (req: Request, res: Response) => {
  try {
    const config = await prisma.lDAPConfig.findFirst() || {};
    res.json(config);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch LDAP config' });
  }
};

export const updateLDAPConfig = async (req: Request, res: Response) => {
  try {
    const existing = await prisma.lDAPConfig.findFirst();
    let config;
    if (existing) {
      config = await prisma.lDAPConfig.update({
        where: { id: existing.id },
        data: req.body
      });
    } else {
      config = await prisma.lDAPConfig.create({
        data: req.body
      });
    }
    res.json(config);
  } catch (err) {
    res.status(400).json({ error: 'Failed to update LDAP config' });
  }
};

// Models
export const updateModel = async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const model = await prisma.model.update({
      where: { id: parseInt(id as string) },
      data: req.body
    });
    res.json(model);
  } catch (err) {
    res.status(400).json({ error: 'Failed to update model' });
  }
};

export const deleteModel = async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    await prisma.model.delete({
      where: { id: parseInt(id as string) }
    });
    res.status(204).send();
  } catch (err) {
    res.status(400).json({ error: 'Failed to delete model' });
  }
};
// Integrations
export const getIntegrations = async (req: Request, res: Response) => {
  try {
    const configs = await prisma.integrationConfig.findMany({
      include: { team: true },
      orderBy: { created_at: 'desc' }
    });
    res.json({ results: configs });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch integrations' });
  }
};

export const createIntegration = async (req: Request, res: Response) => {
  const { name, integration_type, base_url, username, password, api_key, team } = req.body;
  try {
    const config = await prisma.integrationConfig.create({
      data: {
        name,
        integration_type,
        url: base_url,
        username,
        password,
        api_key,
        team_id: parseInt(team),
        is_active: true
      }
    });
    res.status(201).json(config);
  } catch (err: any) {
    console.error(err);
    res.status(400).json({ error: 'Failed to create integration config' });
  }
};

export const deleteIntegration = async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    await prisma.integrationConfig.delete({
      where: { id: parseInt(id as string) }
    });
    res.status(204).send();
  } catch (err) {
    res.status(400).json({ error: 'Failed to delete integration' });
  }
};

import { integrationQueue } from '../workers/integration.worker';

export const triggerSync = async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const config = await prisma.integrationConfig.findUnique({ where: { id: parseInt(id as string) } });
    if (!config) return res.status(404).json({ error: 'Integration not found' });
    
    // Add to BullMQ queue
    await integrationQueue.add('sync-one', { integrationId: config.id });
    
    res.json({ message: 'Sync triggered' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to trigger sync' });
  }
};
