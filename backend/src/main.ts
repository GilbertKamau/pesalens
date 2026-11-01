import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from './api/server.ts';
import { openDatabase } from './infrastructure/database.ts';
import { QvacProvider } from './infrastructure/qvac-provider.ts';
import { TransactionRepository } from './infrastructure/transaction-repository.ts';

process.env.QVAC_RPC_INIT_TIMEOUT_MS ??= '240000';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const PORT = Number(process.env.PORT ?? 4310);
const dataDir = resolve(root, 'data');
mkdirSync(dataDir, { recursive: true });

const db = openDatabase(resolve(dataDir, 'pesalens.db'));
const ai = new QvacProvider();
const app = createServer({ repo: new TransactionRepository(db), ai, port: PORT, staticDir: resolve(root, 'frontend/dist') });

const server = app.listen(PORT, '127.0.0.1', () => {
  console.log(`PesaLens running at http://127.0.0.1:${PORT}`);
  ai.initialize().then(() => console.log('QVAC model ready'), (error: Error) => console.error(error.message));
});

const stop = async () => {
  server.close();
  await ai.shutdown().catch(() => undefined);
  db.close();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
