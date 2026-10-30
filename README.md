# PesaLens

Your financial intelligence. Your device. Your privacy.

PesaLens is an offline financial assistant for M-Pesa statements. Import a statement, see your income and spending, and ask questions in plain English. The AI runs on your own computer through the [QVAC](https://docs.qvac.tether.io/) SDK, so your financial data never needs to leave it.

Built for the AI Yako hackathon, Offline AI Apps track.

## Why offline AI matters

Most financial tools send personal records to the cloud. Freelancers and small business owners in Kenya should be able to understand their money privately, including when the connection is slow or unavailable.

## How a question is answered

The model never calculates money.

1. QVAC turns the question into a JSON intent, constrained by a schema.
2. The app checks the intent against the original question and an allowlist.
3. Predefined, parameterized queries and exact integer arithmetic produce the figures.
4. QVAC writes a short explanation from those figures only.
5. An explanation containing any number that was not calculated is withheld. The figures are still shown.

Transaction descriptions and names are never sent to the model, so text inside a statement cannot act as prompt injection.

## Architecture

A modular monolith with one-way dependencies: presentation, API, application, domain. Infrastructure (SQLite, QVAC) implements the interfaces the application needs.

| Area | Technology |
|---|---|
| Frontend | React, TypeScript, Vite, Lucide |
| Backend | Node.js, TypeScript, Express, Helmet |
| Database | SQLite through `node:sqlite`, with versioned migrations |
| AI | `@qvac/sdk` 0.22.0, model `QWEN3_600M_INST_Q4` (382 MB) |
| Tests | Node test runner |

## Tested device

| Item | Value |
|---|---|
| Device | HP EliteBook Folio 9470m |
| OS | Windows 11 Pro 64-bit |
| CPU | Intel Core i5-3427U (AVX, no AVX2), CPU inference only |
| RAM | 7.9 GB total |
| Performance | Model loads in about 20 s, about 9 tokens per second, answers in about 15 to 30 s |

QVAC documents Vulkan as required on Windows. On this device it ran on the CPU with no Vulkan runtime installed.

## Install

Requires Node.js `^22.21.0` or `>=24.9.0` and about 2 GB of free RAM.

```
npm run setup
npm run model
```

`npm run model` downloads the model once, to `~/.qvac/models`. Run it while online.

## Run

```
npm start
```

Open http://127.0.0.1:4310 and import `sample-data/synthetic-mpesa-statement.csv`.

The server binds to localhost only. Set `PORT` to use a different port.

## Statement format

CSV with these columns: `Receipt No`, `Completion Time` (`YYYY-MM-DD HH:MM:SS`), `Details`, `Transaction Status`, `Paid In`, `Withdrawn`. PDF statements are not supported. Files are parsed in memory and limited to 5 MB. Rows with problems are listed for review, never silently dropped.

## Financial rules

- Money is stored as integer cents in KES.
- Income is money received that is not a refund, reversal, deposit or own-account transfer.
- Expenditure is payments, fees and withdrawals, reduced by refunds and inbound reversals.
- Own-account transfers and cash deposits count as neither.
- Net cash flow is income minus expenditure. It is not an account balance.

## Test

```
npm test
```

Automated tests use a fake AI provider and are not proof of offline inference. `npm run verify:offline` is the real check.

## Verify offline operation

```
npm run verify:offline
```

Then disconnect from the internet. The script confirms that public hosts are unreachable, loads the model fresh, asks new questions, and writes the evidence to `data/offline-proof.txt`.

Result on the tested device, 30 October 2026: all three probe hosts were unreachable, the model loaded in 22 s, both fresh questions were answered correctly in under 20 s each, and the hosts were still unreachable afterwards.

## Privacy and security

- Statements, transactions and questions stay on the device. There are no analytics or external AI calls.
- The API rejects requests from other websites by checking Host and Origin.
- Prompts and transaction text are not logged.
- Delete removes data from the database, but is not forensic-grade erasure.
- The database file is not encrypted. Anyone with access to your Windows account can read it.
- Other programs running as your user can reach the local API. Only a browser origin check protects it.

## Known limitations

- CSV only, KES only, single user.
- Month names resolve to the latest matching year in the data.
- The small model sometimes misreads questions. Fixed rules correct known cases, and the question-shape checks may ask you to rephrase.
- Explanations are sometimes withheld when they fail the number check.
- Category rules are keyword based. Correct them on the Transactions page.
- Conversations are not saved between sessions, and single statements cannot yet be deleted individually.
- Column mapping and plain-text import are not implemented.
- Charts use plain CSS. Browser end-to-end tests are not included.
