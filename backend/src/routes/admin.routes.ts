import { Router } from 'express';
import { 
  getVendors, createVendor, 
  getLDAPConfig, updateLDAPConfig,
  updateHardwareModel, deleteHardwareModel 
} from '../controllers/admin.controller';
import { authMiddleware, requireRole } from '../middleware/auth.middleware';

const router = Router();

// Only admins can access these routes
router.use(authMiddleware);
router.use(requireRole(['admin']));

router.get('/vendors/', getVendors);
router.post('/vendors/', createVendor);

router.get('/ldap-config/', getLDAPConfig);
router.patch('/ldap-config/', updateLDAPConfig);

router.patch('/models/:id/', updateHardwareModel);
router.delete('/models/:id/', deleteHardwareModel);

export default router;
