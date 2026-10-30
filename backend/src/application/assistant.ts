import { formatKes } from '../domain/money.ts';
import { summarize, type Category, type Transaction } from '../domain/transaction.ts';
import type { AiProvider } from './ai-provider.ts';
import { AppError } from './errors.ts';

const OPS = ['received', 'spent', 'summary', 'top_expenses', 'top_senders', 'compare', 'share'] as const;
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const CATEGORY_MAP: Record<string, Category> = {
  food: 'Food', transport: 'Transport', utilities: 'Utilities', shopping: 'Shopping', airtime: 'Airtime',
  salary: 'Salary', freelance: 'Freelance income', business: 'Business income',
};

export type Op = (typeof OPS)[number];

export interface Intent {
  op: Op;
  month: string | null;
  month2: string | null;
  category: string | null;
  person: string | null;
  limit: number | null;
}

export const INTENT_SCHEMA = {
  type: 'object',
  properties: {
    op: { enum: OPS },
    month: { enum: [...MONTHS, null] },
    month2: { enum: [...MONTHS, null] },
    category: { enum: [...Object.keys(CATEGORY_MAP), null] },
    person: { type: ['string', 'null'], maxLength: 40 },
    limit: { type: ['integer', 'null'] },
  },
  required: ['op', 'month', 'month2', 'category', 'person', 'limit'],
  additionalProperties: false,
};

const INTENT_PROMPT = `Convert the question to JSON. op: received, spent, summary, top_expenses, top_senders, compare, share.
Q: How much did I receive in September?
{"op":"received","month":"september","month2":null,"category":null,"person":null,"limit":null}
Q: Compare March and April.
{"op":"compare","month":"march","month2":"april","category":null,"person":null,"limit":null}`;

const FINANCE_WORDS = /receiv|earn|income|spen|expens|paid|pay|sent|send|cost|summar|compare|largest|biggest|percent|%|share|money|cash|top/i;

export function isFinancialQuestion(question: string): boolean {
  return FINANCE_WORDS.test(question);
}

export function parseIntent(raw: string, question: string): Intent {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
  } catch {
    throw new AppError('AI_INVALID_RESPONSE', 'The question could not be interpreted. Please rephrase it.');
  }
  const value = parsed as Record<string, unknown>;
  const q = question.toLowerCase();
  if (!OPS.includes(value.op as Op)) throw new AppError('AI_INVALID_RESPONSE', 'The question could not be interpreted. Please rephrase it.');
  const inQuestion = (name: unknown) => (typeof name === 'string' && q.includes(name.toLowerCase()) ? name.toLowerCase() : null);
  const intent: Intent = {
    op: value.op as Op,
    month: MONTHS.includes(value.month as string) ? inQuestion(value.month) : null,
    month2: MONTHS.includes(value.month2 as string) ? inQuestion(value.month2) : null,
    category: typeof value.category === 'string' && value.category in CATEGORY_MAP ? inQuestion(value.category) : null,
    person: inQuestion(value.person),
    limit: Number.isInteger(value.limit) && (value.limit as number) > 0 ? Math.min(value.limit as number, 20) : null,
  };
  if (/percent|%|what share/.test(q)) intent.op = 'share';
  intent.category ??= Object.keys(CATEGORY_MAP).find((name) => new RegExp(`\\b${name}\\b`).test(q)) ?? null;
  return intent;
}

export interface Figure {
  label: string;
  value: string;
}

export interface Answer {
  period: string;
  figures: Figure[];
  explanation: string | null;
  explanationNote: string | null;
}

export interface TransactionSource {
  all(filter: { from?: string; to?: string; category?: Category; counterparty?: string }): (Transaction & { id: number })[];
}

function monthRange(month: string, rows: Transaction[]): { from: string; to: string; label: string } | null {
  const number = String(MONTHS.indexOf(month) + 1).padStart(2, '0');
  const year = rows.map((r) => r.occurredAt.slice(0, 7)).filter((m) => m.endsWith(`-${number}`)).sort().at(-1)?.slice(0, 4);
  return year ? rangeOf(Number(year), Number(number)) : null;
}

function rangeOf(year: number, month: number) {
  const pad = (y: number, m: number) => `${y}-${String(m).padStart(2, '0')}-01`;
  const to = month === 12 ? pad(year + 1, 1) : pad(year, month + 1);
  return { from: pad(year, month), to, label: `${MONTHS[month - 1][0].toUpperCase()}${MONTHS[month - 1].slice(1)} ${year}` };
}

function relativeRange(question: string, rows: Transaction[]) {
  const latest = rows.map((r) => r.occurredAt.slice(0, 7)).sort().at(-1);
  if (!latest) return null;
  const [year, month] = latest.split('-').map(Number);
  if (/last month/i.test(question)) return month === 1 ? rangeOf(year - 1, 12) : rangeOf(year, month - 1);
  return /this month/i.test(question) ? rangeOf(year, month) : null;
}

