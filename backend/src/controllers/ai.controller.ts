import { Request, Response } from 'express';
import { processChatMessage } from '../services/ai.service';

export const chatWithAI = async (req: Request, res: Response) => {
  const { messages } = req.body;

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'Mesaj geçmişi (messages) gereklidir.' });
  }

  try {
    const result = await processChatMessage(messages);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: 'AI servisiyle iletişim kurulamadı.', details: err.message });
  }
};
