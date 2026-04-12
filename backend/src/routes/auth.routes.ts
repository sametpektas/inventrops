import { Router } from 'express';
import { login, me, refreshToken, getUsers, getTeams, patchUser, createUser, createTeam, deleteTeam } from '../controllers/auth.controller';
import { authMiddleware } from '../middleware/auth.middleware';

const router = Router();

router.post('/login', login);
router.post('/token/refresh', refreshToken);
router.get('/me', authMiddleware, me);

// User and Team management
router.get('/users', authMiddleware, getUsers);
router.post('/users', authMiddleware, createUser);
router.patch('/users/:id', authMiddleware, patchUser);
router.get('/teams', authMiddleware, getTeams);
router.post('/teams', authMiddleware, createTeam);
router.delete('/teams/:id', authMiddleware, deleteTeam);

export default router;
