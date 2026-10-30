import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatKes, parseCents } from '../src/domain/money.ts';
import { parseCsv, parseStatement } from '../src/domain/statement.ts';
import { classifyCategory, classifyType, summarize } from '../src/domain/transaction.ts';

const HEADER = 'Receipt No,Completion Time,Details,Transaction Status,Paid In,Withdrawn,Balance';

test('parseCents is exact where floats are not', () => {
  assert.equal(parseCents('0.07'), 7);
  assert.equal(parseCents('1,234.56'), 123456);
  assert.equal(parseCents('19.99') + parseCents('0.01'), 2000);
  assert.equal(parseCents('5.1'), 510);
});

test('parseCents rejects malformed and negative values', () => {
  for (const bad of ['', '-5', '1.234', '1,23', 'abc', '1e5', '9'.repeat(20)]) assert.throws(() => parseCents(bad), RangeError);
});

test('formatKes handles zero, negatives and grouping', () => {
  assert.equal(formatKes(0), 'KES 0.00');
  assert.equal(formatKes(123456789), 'KES 1,234,567.89');
  assert.equal(formatKes(-5), '-KES 0.05');
});

test('classification separates money movement types', () => {
  assert.equal(classifyType('Pay Bill Charge', 'out'), 'fee');
  assert.equal(classifyType('Customer Withdrawal At Agent Till 123', 'out'), 'withdrawal');
  assert.equal(classifyType('Reversal of transaction QAB', 'in'), 'reversal');
  assert.equal(classifyType('Refund from Jumia', 'in'), 'refund');
  assert.equal(classifyType('M-Shwari Deposit', 'out'), 'transfer');
  assert.equal(classifyCategory('Salary Payment from ACME', 'income'), 'Salary');
  assert.equal(classifyCategory('Merchant Payment to UBER', 'expense'), 'Transport');
});

test('summarize excludes transfers and does not double count refunds or reversals', () => {
  const s = summarize([
    { amountCents: 100000, direction: 'in', type: 'income' },
    { amountCents: 30000, direction: 'out', type: 'expense' },
    { amountCents: 1000, direction: 'out', type: 'fee' },
    { amountCents: 50000, direction: 'out', type: 'transfer' },
    { amountCents: 70000, direction: 'in', type: 'deposit' },
    { amountCents: 10000, direction: 'in', type: 'refund' },
    { amountCents: 5000, direction: 'in', type: 'reversal' },
    { amountCents: 2000, direction: 'out', type: 'reversal' },
  ]);
  assert.deepEqual(s, { incomeCents: 98000, expenditureCents: 16000, netCashFlowCents: 82000, transactionCount: 8 });
});

test('summarize handles empty input', () => {
  assert.deepEqual(summarize([]), { incomeCents: 0, expenditureCents: 0, netCashFlowCents: 0, transactionCount: 0 });
});

test('parseCsv handles quotes, escapes and CRLF', () => {
  assert.deepEqual(parseCsv('a,"b,c"\r\n"d""e",f\r\n'), [['a', 'b,c'], ['d"e', 'f']]);
  assert.throws(() => parseCsv('"open'), RangeError);
});

test('parseStatement accepts valid rows and a leap day', () => {
  const r = parseStatement(`${HEADER}\nQAB123XYZ,2024-02-29 23:59:59,Salary Payment from ACME,Completed,"50,000.00",,50000.00\n`);
  assert.equal(r.transactions.length, 1);
  assert.equal(r.transactions[0].occurredAt, '2024-02-29T23:59:59');
  assert.equal(r.transactions[0].amountCents, 5000000);
});

test('parseStatement reports bad rows instead of dropping them', () => {
  const r = parseStatement([
    HEADER,
    'QAB123XYZ,2023-02-29 10:00:00,Bad leap day,Completed,10.00,,0',
    'QAB123XY2,2024-01-01 10:00:00,Both sides,Completed,10.00,5.00,0',
    'QAB123XY3,2024-01-01 10:00:00,Bad amount,Completed,abc,,0',
    'QAB123XY4,2024-01-01 10:00:00,Pending,Failed,10.00,,0',
    'short,row',
    'QAB123XY5,2024-01-01 10:00:00,Good,Completed,10.00,,0',
    'QAB123XY5,2024-01-01 10:00:00,Good,Completed,10.00,,0',
  ].join('\n'));
  assert.equal(r.transactions.length, 1);
  assert.equal(r.issues.length, 5);
  assert.deepEqual(r.duplicates, ['QAB123XY5']);
});

test('parseStatement rejects empty files and missing columns', () => {
  assert.throws(() => parseStatement(''), /empty/);
  assert.throws(() => parseStatement('Receipt No,Details\n'), /Missing columns/);
});
