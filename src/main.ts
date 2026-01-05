import { startServer } from './server';

startServer().catch((error) => {
  console.error('[GW-API] Failed to start server:', error);
  process.exit(1);
});

