# CLAUDE.md — Restoran POS v3

## Project Overview
Windows desktop restaurant POS application. Production-ready as of April 2026.

**Stack:** Electron + React 18/Vite (frontend) · Node.js/Express (backend) · SQLite (`better-sqlite3`) · Socket.io (real-time) · JWT/bcrypt (auth)

**Overall score: 9.0/10** (up from 8.8/10) · 10 sprints completed · 285 automated tests · 15/15 production checklist items passed

## Scores
| Category            | Score  | Change |
|---------------------|--------|--------|
| Feature Completeness| 9/10   | ±0     |
| Code Quality        | 9/10   | +1     |
| Security            | 9/10   | ±0     |
| Performance         | 8/10   | ±0     |
| Test Coverage       | 9/10   | +1     |
| Documentation       | 8/10   | +1     |
| Deployment          | 9/10   | ±0     |
| **Overall**         | **9.0**| **+0.2** |

## Completed Sprints

| Sprint | Focus | Key Deliverables |
|--------|-------|-----------------|
| 1 | Security & Stability | JWT persistence, Zod validation on all routes, rate limiting (auth/admin/bridge/printer) |
| 2 | Printer & Receipt | ESC/POS word-wrap, PC857 Turkish encoding, receipt header/footer, Store Bridge crash recovery (auto-restart in 10s) |
| 3 | UX & Infrastructure | Table occupancy color scale, kitchen order age warnings (10min yellow / 20min red), daily DB backup (02:00, 30-day retention), chart reports (recharts) |
| 4 | UX Quick Wins | Payment quick-amount buttons (50/100/200/500 TL), inline customer search (no popup), "All" tab |
| 5 | New Features | Reservation module (calendar view), basic inventory tracking (items, movements, low-stock alerts) |
| 6 | Real-time & Printer Fix | Socket.io (kitchen/table/takeaway screens now instant vs 10–15s polling), per-printer `ESC t` + `skipInit` for Turkish fix, duplicate takeaway receipt fix. *Delivered 2 months ahead of schedule.* |
| 7 | Test Coverage | 65 automated tests (Vitest) covering Turkish encoding, printer deduplication, DB migration safety, order transaction integrity. Coverage 1→7/10. |
| 8 | Production Hardening | Customer list pagination (50/page "load more"), order history search filters (date range / customer / amount), BRIDGE_TOKEN security fix, CORS hardening |
| 9 | Feature Completion + Packaging Fix | Product image upload + combo menu, Customer 360 profile, Advanced order analytics, electron-updater auto-update, receipt template rebuild (4 templates, 48-char, PC857), **iconv-lite/store-bridge packaging bug fixed** (v1.0.3) |
| 10 | Audit Hardening + Release Hardening | Full codebase audit (10 audit reports in `docs/audit/`: 00–09 + quality hardening), route lazy-loading (main chunk 948kB→265kB), `ConfirmDialog`/`useConfirmDialog` common component (window.confirm removed), `orderActionPolicy`/`orderPaymentState` utility layer, `api/core.js` HTTP separation, print_jobs lease-based claim + claim ownership guard + manual retry + structured error codes, StoreBridge API timeout/health-retry, CallerID reconnect + bounded POST retry + duplicate ringing guard, Electron persistent logging (`userData/logs/electron-main.log`), JWT secret persisted to `pos-config.json`, CallerID helper packaging fix (`extraResources`), `desktop:preflight` script, `build:callerid-helper` script, encoding module extracted to `store-bridge/printers/encoding.js`, password min-length guard (G-1), takeaway+table_id conflict guard (G-2), transfer Zod schema (G-3), 25 console.error context labels (admin.js), ErrorBoundary, bridge max-restart circuit-breaker, backup-restore runbook, 30 new tests (285 total) |

