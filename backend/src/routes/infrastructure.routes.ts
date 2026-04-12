import { Router } from 'express';
import { getDatacenters, getRooms, getRacks, getRackDetail, createDatacenter, createRoom, createRack, deleteDatacenter } from '../controllers/infrastructure.controller';
import { authMiddleware } from '../middleware/auth.middleware';

const router = Router();

router.get('/datacenters', authMiddleware, getDatacenters);
router.post('/datacenters', authMiddleware, createDatacenter);
router.delete('/datacenters/:id', authMiddleware, deleteDatacenter);
router.get('/rooms', authMiddleware, getRooms);
router.post('/rooms', authMiddleware, createRoom);
router.get('/racks', authMiddleware, getRacks);
router.post('/racks', authMiddleware, createRack);
router.get('/racks/:id', authMiddleware, getRackDetail);

export default router;
