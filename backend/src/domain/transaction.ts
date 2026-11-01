export const TRANSACTION_TYPES = ['income', 'expense', 'transfer', 'withdrawal', 'deposit', 'fee', 'refund', 'reversal', 'unclassified'] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];
export type Direction = 'in' | 'out';
export const SPENDING_TYPES: readonly TransactionType[] = ['expense', 'fee', 'withdrawal'];

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

export function classifyType(description: string, direction: Direction): TransactionType {
  const d = description.toLowerCase();
  if (/reversal|reversed/.test(d)) return 'reversal';
  if (/refund/.test(d)) return 'refund';
  if (/charge|\bfee\b/.test(d)) return 'fee';
  if (/withdrawal|withdraw/.test(d)) return 'withdrawal';
  if (/deposit of funds|cash deposit/.test(d)) return 'deposit';
  if (/m-shwari|mshwari|own account|kcb m-pesa/.test(d)) return 'transfer';
  return direction === 'in' ? 'income' : 'expense';
}

export function classifyCategory(description: string, type: TransactionType): Category {
  const d = description.toLowerCase();
  if (type === 'fee') return 'Transaction fees';
  if (type === 'withdrawal') return 'Withdrawals';
  if (type === 'transfer' || type === 'deposit') return 'Transfers';
  if (type === 'income') {
    if (/salary|payroll/.test(d)) return 'Salary';
    if (/freelance|upwork|client|invoice/.test(d)) return 'Freelance income';
    if (/business|till sales|customer payment/.test(d)) return 'Business income';
    return 'Other';
  }
  if (/airtime|safaricom bundle|bundles/.test(d)) return 'Airtime';
  if (/kplc|kenya power|nairobi water|zuku|wifi|utility/.test(d)) return 'Utilities';
  if (/uber|bolt|little cab|matatu|fuel|shell|rubis|total energies/.test(d)) return 'Transport';
  if (/java house|kfc|restaurant|cafe|hotel|food|chicken|naivas fresh/.test(d)) return 'Food';
  if (/naivas|carrefour|quickmart|jumia|shop|supermarket/.test(d)) return 'Shopping';
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
    else if (SPENDING_TYPES.includes(type)) expenditure += amountCents;
    else if (type === 'refund') expenditure -= amountCents;
    else if (type === 'reversal') {
      if (direction === 'in') expenditure -= amountCents;
      else income -= amountCents;
    }
  }
  return { incomeCents: income, expenditureCents: expenditure, netCashFlowCents: income - expenditure, transactionCount: rows.length };
}
