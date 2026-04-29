import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { integrationQueue } from '../workers/integration.worker';
import { HPEOneViewAdapter } from '../integrations/hpe';
import { DellOpenManageAdapter } from '../integrations/dell';
import { XormonAdapter } from '../integrations/xormon';
import { encrypt, decrypt } from '../utils/crypto';

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
      include: { 
        team: true,
        logs: { orderBy: { created_at: 'desc' }, take: 1 }
      },
      orderBy: { created_at: 'desc' }
    });

    // Mask secrets
    const results = configs.map(c => ({
      ...c,
      password: c.password ? '********' : null,
      api_key: c.api_key ? '********' : null
    }));

    res.json({ results });
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
        password: password ? encrypt(password) : null,
        api_key: api_key ? encrypt(api_key) : null,
        team_id: parseInt(team),
        is_active: true
      }
    });
    res.status(201).json({
      ...config,
      password: config.password ? '********' : null,
      api_key: config.api_key ? '********' : null
    });
  } catch (err: any) {
    console.error(err);
    res.status(400).json({ error: 'Failed to create integration config' });
  }
};

export const updateIntegration = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { name, integration_type, url, username, password, api_key, team_id, is_active } = req.body;
  
  try {
    const data: any = {
      name,
      integration_type,
      url,
      username,
      is_active,
      team_id: team_id ? parseInt(team_id) : null
    };

    // Only update secrets if they are changed and NOT masked placeholders — encrypt before saving
    if (password && password !== '********') data.password = encrypt(password);
    if (api_key && api_key !== '********') data.api_key = encrypt(api_key);

    const config = await prisma.integrationConfig.update({
      where: { id: parseInt(id as string) },
      data
    });

    res.json({
      ...config,
      password: config.password ? '********' : null,
      api_key: config.api_key ? '********' : null
    });
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: 'Failed to update integration' });
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

export const testIntegrationConnection = async (req: Request, res: Response) => {
  const { integration_type, base_url, username, password, api_key } = req.body;
  
  // Credentials from the test form are plain text (not yet stored), pass directly
  const config = { url: base_url, username, password, api_key };
  
  try {
    let adapter: any;
    if (integration_type === 'dell_openmanage') adapter = new DellOpenManageAdapter(config);
    else if (integration_type === 'hpe_oneview') adapter = new HPEOneViewAdapter(config);
    else if (integration_type === 'xormon') adapter = new XormonAdapter(config);
    else if (integration_type === 'vrops') {
      const axios = (await import('axios')).default;
      const https = (await import('https')).default;
      const agent = new https.Agent({ rejectUnauthorized: false });

      // Try 1: Token auth (vROps 8.x requires authSource)
      if (username && password) {
        try {
          const tokenRes = await axios.post(`${base_url}/suite-api/api/auth/token/acquire`, {
            username, password, authSource: 'LOCAL'
          }, { httpsAgent: agent, timeout: 10000 });
          if (tokenRes.data?.token) {
            return res.json({ message: 'Connection successful (Token Auth)', version: tokenRes.data });
          }
        } catch (e: any) {
          console.warn(`[vROps Test] Token auth failed: ${e.response?.status} ${e.response?.data?.message || e.message}`);
        }
        // Try 2: Basic auth
        try {
          const basic = Buffer.from(`${username}:${password}`).toString('base64');
          const basicRes = await axios.get(`${base_url}/suite-api/api/versions`, {
            headers: { 'Authorization': `Basic ${basic}`, 'Accept': 'application/json' },
            httpsAgent: agent, timeout: 10000
          });
          return res.json({ message: 'Connection successful (Basic Auth)', version: basicRes.data });
        } catch (e: any) {
          console.warn(`[vROps Test] Basic auth failed: ${e.message}`);
        }
      }
      // Try 3: API Key
      if (api_key) {
        try {
          const keyRes = await axios.get(`${base_url}/suite-api/api/versions`, {
            headers: { 'Authorization': `vRealizeOpsToken ${api_key}`, 'Accept': 'application/json' },
            httpsAgent: agent, timeout: 10000
          });
          return res.json({ message: 'Connection successful (API Key)', version: keyRes.data });
        } catch {}
      }
      return res.status(422).json({ error: 'vROps connection failed. Check URL, username/password or API key.' });
    } else if (integration_type === 'ai_assistant') {
      const axios = (await import('axios')).default;
      const https = (await import('https')).default;
      const agent = new https.Agent({ rejectUnauthorized: false });
      
      try {
        const response = await axios.get(`${base_url}/models`, {
          headers: api_key ? { 'Authorization': `Bearer ${api_key}` } : {},
          httpsAgent: agent,
          timeout: 5000
        });
        return res.json({ message: 'AI Connection successful', models: response.data?.data?.length || 0 });
      } catch (e: any) {
        return res.status(422).json({ error: `AI connection failed: ${e.response?.data?.error?.message || e.message}` });
      }
    }
    else return res.status(400).json({ error: 'Invalid integration type' });

    const ok = await adapter.testConnection();
    if (ok) {
      res.json({ message: 'Connection successful' });
    } else {
      res.status(422).json({ error: 'Connection failed. Please check your credentials and URL.' });
    }
  } catch (err: any) {
    res.status(500).json({ error: `Connection error: ${err.message}` });
  }
};
