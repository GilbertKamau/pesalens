import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { BarChart3, Bot, FileUp, LayoutDashboard, List, RefreshCw, Shield } from 'lucide-react';
import { api, CATEGORIES, kes, postCsv, sendJson, TYPES, type AiStatus, type Answer, type Overview, type Preview, type Transaction } from './api';
import './styles.css';

type Page = 'Overview' | 'Transactions' | 'Analytics' | 'AI Assistant' | 'Privacy & Settings';

const NAV: { page: Page; icon: ReactNode }[] = [
  { page: 'Overview', icon: <LayoutDashboard size={18} /> },
  { page: 'Transactions', icon: <List size={18} /> },
  { page: 'Analytics', icon: <BarChart3 size={18} /> },
  { page: 'AI Assistant', icon: <Bot size={18} /> },
  { page: 'Privacy & Settings', icon: <Shield size={18} /> },
];

const SUGGESTIONS = ['How much did I receive in September?', 'How much did I spend on transport?', 'Who sent me the most money?', 'What were my five largest expenses?', 'Compare August and September.', 'What percentage of my expenditure was spent on food?'];

function ErrorBox({ message, retry }: { message: string; retry?: () => void }) {
  return (
    <div className="notice error" role="alert">
      <span>{message}</span>
      {retry && <button onClick={retry}><RefreshCw size={14} /> Retry</button>}
    </div>
  );
}

