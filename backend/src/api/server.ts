import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import express, { type NextFunction, type Request, type Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import helmet from 'helmet';
import type { AiProvider } from '../application/ai-provider.ts';
import { Assistant } from '../application/assistant.ts';
import { AppError } from '../application/errors.ts';
import { formatKes } from '../domain/money.ts';
import { parseStatement } from '../domain/statement.ts';
import { CATEGORIES, TRANSACTION_TYPES, summarize, type Category, type TransactionType } from '../domain/transaction.ts';
import type { TransactionFilter, TransactionRepository } from '../infrastructure/transaction-repository.ts';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const FILE_NAME = /^[\w .()-]{1,120}\.csv$/i;
const MAX_UPLOAD = 5 * 1024 * 1024;

export interface ServerOptions {
  repo: TransactionRepository;
  ai: AiProvider;
  port: number;
  staticDir?: string;
}

function parseFile(req: Request) {
  const name = String(req.query.name ?? '');
  if (!FILE_NAME.test(name)) throw new AppError('FILE_FORMAT_ERROR', 'Choose a .csv statement file.');
  if (!req.is('text/csv')) throw new AppError('FILE_FORMAT_ERROR', 'The file must be CSV.');
  if (typeof req.body !== 'string' || !req.body.length) throw new AppError('FILE_FORMAT_ERROR', 'The file is empty.');
  if (req.body.includes('\0')) throw new AppError('FILE_FORMAT_ERROR', 'The file is not a text statement.');
  try {
    return { name, parsed: parseStatement(req.body) };
  } catch (error) {
    if (error instanceof RangeError) throw new AppError('FILE_FORMAT_ERROR', error.message);
    throw error;
  }
}

function readFilter(query: Request['query']): TransactionFilter {
  const filter: TransactionFilter = {};
  const { from, to, category, type, search } = query;
  if (from !== undefined) {
    if (typeof from !== 'string' || !DATE.test(from)) throw new AppError('VALIDATION_ERROR', 'Invalid start date.');
    filter.from = from;
  }
  if (to !== undefined) {
    if (typeof to !== 'string' || !DATE.test(to)) throw new AppError('VALIDATION_ERROR', 'Invalid end date.');
    filter.to = to;
  }
  if (category !== undefined) {
    if (!CATEGORIES.includes(category as Category)) throw new AppError('VALIDATION_ERROR', 'Unknown category.');
    filter.category = category as Category;
  }
  if (type !== undefined) {
    if (!TRANSACTION_TYPES.includes(type as TransactionType)) throw new AppError('VALIDATION_ERROR', 'Unknown type.');
    filter.type = type as TransactionType;
  }
  if (search !== undefined) {
    if (typeof search !== 'string' || search.length > 100) throw new AppError('VALIDATION_ERROR', 'Invalid search.');
    filter.search = search;
  }
  return filter;
}

function overview(repo: TransactionRepository) {
  const rows = repo.all({});
  const months = new Map<string, typeof rows>();
  for (const row of rows) months.set(row.occurredAt.slice(0, 7), [...(months.get(row.occurredAt.slice(0, 7)) ?? []), row]);
  const spendingTypes = ['expense', 'fee', 'withdrawal'];
  const categories = new Map<string, number>();
  for (const row of rows) if (spendingTypes.includes(row.type)) categories.set(row.category, (categories.get(row.category) ?? 0) + row.amountCents);
  return {
    summary: summarize(rows),
    monthly: [...months].map(([month, list]) => ({ month, ...summarize(list) })),
    categories: [...categories].map(([category, cents]) => ({ category, cents })).sort((a, b) => b.cents - a.cents),
    largest: rows.filter((r) => spendingTypes.includes(r.type)).sort((a, b) => b.amountCents - a.amountCents).slice(0, 5),
    recent: rows.slice(-8).reverse(),
  };
}

export function createServer({ repo, ai, port, staticDir }: ServerOptions) {
  const app = express();
  const assistant = new Assistant(ai, repo);
  const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  const allowedOrigins = new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`, 'http://localhost:5173', 'http://127.0.0.1:5173']);

  app.disable('x-powered-by');
  app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"], upgradeInsecureRequests: null } } }));
  app.use((req, res, next) => {
    res.locals.requestId = randomUUID();
    next();
  });
  // Host and Origin checks stop other websites and DNS rebinding from reaching the local API.
  app.use('/api', (req, res, next) => {
    const origin = req.headers.origin;
    if (!allowedHosts.has(req.headers.host ?? '') || (origin && !allowedOrigins.has(origin))) throw new AppError('FORBIDDEN', 'This request is not allowed.');
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }
    next();
  });
  app.use('/api', rateLimit({ windowMs: 60_000, limit: 300, standardHeaders: true, legacyHeaders: false }));
  app.use('/api', express.json({ limit: '10kb', strict: true }));
  app.use('/api/import', express.text({ type: 'text/csv', limit: MAX_UPLOAD }));

  const send = (res: Response, data: unknown) => res.json({ success: true, data });

  app.get('/api/status', (_req, res) => {
    send(res, { ai: ai.getStatus(), version: '0.1.0' });
  });

  app.post('/api/import/preview', (req, res) => {
    const { name, parsed } = parseFile(req);
    const existing = repo.existingReferences(parsed.transactions.map((t) => t.reference));
    send(res, {
      name,
      ready: parsed.transactions.length - existing.size,
      alreadyImported: existing.size,
      duplicatesInFile: parsed.duplicates.length,
      issues: parsed.issues,
      sample: parsed.transactions.slice(0, 5),
    });
  });

  app.post('/api/import/confirm', (req, res) => {
    const { name, parsed } = parseFile(req);
    const existing = repo.existingReferences(parsed.transactions.map((t) => t.reference));
    const fresh = parsed.transactions.filter((t) => !existing.has(t.reference));
    if (!fresh.length) throw new AppError('IMPORT_ERROR', 'There are no new transactions to import.');
    repo.importStatement(name, fresh);
    send(res, { imported: fresh.length, skipped: existing.size + parsed.duplicates.length, issues: parsed.issues.length });
  });

  app.get('/api/overview', (_req, res) => {
    send(res, overview(repo));
  });

  app.get('/api/transactions', (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const sort = req.query.sort === 'amount' ? 'amount' : 'date';
    send(res, repo.list(readFilter(req.query), sort, limit, offset));
  });

  app.patch('/api/transactions/:id', (req, res) => {
    const id = Number(req.params.id);
    const { category, ...rest } = (req.body ?? {}) as { category?: Category };
    if (!Number.isSafeInteger(id) || Object.keys(rest).length || !CATEGORIES.includes(category as Category)) throw new AppError('VALIDATION_ERROR', 'Invalid category update.');
    if (!repo.updateCategory(id, category as Category)) throw new AppError('NOT_FOUND', 'Transaction not found.');
    send(res, { id, category });
  });

  app.post('/api/assistant', async (req, res) => {
    const question = (req.body as { question?: unknown } | undefined)?.question;
    if (typeof question !== 'string' || !question.trim() || question.length > 300) throw new AppError('VALIDATION_ERROR', 'Enter a question of up to 300 characters.');
    send(res, await assistant.ask(question.trim()));
  });

  app.delete('/api/data', (_req, res) => {
    repo.deleteAll();
    send(res, { deleted: true });
  });

  app.use('/api', () => {
    throw new AppError('NOT_FOUND', 'Not found.');
  });

  if (staticDir && existsSync(staticDir)) {
    app.use(express.static(staticDir));
    app.get(/^(?!\/api).*/, (_req, res) => res.sendFile('index.html', { root: staticDir }));
  }

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const requestId = res.locals.requestId as string;
    const tooLarge = (error as { type?: string }).type === 'entity.too.large';
    const badJson = (error as { type?: string }).type === 'entity.parse.failed';
    const known = error instanceof AppError ? error
      : tooLarge ? new AppError('FILE_SIZE_ERROR', 'The file is too large.')
      : badJson ? new AppError('VALIDATION_ERROR', 'The request is not valid JSON.')
      : new AppError('INTERNAL_SERVER_ERROR', 'Something went wrong.');
    if (known.code === 'INTERNAL_SERVER_ERROR') console.error(requestId, (error as Error).name);
    res.status(known.status).json({ success: false, error: { code: known.code, message: known.message, requestId } });
  });

  return app;
}

export { formatKes };