## Completed Features (Do Not Break)
- Table management (area-based grid, status, transfer, occupancy color scale)
- Order flow (category→product, modifiers, item notes, order panel)
- Takeaway orders (customer lookup/create, address management, separate flow)
- Payment (cash/card/mixed, discount, change calculation, auto-close)
- Kitchen screen (active orders, item-level preparation tracking, age warnings)
- Receipt/invoice printing (ESC/POS, PC857 Turkish, word-wrap, header/footer configurable)
- Reservation module (calendar view, date/guests/notes)
- Inventory tracking (items, movements, low-stock alerts)
- Customer management (multi-phone/address, order history, Excel/CSV import-export)
- Reports (daily sales, payment breakdown, top sellers, category/user breakdown, 4 interactive charts)
- Order history with advanced filters (date range, customer, amount)
- CallerID (C812A V8 HID device, clipboard bridge via PowerShell; SDK helper as primary candidate)
- Socket.io real-time (kitchen, table, takeaway screens)
- Daily automatic DB backup (02:00, 30-day retention)
- Role-based auth: Admin, Cashier, Waiter, Kitchen
- 285 automated tests (Vitest + Supertest integration), all passing
- 15/15 production checklist items complete
- Electron packaging: NSIS Setup + Portable `.exe` (`npm run dist:win`)
- One-click Windows startup scripts (`scripts/start-all.bat`)
- Customer notification sound on new order
- electron-updater auto-update (GitHub Releases, v1.0.3+)
- Product image upload (server/uploads/products/, /uploads static)
- Combo menu support (product_combos table, UI in MenuProductEditorPage)
- Customer 360 profile (total spend, order count, last visit, top 3 products)
- Advanced order analytics (top 10 products, peak hours, daily revenue — recharts)
- Order report Excel export + print/PDF (daily + order history)
- Waiter call QR code (table QR → customer scan → real-time notification via Socket.io)
- Receipt templates rebuilt (4 templates: PAKET KASA, PAKET MUTFAK, MASA MUTFAK, MASA KASA — 32-char separators)
- Supertest integration tests (auth, orders, payments, reports, adminPrinters, bridgePrintJobs, takeawayDelivery, **tables**, **orderLifecycle** — 9 files)
- `orderPaymentState.test.js`: 33 unit test — roundMoney, getPaidTotal, isOrderFullyPaid, canCloseOrder, getPaymentStateLabel, getPaymentSummary
- `orderActionPolicy.test.js`: 30 unit test — canOpenOrderPayment, canEditOrderItem, canVoidOrderItem, canSaveOrderDraft
- QA regression audit: `docs/audit/08-qa-regression-audit.md` + `docs/testing/regression-checklist.md`
- `ConfirmDialog` + `useConfirmDialog`: all `window.confirm` calls replaced with in-app modal (settings, menu, stock, reservations, dining areas, users, printers)
- `orderActionPolicy.js` + `orderPaymentState.js`: centralized order/payment decision utilities
- `api/core.js`: HTTP core separated from `api.js` facade
- Print queue: lease-based claim, claim ownership guard, manual retry for failed jobs, structured error codes (`printer_missing`, `network_timeout`, `usb_print_failed`, etc.)
- StoreBridge: API timeout enforcement, health-retry on startup, CallerID reconnect + bounded POST retry + duplicate ringing guard
- Electron persistent logging: all process stdout/stderr + uncaught exceptions written to `userData/logs/electron-main.log`
- JWT secret persisted to `pos-config.json` on first launch (sessions survive restarts without explicit `.env` config)
- CallerID helper `.exe` included via `extraResources` and verified by `desktop:preflight`
- `store-bridge/printers/encoding.js`: encoding/ESC-POS logic extracted from `renderers.js` into standalone module
- Full audit documentation in `docs/audit/` (9 reports: product rules, UX, frontend arch, backend, DB, integrations, desktop release, QA regression, **security & ops**)
- Desktop install runbook: `docs/runbooks/desktop-install-runbook.md`
- Backup & restore runbook: `docs/runbooks/backup-restore-runbook.md`
- `ErrorBoundary` component: React crash → "Yenile" ekranı (beyaz ekran koruması), mounted at app root in `main.jsx`
- Security hardening: `err.message` removed from all 500 responses (4 routes); failed login now writes `login_failed` to `audit_logs`
- Bridge max restart guard: `BRIDGE_MAX_RESTARTS=10` — stops infinite restart loop, logs clear error after limit

## Pending Tasks

All short-term and medium-term roadmap items completed as of Sprint 10.
Long-term items deferred pending production testing period.

### Remaining architectural debt (do next, low risk)
- `OrderScreen.jsx` (1428 lines) — extract catalog/cart/customer/action hooks separately; do NOT refactor in one pass
- `TablesScreen.jsx` — extract `useTablesData`, `TakeawaySidebar`, `TableCard` components
- `PrinterDetailPage.jsx` (972 lines) — extract form model to hook, preview to separate component
- `electron/main.cjs` (~860 lines) — extract `config`, `serverProcess`, `bridgeProcess`, `callerIdProcess`, `sqliteMigration` sub-modules
- `server/routes/orders.js` + `payments.js` — extract domain services; route files should only handle HTTP validation + service calls
- API client domain split: `api/core.js` started; continue splitting `api.js` into domain modules (orders, tables, payments, etc.)

