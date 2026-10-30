import { parseCents } from './money.ts';
import { classifyCategory, classifyType, extractCounterparty, type Direction, type Transaction } from './transaction.ts';

export const REQUIRED_COLUMNS = ['Receipt No', 'Completion Time', 'Details', 'Transaction Status', 'Paid In', 'Withdrawn'] as const;

export interface RowIssue {
  line: number;
  message: string;
}

export interface ParsedStatement {
  transactions: Transaction[];
  issues: RowIssue[];
  duplicates: string[];
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      rows.push([...row, field.replace(/\r$/, '')]);
      row = [];
      field = '';
    } else field += char;
  }
  if (quoted) throw new RangeError('Unterminated quoted field');
  if (field || row.length) rows.push([...row, field.replace(/\r$/, '')]);
  return rows.filter((r) => r.some((cell) => cell.trim()));
}

function parseTimestamp(value: string): string | null {
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/);
  if (!match) return null;
  const [year, month, day, hour, minute, second] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  const valid = date.getUTCMonth() === month - 1 && date.getUTCDate() === day && date.getUTCHours() === hour && date.getUTCMinutes() === minute;
  return valid ? `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}` : null;
}

export function parseStatement(text: string): ParsedStatement {
  const rows = parseCsv(text.replace(/^﻿/, ''));
  if (!rows.length) throw new RangeError('The statement is empty');
  const header = rows[0].map((h) => h.trim());
  const missing = REQUIRED_COLUMNS.filter((c) => !header.includes(c));
  if (missing.length) throw new RangeError(`Missing columns: ${missing.join(', ')}`);
  const at = (row: string[], name: string) => (row[header.indexOf(name)] ?? '').trim();

  const result: ParsedStatement = { transactions: [], issues: [], duplicates: [] };
  const seen = new Set<string>();
  rows.slice(1).forEach((row, index) => {
    const line = index + 2;
    if (row.length !== header.length) return result.issues.push({ line, message: 'Wrong number of columns' });
    if (at(row, 'Transaction Status').toLowerCase() !== 'completed') return result.issues.push({ line, message: 'Transaction not completed' });
    const reference = at(row, 'Receipt No');
    const description = at(row, 'Details');
    const occurredAt = parseTimestamp(at(row, 'Completion Time'));
    if (!/^[A-Z0-9]{6,20}$/.test(reference)) return result.issues.push({ line, message: 'Invalid receipt number' });
    if (!description) return result.issues.push({ line, message: 'Missing details' });
    if (!occurredAt) return result.issues.push({ line, message: 'Invalid date' });
    const paidIn = at(row, 'Paid In').replace(/^\+/, '');
    const withdrawn = at(row, 'Withdrawn').replace(/^-/, '');
    if (Boolean(paidIn) === Boolean(withdrawn)) return result.issues.push({ line, message: 'Exactly one of Paid In or Withdrawn is required' });
    let amountCents: number;
    try {
      amountCents = parseCents(paidIn || withdrawn);
    } catch {
      return result.issues.push({ line, message: 'Invalid amount' });
    }
    if (amountCents === 0) return result.issues.push({ line, message: 'Amount must not be zero' });
    if (seen.has(reference)) return result.duplicates.push(reference);
    seen.add(reference);
    const direction: Direction = paidIn ? 'in' : 'out';
    const type = classifyType(description, direction);
    result.transactions.push({
      reference, occurredAt, description, amountCents, direction, type,
      category: classifyCategory(description, type),
      counterparty: extractCounterparty(description),
    });
  });
  return result;
}