export function execute(intent: Intent, question: string, source: TransactionSource): { period: string; figures: Figure[] } {
  const everything = source.all({});
  if (!everything.length) throw new AppError('VALIDATION_ERROR', 'Import a statement before asking questions.');
  const range = intent.month ? monthRange(intent.month, everything) : relativeRange(question, everything);
  if (intent.month && !range) throw new AppError('VALIDATION_ERROR', `There are no transactions in ${intent.month}.`);
  const period = range?.label ?? 'All imported transactions';
  const dates = range ? { from: range.from, to: range.to } : {};
  const category = intent.category ? CATEGORY_MAP[intent.category] : undefined;
  const rows = source.all({ ...dates, category, counterparty: intent.person ?? undefined });
  const spending = (list: Transaction[]) => list.filter((r) => ['expense', 'fee', 'withdrawal'].includes(r.type));

  switch (intent.op) {
    case 'received':
      return { period, figures: [{ label: `Received${category ? ` (${category})` : ''}`, value: formatKes(summarize(rows).incomeCents) }] };
    case 'spent':
      return { period, figures: [{ label: `Spent${category ? ` on ${category}` : ''}`, value: formatKes(summarize(rows).expenditureCents) }] };
    case 'summary': {
      const s = summarize(rows);
      return {
        period,
        figures: [
          { label: 'Income', value: formatKes(s.incomeCents) },
          { label: 'Expenditure', value: formatKes(s.expenditureCents) },
          { label: 'Net cash flow', value: formatKes(s.netCashFlowCents) },
          { label: 'Transactions', value: String(s.transactionCount) },
        ],
      };
    }
    case 'top_expenses': {
      const top = spending(rows).sort((a, b) => b.amountCents - a.amountCents).slice(0, intent.limit ?? 5);
      return { period, figures: top.map((t) => ({ label: t.counterparty ?? t.type, value: formatKes(t.amountCents) })) };
    }
    case 'top_senders': {
      const totals = new Map<string, number>();
      for (const t of rows) if (t.type === 'income') totals.set(t.counterparty ?? 'Unknown', (totals.get(t.counterparty ?? 'Unknown') ?? 0) + t.amountCents);
      const top = [...totals].sort((a, b) => b[1] - a[1]).slice(0, intent.limit ?? 1);
      return { period, figures: top.map(([label, cents]) => ({ label, value: formatKes(cents) })) };
    }
    case 'share': {
      if (!category) throw new AppError('VALIDATION_ERROR', 'Which spending category should the percentage use?');
      const total = summarize(source.all(dates)).expenditureCents;
      const part = summarize(rows).expenditureCents;
      if (total <= 0) throw new AppError('VALIDATION_ERROR', 'There is no expenditure in this period.');
      const tenths = Math.round((part * 1000) / total);
      return { period, figures: [{ label: `${category} share of expenditure`, value: `${Math.floor(tenths / 10)}.${tenths % 10}%` }] };
    }
    case 'compare': {
      const second = intent.month2 ? monthRange(intent.month2, everything) : null;
      if (!range || !second) throw new AppError('VALIDATION_ERROR', 'Please name two months to compare.');
      const a = summarize(rows);
      const b = summarize(source.all({ from: second.from, to: second.to, category }));
      return {
        period: `${range.label} and ${second.label}`,
        figures: [
          { label: `${range.label} income`, value: formatKes(a.incomeCents) },
          { label: `${second.label} income`, value: formatKes(b.incomeCents) },
          { label: `${range.label} expenditure`, value: formatKes(a.expenditureCents) },
          { label: `${second.label} expenditure`, value: formatKes(b.expenditureCents) },
        ],
      };
    }
  }
}

const numbersIn = (text: string) => text.match(/\d[\d,]*(?:\.\d+)?/g)?.map((n) => n.replaceAll(',', '').replace(/\.0+$/, '')) ?? [];

export function isGrounded(explanation: string, facts: string): boolean {
  const allowed = new Set(numbersIn(facts));
  return numbersIn(explanation).every((n) => allowed.has(n));
}

export function completeSentences(text: string): string | null {
  return text.match(/^[\s\S]*[.!?](?=\s|$)/)?.[0].trim() ?? null;
}

export class Assistant {
  private readonly ai: AiProvider;
  private readonly source: TransactionSource;

  constructor(ai: AiProvider, source: TransactionSource) {
    this.ai = ai;
    this.source = source;
  }

  async ask(question: string): Promise<Answer> {
    if (!isFinancialQuestion(question)) throw new AppError('VALIDATION_ERROR', 'Please ask about your income, spending or transactions.');
    const raw = await this.ai.generateResponse({
      messages: [{ role: 'system', content: INTENT_PROMPT }, { role: 'user', content: `${question} /no_think` }],
      maxTokens: 60, timeoutMs: 90_000, jsonSchema: INTENT_SCHEMA,
    });
    const intent = parseIntent(raw, question);
    const { period, figures } = execute(intent, question, this.source);
    // Only computed amounts reach the model, never transaction text or names.
    const prefix = intent.op === 'top_senders' ? 'Total received from sender' : intent.op === 'top_expenses' ? 'Expense' : null;
    const facts = `${period}: ${figures.map((f, i) => `${prefix ? `${prefix} ${i + 1}` : f.label}: ${f.value}`).join('; ')}`;
    try {
      const reply = await this.ai.generateResponse({
        messages: [
          { role: 'system', content: 'Tell the user these verified facts in one short sentence, addressing them as you. Use only the given numbers. /no_think' },
          { role: 'user', content: `Question: ${question}\nFacts: ${facts}` },
        ],
        maxTokens: 90, timeoutMs: 60_000,
      });
      const explanation = completeSentences(reply);
      if (explanation && isGrounded(explanation, facts)) return { period, figures, explanation, explanationNote: null };
      return { period, figures, explanation: null, explanationNote: 'The AI explanation was withheld because it did not match the calculated figures.' };
    } catch (error) {
      if (!(error instanceof AppError)) throw error;
      return { period, figures, explanation: null, explanationNote: error.message };
    }
  }
}
