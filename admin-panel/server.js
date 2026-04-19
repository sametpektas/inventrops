import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createProxyMiddleware } from 'http-proxy-middleware';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 80;
const backendUrl = process.env.BACKEND_URL || 'http://backend:8007';

// Proxy /api requests to backend
app.use('/api', createProxyMiddleware({
  target: backendUrl,
  changeOrigin: true,
}));

// Serve static files
app.use(express.static(path.join(__dirname, 'dist')));

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(port, () => {
  console.log(`Admin panel running on port ${port}, proxying API to ${backendUrl}`);
});
