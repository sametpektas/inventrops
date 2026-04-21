import https from 'https';

// Global shared agent to prevent memory leaks and reuse sockets efficiently
export const sharedHttpsAgent = new https.Agent({
  rejectUnauthorized: false, 
  keepAlive: true,
  maxSockets: 100,
  maxFreeSockets: 10,
  timeout: 60000
});

// Increase listeners limit to prevent warnings during high-concurrency syncs
sharedHttpsAgent.setMaxListeners(100);
