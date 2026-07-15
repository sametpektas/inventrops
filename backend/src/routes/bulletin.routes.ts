import { Router } from 'express';
import { generateBulletin, uploadLogo, getLogoStatus } from '../controllers/bulletin.controller';
import { generateKpiExcel } from '../controllers/kpi.controller';
import { authMiddleware, requireRole } from '../middleware/auth.middleware';
import multer from 'multer';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } }); // 5MB limit
const router = Router();

// Endpoint to generate PowerPoint bulletin report
router.post('/generate-pptx', authMiddleware, generateBulletin);

// Endpoint to generate Monthly KPI Excel report
router.post('/generate-excel', authMiddleware, generateKpiExcel);

// Logo management endpoints (admin only)
router.post('/upload-logo', authMiddleware, requireRole(['admin', 'manager']), upload.single('logo'), uploadLogo);
router.get('/logo-status', authMiddleware, getLogoStatus);

export default router;
