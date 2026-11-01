export interface Transaction {
  id: number;
  reference: string;
  occurredAt: string;
  description: string;
  amountCents: number;
  direction: 'in' | 'out';
  type: string;
  category: string;
  counterparty: string | null;
}

export interface Summary {
  incomeCents: number;
  expenditureCents: number;
  netCashFlowCents: number;
  transactionCount: number;
}

export interface Overview {
  summary: Summary;
  monthly: (Summary & { month: string })[];
  categories: { category: string; cents: number }[];
  largest: Transaction[];
  recent: Transaction[];
}

export interface AiStatus {
  state: string;
  model: string;
  device: string | null;
}

export interface Preview {
  name: string;
  ready: number;
  alreadyImported: number;
  duplicatesInFile: number;
  issues: { line: number; message: string }[];
}

export interface Answer {
  period: string;
  figures: { label: string; value: string }[];
  explanation: string | null;
  explanationNote: string | null;
}

export const CATEGORIES = ['Food', 'Transport', 'Utilities', 'Shopping', 'Airtime', 'Business income', 'Freelance income', 'Salary', 'Transfers', 'Withdrawals', 'Transaction fees', 'Other'];
export const TYPES = ['income', 'expense', 'transfer', 'withdrawal', 'deposit', 'fee', 'refund', 'reversal', 'unclassified'];

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, init);
  } catch {
    throw new Error('The PesaLens server cannot be reached.');
  }
  const body = await res.json().catch(() => null);
  if (!body?.success) throw new Error(body?.error?.message ?? 'Something went wrong.');
  return body.data as T;
}

export const sendJson = <T,>(method: 'POST' | 'PATCH', path: string, data: unknown) => api<T>(path, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });

export const postCsv = <T,>(path: string, file: File, text: string) => api<T>(`${path}?name=${encodeURIComponent(file.name)}`, { method: 'POST', headers: { 'content-type': 'text/csv' }, body: text });

export function kes(cents: number): string {
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100).toLocaleString('en-KE');
  return `${cents < 0 ? '-' : ''}KES ${whole}.${String(abs % 100).padStart(2, '0')}`;
}
