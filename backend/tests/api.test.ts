import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';
import type { AiProvider } from '../src/application/ai-provider.ts';
import { AppError } from '../src/application/errors.ts';
import { createServer } from '../src/api/server.ts';
import { openDatabase } from '../src/infrastructure/database.ts';
import { TransactionRepository } from '../src/infrastructure/transaction-repository.ts';

const CSV = [
  'Receipt No,Completion Time,Details,Transaction Status,Paid In,Withdrawn,Balance',
  'QAA0000001,2026-09-10 09:00:00,Salary Payment from ACME,Completed,5000.10,,0',
  'QAA0000002,2026-09-11 09:00:00,Merchant Payment to UBER,Completed,,250.50,0',
].join('\n');

const ai: AiProvider = {
  async initialize() {},
  getStatus: () => ({ state: 'UNAVAILABLE', model: 'none', device: null }),
  async generateResponse() {
    throw new AppError('AI_INITIALIZATION_ERROR', 'The local AI is not ready.');
  },
  async shutdown() {},
};

const PORT = 4899;
let server: ReturnType<ReturnType<typeof createServer>['listen']>;
const url = (path: string) => `http://127.0.0.1:${(server.address() as AddressInfo).port}${path}`;
const post = (path: string, body: string, type = 'text/csv') => fetch(url(path), { method: 'POST', body, headers: { 'content-type': type } });

before(async () => {
  const app = createServer({ repo: new TransactionRepository(openDatabase(':memory:')), ai, port: PORT });
  await new Promise<void>((done) => {
    server = app.listen(PORT, '127.0.0.1', () => done());
  });
});
after(() => server.close());

test('preview does not persist, confirm does, and duplicates are skipped', async () => {
  const preview = await (await post('/api/import/preview?name=s.csv', CSV)).json();
  assert.equal(preview.data.ready, 2);
  assert.equal((await (await fetch(url('/api/transactions'))).json()).data.length, 0);
  assert.equal((await (await post('/api/import/confirm?name=s.csv', CSV)).json()).data.imported, 2);
  const again = await post('/api/import/confirm?name=s.csv', CSV);
  assert.equal(again.status, 409);
});

test('dashboard totals work while AI is unavailable', async () => {
  const body = await (await fetch(url('/api/overview'))).json();
  assert.equal(body.data.summary.incomeCents, 500010);
  assert.equal(body.data.summary.expenditureCents, 25050);
  const ask = await post('/api/assistant', JSON.stringify({ question: 'How much did I spend?' }), 'application/json');
  assert.equal(ask.status, 503);
  assert.equal((await ask.json()).error.code, 'AI_INITIALIZATION_ERROR');
});

test('other websites are refused', async () => {
  const res = await fetch(url('/api/data'), { method: 'DELETE', headers: { origin: 'https://evil.example' } });
  assert.equal(res.status, 403);
  assert.equal((await (await fetch(url('/api/overview'))).json()).data.summary.transactionCount, 2);
});

test('unsafe file names and malformed files are rejected', async () => {
  for (const name of ['..%2F..%2Fetc.csv', 'a.exe', 'a.csv%00.exe']) assert.equal((await post(`/api/import/preview?name=${name}`, CSV)).status, 400);
  assert.equal((await post('/api/import/preview?name=a.csv', 'not,a,statement')).status, 400);
  assert.equal((await post('/api/import/preview?name=a.csv', 'a\0b')).status, 400);
});

test('oversized files return a size error', async () => {
  const res = await post('/api/import/preview?name=a.csv', 'x'.repeat(5 * 1024 * 1024 + 1));
  assert.equal(res.status, 413);
  assert.equal((await res.json()).error.code, 'FILE_SIZE_ERROR');
});

test('validation rejects unexpected fields and injection text', async () => {
  const [{ id }] = (await (await fetch(url('/api/transactions'))).json()).data;
  const patch = (body: unknown) => fetch(url(`/api/transactions/${id}`), { method: 'PATCH', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
  assert.equal((await patch({ category: 'Food', amountCents: 1 })).status, 400);
  assert.equal((await patch({ category: "x'; DROP TABLE transactions;--" })).status, 400);
  assert.equal((await patch({ category: 'Food' })).status, 200);
  assert.equal((await fetch(url('/api/transactions?type=bad'))).status, 400);
});

test('errors never expose internals', async () => {
  const body = await (await post('/api/assistant', '{bad', 'application/json')).json();
  assert.equal(body.success, false);
  assert.ok(body.error.requestId);
  assert.doesNotMatch(JSON.stringify(body), /stack|node_modules|\.ts/);
});

test('delete all removes every transaction', async () => {
  assert.equal((await fetch(url('/api/data'), { method: 'DELETE' })).status, 200);
  assert.equal((await (await fetch(url('/api/transactions'))).json()).data.length, 0);
});
