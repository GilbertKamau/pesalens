import { spawn } from 'node:child_process';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const backend = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const proof = resolve(backend, '../data/offline-proof.txt');
const base = 'http://127.0.0.1:4310/api';
const PROBES = ['https://registry.npmjs.org', 'https://huggingface.co', 'https://1.1.1.1'];
const QUESTIONS = process.argv.slice(2).length ? process.argv.slice(2) : ['How much did I receive in October?', 'How much did I spend on airtime?'];

mkdirSync(dirname(proof), { recursive: true });
writeFileSync(proof, '');
const log = (line) => {
  const text = `${new Date().toISOString()} ${line}`;
  console.log(text);
  appendFileSync(proof, `${text}\n`);
};
const reachable = (url) => fetch(url, { signal: AbortSignal.timeout(5000) }).then(() => true, () => false);
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

log('Waiting for the internet to be disconnected');
for (;;) {
  const results = await Promise.all(PROBES.map(reachable));
  if (!results.some(Boolean)) break;
  await sleep(3000);
}
log(`OFFLINE CONFIRMED: ${PROBES.join(', ')} all unreachable`);

const server = spawn(process.execPath, ['--no-warnings', 'src/main.ts'], { cwd: backend, stdio: 'ignore', env: { ...process.env, QVAC_RPC_INIT_TIMEOUT_MS: '240000' } });
const started = Date.now();
let state = '';
while (state !== 'READY' && state !== 'ERROR' && Date.now() - started < 240_000) {
  state = await fetch(`${base}/status`).then((r) => r.json()).then((b) => b.data.ai.state, () => '');
  await sleep(1000);
}
log(`Fresh model load while offline: ${state || 'TIMEOUT'} after ${Math.round((Date.now() - started) / 1000)}s`);

let passed = state === 'READY';
for (const question of QUESTIONS) {
  const body = await fetch(`${base}/assistant`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question }) }).then((r) => r.json());
  passed &&= body.success && Boolean(body.data.explanation);
  log(`Q: ${question}`);
  log(`A: ${JSON.stringify(body.success ? body.data : body.error)}`);
}
const still = await Promise.all(PROBES.map(reachable));
log(`Internet still unreachable after inference: ${!still.some(Boolean)}`);
log(passed && !still.some(Boolean) ? 'RESULT: PASS' : 'RESULT: FAIL');
server.kill();
process.exit(0);
