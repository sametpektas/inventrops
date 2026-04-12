import { Router } from 'express';
import { 
  getVendors, createVendor, 
  getLDAPConfig, updateLDAPConfig,
  updateModel, deleteModel,
  getIntegrations, createIntegration, deleteIntegration, triggerSync,
  testIntegrationConnection 
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

router.patch('/models/:id/', updateModel);
router.delete('/models/:id/', deleteModel);

// Integrations (Configs)
router.get('/integrations/configs', getIntegrations);
router.post('/integrations/configs', createIntegration);
router.delete('/integrations/configs/:id', deleteIntegration);
router.post('/integrations/configs/:id/trigger-sync', triggerSync);
router.post('/integrations/test-connection', testIntegrationConnection);

export default router;