function Importer({ onDone }: { onDone: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<{ file: File; text: string } | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const choose = async (picked?: File) => {
    if (!picked) return;
    setError('');
    setMessage('');
    setPreview(null);
    try {
      const text = await picked.text();
      setFile({ file: picked, text });
      setPreview(await postCsv<Preview>('/import/preview', picked, text));
    } catch (e) {
      setError((e as Error).message);
    }
    if (input.current) input.current.value = '';
  };

  const confirm = async () => {
    if (!file) return;
    try {
      const done = await postCsv<{ imported: number; skipped: number; issues: number }>('/import/confirm', file.file, file.text);
      setPreview(null);
      setMessage(`Imported ${done.imported} transactions. Skipped ${done.skipped} duplicates. ${done.issues} rows need attention.`);
      onDone();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <section className="card">
      <div className="row">
        <h2>Import statement</h2>
        <button className="primary" onClick={() => input.current?.click()}><FileUp size={16} /> Choose CSV</button>
        <input ref={input} hidden type="file" accept=".csv,text/csv" aria-label="Statement file" onChange={(e) => void choose(e.target.files?.[0])} />
      </div>
      {error && <ErrorBox message={error} />}
      {message && <div className="notice">{message}</div>}
      {preview && (
        <div className="preview">
          <p><b>{preview.name}</b>: {preview.ready} ready, {preview.alreadyImported} already imported, {preview.duplicatesInFile} duplicates in file, {preview.issues.length} need attention.</p>
          {preview.issues.slice(0, 8).map((i) => <p className="muted" key={i.line}>Line {i.line}: {i.message}</p>)}
          <button className="primary" disabled={!preview.ready} onClick={() => void confirm()}>Confirm import</button>
        </div>
      )}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return <div className="card stat"><span className="muted">{label}</span><strong>{value}</strong></div>;
}

function Monthly({ data }: { data: Overview['monthly'] }) {
  const max = Math.max(1, ...data.flatMap((m) => [m.incomeCents, m.expenditureCents]));
  return (
    <section className="card">
      <h2>Monthly income and expenditure</h2>
      <div className="legend"><i className="swatch income" /> Income <i className="swatch spend" /> Expenditure</div>
      <div className="bars">
        {data.map((m) => (
          <div className="month" key={m.month}>
            <div className="pair">
              <div className="bar income" style={{ height: `${(m.incomeCents / max) * 100}%` }} title={`${m.month} income ${kes(m.incomeCents)}`} />
              <div className="bar spend" style={{ height: `${(m.expenditureCents / max) * 100}%` }} title={`${m.month} expenditure ${kes(m.expenditureCents)}`} />
            </div>
            <span className="muted">{m.month}</span>
          </div>
        ))}
      </div>
      <table>
        <thead><tr><th>Month</th><th className="num">Income</th><th className="num">Expenditure</th><th className="num">Net</th></tr></thead>
        <tbody>{data.map((m) => <tr key={m.month}><td>{m.month}</td><td className="num">{kes(m.incomeCents)}</td><td className="num">{kes(m.expenditureCents)}</td><td className="num">{kes(m.netCashFlowCents)}</td></tr>)}</tbody>
      </table>
    </section>
  );
}

function Categories({ data }: { data: Overview['categories'] }) {
  const max = Math.max(1, ...data.map((c) => c.cents));
  return (
    <section className="card">
      <h2>Spending by category</h2>
      {data.map((c) => (
        <div className="hbar" key={c.category} title={`${c.category} ${kes(c.cents)}`}>
          <span>{c.category}</span>
          <div className="track"><div className="fill" style={{ width: `${(c.cents / max) * 100}%` }} /></div>
          <span className="num">{kes(c.cents)}</span>
        </div>
      ))}
    </section>
  );
}

function TxTable({ rows }: { rows: Transaction[] }) {
  return (
    <div className="scroll">
      <table>
        <thead><tr><th>Date</th><th>Description</th><th>Type</th><th className="num">Amount</th></tr></thead>
        <tbody>{rows.map((t) => <tr key={t.id}><td>{t.occurredAt.slice(0, 10)}</td><td>{t.description}</td><td>{t.type}</td><td className="num">{t.direction === 'in' ? '+' : '-'}{kes(t.amountCents)}</td></tr>)}</tbody>
      </table>
    </div>
  );
}

function Empty() {
  return <div className="card muted">No transactions yet. Import the synthetic sample from <code>sample-data</code> to begin.</div>;
}

function OverviewPage({ data, reload }: { data: Overview; reload: () => void }) {
  const { summary } = data;
  return (
    <>
      <Importer onDone={reload} />
      {!summary.transactionCount ? <Empty /> : (
        <>
          <div className="stats">
            <Stat label="Total income" value={kes(summary.incomeCents)} />
            <Stat label="Total expenditure" value={kes(summary.expenditureCents)} />
            <Stat label="Net cash flow" value={kes(summary.netCashFlowCents)} />
            <Stat label="Transactions" value={String(summary.transactionCount)} />
          </div>
          <p className="muted">Net cash flow is not your account balance. Transfers and cash deposits are excluded from income and expenditure.</p>
          <div className="grid"><Monthly data={data.monthly} /><Categories data={data.categories} /></div>
          <section className="card"><h2>Recent transactions</h2><TxTable rows={data.recent} /></section>
        </>
      )}
    </>
  );
}

function TransactionsPage() {
  const [rows, setRows] = useState<Transaction[] | null>(null);
  const [filters, setFilters] = useState({ search: '', category: '', type: '', from: '', to: '', sort: 'date' });
  const [error, setError] = useState('');

  const load = useCallback(() => {
    const query = new URLSearchParams(Object.entries(filters).filter(([, v]) => v));
    query.set('limit', '200');
    setError('');
    api<Transaction[]>(`/transactions?${query}`).then(setRows, (e: Error) => setError(e.message));
  }, [filters]);
  useEffect(load, [load]);

  const set = (key: keyof typeof filters) => (e: { target: { value: string } }) => setFilters({ ...filters, [key]: e.target.value });
  const recategorize = async (id: number, category: string) => {
    try {
      await sendJson('PATCH', `/transactions/${id}`, { category });
      load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <section className="card">
      <h2>Transactions</h2>
      <div className="filters">
        <input placeholder="Search descriptions" aria-label="Search" value={filters.search} onChange={set('search')} />
        <select aria-label="Category" value={filters.category} onChange={set('category')}><option value="">All categories</option>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select>
        <select aria-label="Type" value={filters.type} onChange={set('type')}><option value="">All types</option>{TYPES.map((c) => <option key={c}>{c}</option>)}</select>
        <input type="date" aria-label="From" value={filters.from} onChange={set('from')} />
        <input type="date" aria-label="To" value={filters.to} onChange={set('to')} />
        <select aria-label="Sort" value={filters.sort} onChange={set('sort')}><option value="date">Newest first</option><option value="amount">Largest first</option></select>
      </div>
      {error && <ErrorBox message={error} retry={load} />}
      {!rows ? <p className="muted">Loading...</p> : !rows.length ? <p className="muted">No matching transactions.</p> : (
        <div className="scroll">
          <table>
            <thead><tr><th>Date</th><th>Description</th><th>Type</th><th>Category</th><th className="num">Amount</th></tr></thead>
            <tbody>{rows.map((t) => (
              <tr key={t.id}>
                <td>{t.occurredAt.slice(0, 10)}</td>
                <td>{t.description}<div className="muted small">{t.reference}</div></td>
                <td>{t.type}</td>
                <td><select aria-label={`Category for ${t.reference}`} value={t.category} onChange={(e) => void recategorize(t.id, e.target.value)}>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></td>
                <td className="num">{t.direction === 'in' ? '+' : '-'}{kes(t.amountCents)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function AnalyticsPage({ data }: { data: Overview }) {
  if (!data.summary.transactionCount) return <Empty />;
  return (
    <>
      <div className="grid"><Monthly data={data.monthly} /><Categories data={data.categories} /></div>
      <section className="card"><h2>Largest expenses</h2><TxTable rows={data.largest} /></section>
    </>
  );
}

interface Turn {
  question: string;
  answer?: Answer;
  error?: string;
}

function AssistantPage({ ai }: { ai: AiStatus | null }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const ready = ai?.state === 'READY' || ai?.state === 'BUSY';

  const ask = async (text: string) => {
    if (!text.trim() || busy) return;
    setBusy(true);
    setQuestion('');
    setTurns((t) => [...t, { question: text }]);
    const finish = (turn: Partial<Turn>) => setTurns((t) => [...t.slice(0, -1), { question: text, ...turn }]);
    try {
      finish({ answer: await sendJson<Answer>('POST', '/assistant', { question: text }) });
    } catch (e) {
      finish({ error: (e as Error).message });
    }
    setBusy(false);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void ask(question);
  };

  return (
    <section className="card assistant">
      <div className="row"><h2>Ask about your money</h2><span className={`pill ${ready ? 'on' : ''}`}>Local AI: {ai?.state ?? 'unknown'}</span></div>
      <div className="chips">{SUGGESTIONS.map((s) => <button key={s} disabled={busy || !ready} onClick={() => void ask(s)}>{s}</button>)}</div>
      <div className="turns" aria-live="polite">
        {turns.map((t, i) => (
          <div className="turn" key={i}>
            <p className="q">{t.question}</p>
            {!t.answer && !t.error && <p className="muted">Running on this device. This can take about a minute.</p>}
            {t.error && <ErrorBox message={t.error} retry={() => void ask(t.question)} />}
            {t.answer && (
              <>
                <div className="verified">
                  <span className="tag">Calculated from your data · {t.answer.period}</span>
                  {t.answer.figures.map((f) => <div className="figure" key={f.label}><span>{f.label}</span><b>{f.value}</b></div>)}
                  {!t.answer.figures.length && <p className="muted">No matching transactions.</p>}
                </div>
                {t.answer.explanation && <p className="explain"><span className="tag">AI explanation · {ai?.model}</span>{t.answer.explanation}</p>}
                {t.answer.explanationNote && <p className="muted">{t.answer.explanationNote}</p>}
              </>
            )}
          </div>
        ))}
      </div>
      <form onSubmit={submit}>
        <input aria-label="Question" maxLength={300} placeholder="Ask a question" value={question} onChange={(e) => setQuestion(e.target.value)} />
        <button className="primary" disabled={busy || !ready}>Ask</button>
      </form>
    </section>
  );
}

function PrivacyPage({ ai, reload }: { ai: AiStatus | null; reload: () => void }) {
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const erase = async () => {
    if (!window.confirm('Delete all imported financial data from this device?')) return;
    try {
      await api('/data', { method: 'DELETE' });
      setDone(true);
      reload();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <section className="card">
      <h2>Privacy & settings</h2>
      <dl>
        <dt>Model status</dt><dd>{ai?.state ?? 'unknown'}</dd>
        <dt>Model</dt><dd>{ai?.model ?? 'unknown'}</dd>
        <dt>Runs on</dt><dd>{ai?.device ?? 'not loaded'}</dd>
        <dt>Network status</dt><dd>{navigator.onLine ? 'This computer reports a connection. PesaLens does not need it after setup.' : 'This computer reports no connection.'}</dd>
        <dt>Storage</dt><dd>Local SQLite file in the application's data folder.</dd>
        <dt>Version</dt><dd>0.1.0</dd>
      </dl>
      <p>Statements, transactions and questions stay on this device. The AI receives your question and calculated totals, never your transaction descriptions.</p>
      {error && <ErrorBox message={error} />}
      {done && <div className="notice">All financial data was deleted. This removes it from the database, but is not forensic-grade erasure.</div>}
      <button className="danger" onClick={() => void erase()}>Delete all financial data</button>
    </section>
  );
}

function App() {
  const [page, setPage] = useState<Page>('Overview');
  const [overview, setOverview] = useState<Overview | null>(null);
  const [ai, setAi] = useState<AiStatus | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    setError('');
    api<Overview>('/overview').then(setOverview, (e: Error) => setError(e.message));
  }, []);
  useEffect(load, [load]);
  useEffect(() => {
    const poll = () => api<{ ai: AiStatus }>('/status').then((s) => setAi(s.ai), () => setAi(null));
    void poll();
    const id = setInterval(poll, 3000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="shell">
      <nav>
        <div className="brand">PesaLens<span>Your device. Your privacy.</span></div>
        {NAV.map(({ page: p, icon }) => <button key={p} className={p === page ? 'active' : ''} onClick={() => { setPage(p); load(); }}>{icon}<span>{p}</span></button>)}
      </nav>
      <main>
        {error && <ErrorBox message={error} retry={load} />}
        {!overview && !error && <p className="muted">Loading...</p>}
        {overview && page === 'Overview' && <OverviewPage data={overview} reload={load} />}
        {page === 'Transactions' && <TransactionsPage />}
        {overview && page === 'Analytics' && <AnalyticsPage data={overview} />}
        {page === 'AI Assistant' && <AssistantPage ai={ai} />}
        {page === 'Privacy & Settings' && <PrivacyPage ai={ai} reload={load} />}
      </main>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
