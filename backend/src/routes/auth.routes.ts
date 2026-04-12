import { Router } from 'express';
import { login, me, refreshToken, getUsers, getTeams, patchUser, createUser, createTeam, deleteTeam, changePassword } from '../controllers/auth.controller';
import { authMiddleware, requireRole } from '../middleware/auth.middleware';

const router = Router();

router.post('/login', login);
router.post('/token/refresh', refreshToken);
router.get('/me', authMiddleware, me);
router.post('/change-password', authMiddleware, changePassword);

// User and Team management: Only Admins can create/delete/modify others
router.get('/users', authMiddleware, requireRole(['admin', 'manager']), getUsers);
router.post('/users', authMiddleware, requireRole(['admin']), createUser);
router.patch('/users/:id', authMiddleware, patchUser); // patchUser has internal RBAC for self-edits
router.get('/teams', authMiddleware, getTeams);
router.post('/teams', authMiddleware, requireRole(['admin']), createTeam);
router.delete('/teams/:id', authMiddleware, requireRole(['admin']), deleteTeam);

export default router;
