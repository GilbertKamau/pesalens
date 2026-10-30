import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import { CATEGORIES, TRANSACTION_TYPES, type Category, type Direction, type Transaction, type TransactionType } from '../domain/transaction.ts';

export interface StoredTransaction extends Transaction {
  id: number;
}

export interface TransactionFilter {
  from?: string;
  to?: string;
  category?: Category;
  type?: TransactionType;
  direction?: Direction;
  counterparty?: string;
  search?: string;
}

interface Row {
  id: number;
  reference: string;
  occurred_at: string;
  description: string;
  amount_cents: number;
  direction: Direction;
  type: TransactionType;
  category: Category;
  counterparty: string | null;
}

const toTransaction = (r: Row): StoredTransaction => ({
  id: r.id, reference: r.reference, occurredAt: r.occurred_at, description: r.description, amountCents: r.amount_cents,
  direction: r.direction, type: r.type, category: r.category, counterparty: r.counterparty,
});

const escapeLike = (value: string) => value.replace(/[\\%_]/g, '\\$&');

export class TransactionRepository {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  existingReferences(references: string[]): Set<string> {
    const lookup = this.db.prepare('SELECT 1 FROM transactions WHERE reference = ?');
    return new Set(references.filter((r) => lookup.get(r)));
  }

  importStatement(fileName: string, transactions: Transaction[]): number {
    const now = new Date().toISOString();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const { lastInsertRowid } = this.db.prepare('INSERT INTO statements (file_name, imported_at) VALUES (?, ?)').run(fileName, now);
      const insert = this.db.prepare(`INSERT INTO transactions
        (statement_id, reference, occurred_at, description, amount_cents, direction, type, category, counterparty, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      for (const t of transactions) {
        insert.run(lastInsertRowid, t.reference, t.occurredAt, t.description, t.amountCents, t.direction, t.type, t.category, t.counterparty, now);
      }
      this.db.exec('COMMIT');
      return Number(lastInsertRowid);
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  private where(filter: TransactionFilter): { sql: string; params: SQLInputValue[] } {
    const clauses: string[] = [];
    const params: SQLInputValue[] = [];
    const add = (clause: string, value: SQLInputValue) => {
      clauses.push(clause);
      params.push(value);
    };
    if (filter.from) add('occurred_at >= ?', filter.from);
    if (filter.to) add('occurred_at < ?', filter.to);
    if (filter.category) add('category = ?', filter.category);
    if (filter.type) add('type = ?', filter.type);
    if (filter.direction) add('direction = ?', filter.direction);
    if (filter.counterparty) add("counterparty LIKE ? ESCAPE '\\'", `%${escapeLike(filter.counterparty)}%`);
    if (filter.search) add("description LIKE ? ESCAPE '\\'", `%${escapeLike(filter.search)}%`);
    return { sql: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params };
  }

  list(filter: TransactionFilter, sort: 'date' | 'amount', limit: number, offset: number): StoredTransaction[] {
    const { sql, params } = this.where(filter);
    const order = sort === 'amount' ? 'amount_cents DESC' : 'occurred_at DESC';
    const rows = this.db.prepare(`SELECT * FROM transactions ${sql} ORDER BY ${order}, id DESC LIMIT ? OFFSET ?`).all(...params, limit, offset);
    return (rows as unknown as Row[]).map(toTransaction);
  }

  all(filter: TransactionFilter): StoredTransaction[] {
    const { sql, params } = this.where(filter);
    return (this.db.prepare(`SELECT * FROM transactions ${sql} ORDER BY occurred_at`).all(...params) as unknown as Row[]).map(toTransaction);
  }

  updateCategory(id: number, category: Category): boolean {
    if (!CATEGORIES.includes(category)) throw new RangeError('Unknown category');
    return this.db.prepare('UPDATE transactions SET category = ? WHERE id = ?').run(category, id).changes === 1;
  }

  deleteAll(): void {
    this.db.exec('DELETE FROM statements');
  }
}

export { TRANSACTION_TYPES };
