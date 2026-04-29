import { Router } from 'express';
import { chatWithAI } from '../controllers/ai.controller';
import { authMiddleware } from '../middleware/auth.middleware';

const router = Router();

// AI Chatbot endpoint - Sadece giriş yapmış kullanıcılar erişebilir
router.post('/chat', authMiddleware, chatWithAI);

export default router;