### Quality gates (add before next large feature)
- ~~ESLint + lint script in root/client build pipeline~~ — **DONE:** `client/eslint.config.js` (ESLint 10 flat config), `npm run lint` / `npm run lint:ci` scripts added to root and client `package.json`
- Frontend utility unit tests (orderPaymentState, orderActionPolicy)
- Playwright smoke tests for critical POS flows

### Print queue UI (P2)
- Print queue summary panel in Admin UI (pending/failed/stale counts)
- `last_error_code` surfaced in failed job rows with actionable resolution messages
- Manual retry confirmation modal for failed print jobs
- StoreBridge log written to file (parallel to `electron-main.log`)

### Desktop / release (P1→P2)
- Code signing certificate + signed NSIS pipeline (currently SmartScreen warning on install)
- CallerID helper self-contained `win-x64` publish (currently requires .NET 8 runtime on target machine)
- First-run setup wizard (business name, printer, bridge config)
- Backup/restore UI — current backup is file-only, no in-app restore
- SQLite `VACUUM INTO` or backup API for WAL-safe snapshots
- `latest.yml` generation wired into `dist:win` chain

### After production testing (v2 roadmap)
- Multi-branch dashboard
- Online order integrations (Yemeksepeti, Getir)
- Mobile waiter app (tablet/offline)
- Loyalty program
- CI/CD pipeline (GitHub Actions) — **high priority, prevents packaging bugs**
- Frontend test coverage (React component tests)
- QR code local generation (replace external api.qrserver.com dependency)

## Critical Technical Notes
- **`better-sqlite3`** — must be rebuilt for Electron ABI; `npm run dist:prepare` handles this automatically via `scripts/rebuild-server-native.cjs`. Requires Visual Studio "Desktop development with C++" for source builds. Vitest uses system Node: if `npm run test` fails with an ABI/version mismatch after `postinstall` or an Electron rebuild, run `npm rebuild better-sqlite3` in `server/`.
- **`store-bridge/node_modules`** — `dist:prepare` runs `npm install --prefix store-bridge --omit=dev` since Sprint 9. Previously missing, caused iconv-lite crash in v1.0.2. Do NOT remove this step.
- **PC857 Turkish encoding** — `ESC t 12` command; per-printer `skipInit` setting available to skip `ESC @` initialization (fixes Turkish chars on some network printers). Encoding logic lives in `store-bridge/printers/encoding.js` (extracted from `renderers.js` in Sprint 10).
- **CallerID** — Primary: C# SDK helper (`tools/callerid-sdk-helper`). Fallback: clipboard listener (`scripts/callerid-clipboard-listener.ps1`). Both POST to `POST /api/bridge/caller-id/incoming` with `X-Bridge-Token`. CallerID helper `.exe` is bundled via `extraResources`; `desktop:preflight` verifies it exists before packaging.
- **BRIDGE_TOKEN** — must always be masked in logs (`***`); never log in plain text.
- **DB transactions** — order, payment, and print operations must be atomic (all-or-nothing).
- **Mock mode** — must default to OFF; must never be enabled in production.
- **userData path** — in packaged Electron, SQLite lives at `app.getPath('userData')` (`%APPDATA%\restoran-pos\pos.db`). On first launch, migrates from `server/data/pos.db` if userData is empty. `uploads/` and `backups/` also live under userData.
- **Electron logging** — all process stdout/stderr (backend, StoreBridge, CallerID) and uncaught exceptions are written to `userData/logs/electron-main.log`. Check this file first for field support.
- **JWT_SECRET** — on first Electron launch the secret is auto-generated and persisted to `userData/pos-config.json`, so sessions survive restarts without requiring `server/.env`. Set explicitly in `.env` for browser-only (`prod`) mode.
- **`server/.env`** — never committed to git.
- **CORS_ORIGINS** — LAN IP support configured via env var.
- **Socket.io** — kitchen, table, and takeaway screens use real-time events (not polling).
- **electron-builder** — pinned to `24.13.3`; do NOT upgrade to 25.x (known 7za/packaging issues).
- **Print queue lease** — `print_jobs` rows use `claimed_until` for lease-based ownership. A claimed job whose lease has expired is fair game for re-claim. Status updates are rejected (409) if the claiming bridge ID doesn't match. Failed jobs require explicit admin manual retry — no automatic retry by design (prevents duplicate kitchen receipts).
- **ConfirmDialog** — `window.confirm` is banned. Use `client/src/components/common/ConfirmDialog.jsx` + `useConfirmDialog.js` hook for all destructive-action confirmations.

