import { Router } from 'express';
import { getForecastSummary, getForecastStorage, getForecastSan, getForecastServer, getForecastVirtualization, getForecastHistory, syncForecastData, recalculateForecast } from '../controllers/forecast.controller';
import { authMiddleware, requireRole } from '../middleware/auth.middleware';

const router = Router();

router.get('/summary', authMiddleware, getForecastSummary);
router.get('/storage', authMiddleware, getForecastStorage);
router.get('/san', authMiddleware, getForecastSan);
router.get('/server', authMiddleware, getForecastServer);
router.get('/virtualization', authMiddleware, getForecastVirtualization);
router.get('/:objectId/history', authMiddleware, getForecastHistory);
router.post('/sync', authMiddleware, requireRole(['admin', 'manager']), syncForecastData);
router.post('/recalculate', authMiddleware, requireRole(['admin', 'manager']), recalculateForecast);

export default router;
