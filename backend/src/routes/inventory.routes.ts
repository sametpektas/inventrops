import { Router } from 'express';
import { getItems, getItemDetail, getModels, getVendors, createItem, getAnalytics, updateItem, setStatus, createVendor, createHardwareModel, deleteVendor, deleteHardwareModel } from '../controllers/inventory.controller';
import { authMiddleware, requireRole } from '../middleware/auth.middleware';

const router = Router();

router.get('/items', authMiddleware, getItems);
router.get('/analytics', authMiddleware, getAnalytics);
router.get('/items/:id', authMiddleware, getItemDetail);
router.patch('/items/:id', authMiddleware, requireRole(['admin', 'manager', 'operator']), updateItem);
router.patch('/items/:id/set-status', authMiddleware, requireRole(['admin', 'manager', 'operator']), setStatus);
router.get('/models', authMiddleware, getModels);
router.post('/models', authMiddleware, requireRole(['admin', 'manager']), createHardwareModel);
router.delete('/models/:id', authMiddleware, requireRole(['admin']), deleteHardwareModel);
router.get('/vendors', authMiddleware, getVendors);
router.post('/vendors', authMiddleware, requireRole(['admin', 'manager']), createVendor);
router.delete('/vendors/:id', authMiddleware, requireRole(['admin']), deleteVendor);
router.post('/items', authMiddleware, requireRole(['admin', 'manager', 'operator']), createItem);

export default router;
