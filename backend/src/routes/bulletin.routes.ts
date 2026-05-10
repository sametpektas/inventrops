import { Router } from 'express';
import { generateBulletin } from '../controllers/bulletin.controller';

const router = Router();

// Endpoint to generate PowerPoint bulletin report
router.post('/generate-pptx', generateBulletin);

export default router;
