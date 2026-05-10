import { Router } from 'express';
import { getDatacenters, getRooms, getRacks, getRackDetail, createDatacenter, createRoom, createRack, deleteDatacenter, deleteRoom, deleteRack } from '../controllers/infrastructure.controller';
import { authMiddleware, requireRole } from '../middleware/auth.middleware';

const router = Router();

router.get('/datacenters', authMiddleware, getDatacenters);
router.post('/datacenters', authMiddleware, requireRole(['admin', 'manager']), createDatacenter);
router.delete('/datacenters/:id', authMiddleware, requireRole(['admin']), deleteDatacenter);
router.get('/rooms', authMiddleware, getRooms);
router.post('/rooms', authMiddleware, requireRole(['admin', 'manager']), createRoom);
router.delete('/rooms/:id', authMiddleware, requireRole(['admin']), deleteRoom);

router.get('/racks', authMiddleware, getRacks);
router.post('/racks', authMiddleware, requireRole(['admin', 'manager', 'operator']), createRack);
router.get('/racks/:id', authMiddleware, getRackDetail);
router.delete('/racks/:id', authMiddleware, requireRole(['admin']), deleteRack);

export default router;