## Folder Structure
```
restoran-pos-v3/
├── client/                    # React 18 + Vite frontend
│   └── src/
│       ├── components/        # auth, layout, tables, orders, payments,
│       │                      # kitchen, takeaway, callerid, customers,
│       │                      # reports, settings
│       │   └── common/        # ConfirmDialog, useConfirmDialog
│       ├── context/           # Auth + Toast context
│       ├── services/          # API service layer
│       │   └── api/           # api/core.js (HTTP core, separated from api.js)
│       ├── utils/             # orderActionPolicy.js, orderPaymentState.js
│       ├── constants/         # Constants, formatters
│       └── styles/            # Global CSS
├── server/                    # Express backend
│   ├── config/                # DB connection
│   ├── middleware/            # Auth, authorization
│   ├── routes/                # auth, tables, products, orders, payments,
│   │                          # customers, callerid, reports, printer,
│   │                          # admin, bridge
│   ├── services/              # printJobs.js, callerIdService.js
│   ├── migrations/            # Table creation (run.js — idempotent)
│   ├── seeds/                 # Demo data
│   ├── tests/                 # Vitest tests (239 tests, 20 files)
│   │   └── integration/       # auth, orders, payments, reports, adminPrinters,
│   │                          # bridgePrintJobs, takeawayDelivery, tables, orderLifecycle
│   └── index.js               # Server entry point
├── electron/
│   └── main.cjs               # Electron main process (logs → userData/logs/)
├── store-bridge/              # Local printer bridge; hardware CID (HID/clipboard)
│   └── printers/
│       ├── encoding.js        # PC857/Win1254 encode, ESC-POS helpers (Sprint 10)
│       └── renderers.js       # Receipt rendering (re-exports encoding.js)
├── tools/callerid-sdk-helper/ # C# CallerID SDK helper (.NET 8)
├── scripts/                   # .bat startup scripts, build helpers
│   ├── build-callerid-helper.cjs   # Builds CallerID .exe for packaging
│   └── check-desktop-release.cjs  # desktop:preflight checks
├── docs/
│   ├── audit/                 # 10 audit reports (00–09, 10-quality-hardening)
│   └── runbooks/              # desktop-install-runbook.md
└── package.json
```

## Commands
```bash
# Development
npm run dev             # Vite (5173) + API (3001) concurrently
npm run test            # Run all 239 tests (from repo root; delegates to server)
npm run test:watch      # Watch mode

# Production (browser)
npm run prod            # Build client → start Express in production mode

# Electron
npm run electron:prod         # Build client → launch Electron
npm run build:callerid-helper # Build CallerID C# helper exe (requires .NET 8)
npm run desktop:preflight     # Verify all release inputs exist before packaging
npm run dist:prepare          # Build + rebuild native + smoke test + preflight → win-unpacked
npm run dist:nsis             # NSIS Setup.exe (needs dist:prepare first)
npm run dist:portable         # Portable .exe (needs dist:prepare first)
npm run dist:win              # Full chain: dist:prepare → dist:nsis → dist:portable

# Utilities
npm run db:seed         # Create DB and load demo data
npm run all:start       # Windows: start-all.bat (POS + Bridge + CallerID)
npm run debug:login     # Test JWT/audit chain in terminal
```

## Developer Rules
- UI text and all user-facing content: **Turkish**
- Code, variable names, comments: **English**
- Small, safe steps — no large refactors
- Present a summary before making changes: "What will change and why"
- Do not touch working code unnecessarily
- Every new feature must not break the existing 239 tests
- Summarize what changed only when asked — do not add trailing summaries to every response

## Demo Credentials
| Role    | Email              | Password |
|---------|--------------------|----------|
| Admin   | admin@demo.com     | 123456   |
| Cashier | kasiyer@demo.com   | 123456   |
| Waiter  | garson@demo.com    | 123456   |
| Kitchen | mutfak@demo.com    | 123456   |
“Codex will review your output once you are done.”

