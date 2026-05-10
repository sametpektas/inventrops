import { Router } from 'express';
import { generateBulletin } from '../controllers/bulletin.controller';
import { generateKpiExcel } from '../controllers/kpi.controller';

const router = Router();

// Endpoint to generate PowerPoint bulletin report
router.post('/generate-pptx', generateBulletin);

// Endpoint to generate Monthly KPI Excel report
router.post('/generate-excel', generateKpiExcel);

export default router;
