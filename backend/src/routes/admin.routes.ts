import { Router } from 'express';
import { 
  getVendors, createVendor, 
  getLDAPConfig, updateLDAPConfig,
  updateHardwareModel, deleteHardwareModel 
} from '../controllers/admin.controller';

const router = Router();

router.get('/vendors/', getVendors);
router.post('/vendors/', createVendor);

router.get('/ldap-config/', getLDAPConfig);
router.patch('/ldap-config/', updateLDAPConfig);

router.patch('/models/:id/', updateHardwareModel);
router.delete('/models/:id/', deleteHardwareModel);

export default router;
