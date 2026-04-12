import { Router } from 'express';
import { getItems, getItemDetail, getModels, getVendors, createItem, getAnalytics, updateItem, setStatus, createVendor, createHardwareModel, deleteVendor, deleteHardwareModel } from '../controllers/inventory.controller';
import { authMiddleware } from '../middleware/auth.middleware';

const router = Router();

router.get('/items', authMiddleware, getItems);
router.get('/analytics', authMiddleware, getAnalytics);
router.get('/items/:id', authMiddleware, getItemDetail);
router.patch('/items/:id', authMiddleware, updateItem);
router.patch('/items/:id/set-status', authMiddleware, setStatus);
router.get('/models', authMiddleware, getModels);
router.post('/models', authMiddleware, createHardwareModel);
router.delete('/models/:id', authMiddleware, deleteHardwareModel);
router.get('/vendors', authMiddleware, getVendors);
router.post('/vendors', authMiddleware, createVendor);
router.delete('/vendors/:id', authMiddleware, deleteVendor);
router.post('/items', authMiddleware, createItem);

export default router;
