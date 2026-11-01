import { createApp } from './app.js';
const { app } = await createApp();
await app.listen({
  port: Number(process.env.PORT || 3000),
  host: process.env.HOST || '0.0.0.0',
});
for (const signal of ['SIGTERM', 'SIGINT'])
  process.on(signal, () => {
    void app.close().then(() => process.exit(0));
  });
