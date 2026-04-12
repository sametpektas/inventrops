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

// Hardware Models
export const updateHardwareModel = async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const model = await prisma.hardwareModel.update({
      where: { id: parseInt(id as string) },
      data: req.body
    });
    res.json(model);
  } catch (err) {
    res.status(400).json({ error: 'Failed to update model' });
  }
};

export const deleteHardwareModel = async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    await prisma.hardwareModel.delete({
      where: { id: parseInt(id as string) }
    });
    res.status(204).send();
  } catch (err) {
    res.status(400).json({ error: 'Failed to delete model' });
  }
};
