import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseStatement } from '../src/domain/statement.ts';
import { openDatabase } from '../src/infrastructure/database.ts';
import { TransactionRepository } from '../src/infrastructure/transaction-repository.ts';

const CSV = [
  'Receipt No,Completion Time,Details,Transaction Status,Paid In,Withdrawn,Balance',
  'QAA0000001,2026-08-31 23:59:59,Funds received from 0700 - Client One,Completed,1000.00,,0',
  'QAA0000002,2026-09-01 00:00:00,Merchant Payment to UBER,Completed,,250.50,0',
].join('\n');

const setup = () => new TransactionRepository(openDatabase(':memory:'));

test('import persists and month boundaries are exclusive', () => {
  const repo = setup();
  repo.importStatement('s.csv', parseStatement(CSV).transactions);
  assert.equal(repo.all({ from: '2026-08-01', to: '2026-09-01' }).length, 1);
  assert.equal(repo.all({ from: '2026-09-01', to: '2026-10-01' })[0].amountCents, 25050);
});

test('failed import rolls back completely', () => {
  const repo = setup();
  const { transactions } = parseStatement(CSV);
  repo.importStatement('a.csv', [transactions[0]]);
  assert.throws(() => repo.importStatement('b.csv', [transactions[1], transactions[0]]));
  assert.equal(repo.all({}).length, 1);
});

test('existing references are detected for duplicate imports', () => {
  const repo = setup();
  repo.importStatement('a.csv', parseStatement(CSV).transactions);
  assert.equal(repo.existingReferences(['QAA0000001', 'QNEW000001']).size, 1);
});

test('search treats SQL injection text as plain data', () => {
  const repo = setup();
  repo.importStatement('a.csv', parseStatement(CSV).transactions);
  assert.equal(repo.all({ search: "'; DROP TABLE transactions; --" }).length, 0);
  assert.equal(repo.all({ search: '%' }).length, 0);
  assert.equal(repo.all({}).length, 2);
});

test('category updates validate input and deletion clears everything', () => {
  const repo = setup();
  repo.importStatement('a.csv', parseStatement(CSV).transactions);
  const [first] = repo.all({});
  assert.equal(repo.updateCategory(first.id, 'Food'), true);
  assert.throws(() => repo.updateCategory(first.id, 'Bad' as never), RangeError);
  repo.deleteAll();
  assert.equal(repo.all({}).length, 0);
});
