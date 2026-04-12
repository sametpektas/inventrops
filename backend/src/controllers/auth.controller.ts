import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { comparePassword, generateToken, generateRefreshToken, verifyRefreshToken, hashPassword } from '../utils/auth';
import { authenticateLDAP } from '../services/ldap.service';

export const login = async (req: Request, res: Response) => {
  const { username, password } = req.body;

  try {
    console.log(`[Auth] Login attempt for: ${username}`);
    let user = await prisma.user.findUnique({
      where: { username },
      include: { team: true }
    });

    console.log(`[Auth] User found: ${!!user}, isActive: ${user?.is_active}`);
    if (user) console.log(`[Auth] Stored hash: ${user.password.substring(0, 10)}...`);

    let authenticatedUser = null;

    if (user && user.is_active) {
      const isValid = await comparePassword(password, user.password);
      if (isValid) {
        authenticatedUser = user;
      }
    }

    // If local auth failed, try LDAP
    if (!authenticatedUser) {
      authenticatedUser = await authenticateLDAP(username, password);
      // Re-fetch with team info if LDAP succeeded
      if (authenticatedUser) {
        authenticatedUser = await prisma.user.findUnique({
          where: { username },
          include: { team: true }
        });
      }
    }

    if (!authenticatedUser || !authenticatedUser.is_active) {
      return res.status(401).json({ error: 'Invalid credentials or inactive user' });
    }

    const access = generateToken({ id: authenticatedUser.id, username: authenticatedUser.username, role: authenticatedUser.role, team_id: authenticatedUser.team_id });
    const refresh = generateRefreshToken({ id: authenticatedUser.id });

    res.json({
      access,
      refresh,
      user: {
        username: authenticatedUser.username,
        email: authenticatedUser.email,
        role: authenticatedUser.role,
        team_name: authenticatedUser.team?.name
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
};
export const me = async (req: Request, res: Response) => {
  // @ts-ignore - req.user is added by auth middleware
  const userId = req.user?.id;
  if (!userId) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { team: true }
    });
    if (!user) return res.status(404).json({ error: 'User not found' });

    res.json({
      username: user.username,
      email: user.email,
      role: user.role,
      team_name: user.team?.name
    });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const refreshToken = async (req: Request, res: Response) => {
  const { refresh } = req.body;
  if (!refresh) return res.status(400).json({ error: 'Refresh token required' });

  const decoded = verifyRefreshToken(refresh);
  if (!decoded) return res.status(401).json({ error: 'Invalid or expired refresh token' });

  try {
    const user = await prisma.user.findUnique({
      where: { id: decoded.id },
      include: { team: true }
    });

    if (!user || !user.is_active) return res.status(401).json({ error: 'User inactive' });

    const access = generateToken({ 
      id: user.id, 
      username: user.username, 
      role: user.role, 
      team_id: user.team_id 
    });

    res.json({ access });
  } catch (err) {
    res.status(500).json({ error: 'Failed to refresh' });
  }
};

export const getUsers = async (req: Request, res: Response) => {
  try {
    const users = await prisma.user.findMany({
      include: { team: true },
      orderBy: { date_joined: 'desc' }
    });
    res.json({ results: users.map(u => ({
      ...u,
      team_name: u.team?.name
    })) });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch users' });
  }
};

export const getTeams = async (req: Request, res: Response) => {
  try {
    const teams = await prisma.team.findMany({
      orderBy: { name: 'asc' }
    });
    res.json({ results: teams });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch teams' });
  }
};

export const patchUser = async (req: any, res: Response) => {
  const { id } = req.params;
  const { email, first_name, last_name, role, team_id } = req.body;
  
  try {
    // RBAC: Only admin can change roles or other people's data
    if (req.user.role !== 'admin' && parseInt(id as string) !== req.user.id) {
      return res.status(403).json({ error: 'Permission denied' });
    }

    // prevent role escalation if not admin
    const updateData: any = { email, first_name, last_name };
    if (req.user.role === 'admin') {
      if (role) updateData.role = role;
      if (team_id) updateData.team_id = parseInt(team_id);
    }

    const user = await prisma.user.update({
      where: { id: parseInt(id as string) },
      data: updateData
    });
    res.json(user);
  } catch (err) {
    res.status(400).json({ error: 'Failed to update user' });
  }
};

export const createUser = async (req: Request, res: Response) => {
  const { username, email, password, role, team } = req.body;
  try {
    const hp = await hashPassword(password);
    const user = await prisma.user.create({
      data: {
        username,
        email,
        password: hp,
        role: role || 'viewer',
        team_id: team ? parseInt(team) : null
      }
    });
    res.status(201).json(user);
  } catch (err) {
    res.status(400).json({ error: 'Failed to create user. Username or email might already exist.' });
  }
};

export const createTeam = async (req: Request, res: Response) => {
  const { name, description } = req.body;
  try {
    const team = await prisma.team.create({
      data: { name, description }
    });
    res.status(201).json(team);
  } catch (err) {
    res.status(400).json({ error: 'Team name must be unique' });
  }
};

export const deleteTeam = async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    await prisma.team.delete({ where: { id: parseInt(id as string) } });
    res.status(204).send();
  } catch (err) {
    res.status(400).json({ error: 'Cannot delete team with active users' });
  }
};
