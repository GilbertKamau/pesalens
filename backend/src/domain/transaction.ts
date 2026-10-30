export const TRANSACTION_TYPES = ['income', 'expense', 'transfer', 'withdrawal', 'deposit', 'fee', 'refund', 'reversal', 'unclassified'] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];
export type Direction = 'in' | 'out';

export const CATEGORIES = ['Food', 'Transport', 'Utilities', 'Shopping', 'Airtime', 'Business income', 'Freelance income', 'Salary', 'Transfers', 'Withdrawals', 'Transaction fees', 'Other'] as const;
export type Category = (typeof CATEGORIES)[number];

export interface Transaction {
  reference: string;
  occurredAt: string;
  description: string;
  amountCents: number;
  direction: Direction;
  type: TransactionType;
  category: Category;
  counterparty: string | null;
}

const has = (text: string, pattern: RegExp) => pattern.test(text);

export function classifyType(description: string, direction: Direction): TransactionType {
  const d = description.toLowerCase();
  if (has(d, /reversal|reversed/)) return 'reversal';
  if (has(d, /refund/)) return 'refund';
  if (has(d, /charge|\bfee\b/)) return 'fee';
  if (has(d, /withdrawal|withdraw/)) return 'withdrawal';
  if (has(d, /deposit of funds|cash deposit/)) return 'deposit';
  if (has(d, /m-shwari|mshwari|own account|kcb m-pesa/)) return 'transfer';
  return direction === 'in' ? 'income' : 'expense';
}

export function classifyCategory(description: string, type: TransactionType): Category {
  const d = description.toLowerCase();
  if (type === 'fee') return 'Transaction fees';
  if (type === 'withdrawal') return 'Withdrawals';
  if (type === 'transfer' || type === 'deposit') return 'Transfers';
  if (type === 'income') {
    if (has(d, /salary|payroll/)) return 'Salary';
    if (has(d, /freelance|upwork|client|invoice/)) return 'Freelance income';
    if (has(d, /business|till sales|customer payment/)) return 'Business income';
    return 'Other';
  }
  if (has(d, /airtime|safaricom bundle|bundles/)) return 'Airtime';
  if (has(d, /kplc|kenya power|nairobi water|zuku|wifi|utility/)) return 'Utilities';
  if (has(d, /uber|bolt|little cab|matatu|fuel|shell|rubis|total energies/)) return 'Transport';
  if (has(d, /java house|kfc|restaurant|cafe|hotel|food|chicken|naivas fresh/)) return 'Food';
  if (has(d, /naivas|carrefour|quickmart|jumia|shop|supermarket/)) return 'Shopping';
  return 'Other';
}

export function extractCounterparty(description: string): string | null {
  const match = description.match(/(?:from|to)\s+(?:\d+\s*-\s*)?([^-]+?)\s*$/i) ?? description.match(/-\s*([^-]+?)\s*$/);
  return match?.[1]?.trim() || null;
}

export interface Summary {
  incomeCents: number;
  expenditureCents: number;
  netCashFlowCents: number;
  transactionCount: number;
}

// Refunds and inbound reversals reduce spending, outbound reversals reduce income, transfers and deposits are excluded.
export function summarize(rows: readonly Pick<Transaction, 'amountCents' | 'direction' | 'type'>[]): Summary {
  let income = 0;
  let expenditure = 0;
  for (const { amountCents, direction, type } of rows) {
    if (type === 'income') income += amountCents;
    else if (type === 'expense' || type === 'fee' || type === 'withdrawal') expenditure += amountCents;
    else if (type === 'refund') expenditure -= amountCents;
    else if (type === 'reversal') {
      if (direction === 'in') expenditure -= amountCents;
      else income -= amountCents;
    }
  }
  return { incomeCents: income, expenditureCents: expenditure, netCashFlowCents: income - expenditure, transactionCount: rows.length };
}
