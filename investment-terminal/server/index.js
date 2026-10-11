import { createApp } from './app.js';

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '127.0.0.1';
const { server } = createApp(process.env.DB_FILE ? { dbFile: process.env.DB_FILE } : {});
server.listen(port, host, () => {
  console.log(`Holistic Investment Terminal running at http://${host}:${port}`);
  if (!process.env.ANTHROPIC_API_KEY) console.log('AI layer: not configured (set ANTHROPIC_API_KEY to enable).');
  if (!process.env.MARKET_DATA_ENDPOINT) console.log('Market data: not configured — prices are manual or sample, always dated.');
});
