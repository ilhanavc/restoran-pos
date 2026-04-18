# CLAUDE.md — Restoran POS v3

## Project Overview
Windows desktop restaurant POS application. Production-ready as of April 2026.

**Stack:** Electron + React 18/Vite (frontend) · Node.js/Express (backend) · SQLite (`better-sqlite3`) · Socket.io (real-time) · JWT/bcrypt (auth)

**Overall score: 9.2/10** · 12 sprints completed · **318 automated tests** · 15/15 production checklist items passed

## Scores
| Category            | Score  | Change |
|---------------------|--------|--------|
| Feature Completeness| 9/10   | ±0     |
| Code Quality        | 9/10   | ±0     |
| Security            | 9/10   | ±0     |
| Performance         | 8/10   | ±0     |
| Test Coverage       | 9/10   | ±0     |
| Documentation       | 10/10  | +1     |
| Deployment          | 9/10   | ±0     |
| **Overall**         | **9.2**| **+0.1** |

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
| 11 | Desktop Core Hardening + Repo Cleanup | StoreBridgePage health/log/queue panel, `printErrorMessages.js` 16-code error dictionary (TR), `toast.warning` type, MaintenancePage backup staleness banner, PaymentScreen print-failure feedback, `backup-failed` IPC channel, `GET /admin/support-bundle` diagnostic endpoint, `smoke:server-health` script wired into `dist:prepare`, `dist:release` = dist:win + latest.yml, CallerID self-contained win-x64 publish (.NET 8), `printer-acceptance-checklist.md`, `code-signing-runbook.md`, ESLint 27 warnings → 0 (`lint:ci --max-warnings 0`), Playwright e2e specs (table-order-payment, takeaway), `adminBridgeObservability` integration test, **repo cleanup** (451 MB freed: old zips/artifacts/tmp), **pos-config.json removed from git** (security), 9 sprint pass docs → `docs/audit/archive/`, 33 new tests (318 total) |
| 12 | Backup/Restore Hardening | **P1 critical gaps:** uploads folder backup + restore, backup meta.json (appVersion, schemaVersion, rowCounts, integrityCheck), open order uyarısı restore planlamadan önce (GET /maintenance/open-orders), pos-config.json snapshot backup + restore (JWT secret, bridge token). **P2 operational UX:** "Dosyadan Geri Yükle" + file picker, post-restore SHA-256+integrity-check + safety revert, "Dışa Aktar" per-backup button, disk-space pre-check warning, two-step restore modal (summary + final confirm). **P3 external protection:** SHA-256 hash in meta.json + verification on restore, Windows Task Scheduler integration (gece 03:00 robocopy, hedef klasör picker, manuel tetik, config JSON). `backup-restore-readiness-plan.md` risk matrix + runbook. 0 lint warnings. |
| D-1 | Test + CI Kapısı | GitHub Actions CI (lint + backend tests + frontend RTL + Playwright e2e), RTL test suite (PaymentScreen, OrderScreen — 22 tests), Playwright e2e job eklendi CI'a, `db:seed` artık `app.setup` settings kaydı yazıyor (Playwright readiness yönlendirmesi engellenir). |
| D-2 | Signing + Wizard + Update Disiplini | First-run setup wizard (4 adım: hoş geldiniz → işletme adı → admin parola → tamamlandı), `setup:is-completed`/`setup:complete` IPC, `pos-config.json` `setupCompleted` flag, `UpdateNotification` expandable release notes. Kod imzası ertelendi (sertifika satın alımı gerekli). |
| D-3 | Operasyonel Görünürlük | StoreBridge file log (`userData/logs/store-bridge.log`, 5 MB rotation → `store-bridge.old.log`), `writeBridgeLog` (info/error, timestamp prefix), `setupBridgeFileLogging` + `bridgeLogStream` cleanup on `before-quit`. Crash reporter: `writeCrashLog` → `crashes.log` JSON-line (ts/type/message/stack/version/platform/arch), `uncaughtException`/`unhandledRejection` capture. Server: `requestIdMiddleware` (`X-Request-Id` header, `crypto.randomUUID`), JSON-line access log (`[access]` prefix: method/path/status/ms/requestId, health check hariç). |
| D-4 | Monolitik Ayrıştırma | `electron/main.cjs` 301 satırlık orchestrator'a indirildi ve `electron/modules/*` altına bölündü; `server/routes/orders.js` + `payments.js` domain logic'i `orderService.js`/`paymentService.js` içine taşındı; `client/src/services/api.js` 31 satırlık facade oldu ve domain mixin modüllerine ayrıldı; `OrderScreen.jsx` için `useCatalog`, `useCart`, `ModifierModal`, `ClipboardEmpty` çıkarıldı; `PrinterDetailPage.jsx` için `usePrinterForm`, `PrinterDeviceSection`, `PrinterPreviewPanel` çıkarıldı. Son doğrulama: 318/318 test, `lint:ci` 0 warning, client build başarılı. |

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
- CallerID (C812A V8 HID device, clipboard bridge via PowerShell; SDK helper as primary — **self-contained win-x64 binary**)
- Socket.io real-time (kitchen, table, takeaway screens)
- **Daily automatic DB backup** (02:00, 30-day retention, WAL-safe snapshot)
  - Backup scope: pos.db + uploads/products/ folder + pos-config.json snapshot
  - Sidecar meta.json: appVersion, schemaVersion, rowCounts, integrityCheck, sha256, dbSizeBytes
  - Manual backup via Settings → Bakım ve Yedekleme → Manuel Yedek Al
  - Restore via two-step modal (summary + final confirm) with open-order warning
  - Post-restore integrity verification + automatic safety revert on failure
  - SHA-256 hash validation on restore (detect corrupted backups)
  - Windows Task Scheduler: nightly 03:00 robocopy to external folder (USB, network drive)
  - External backup import (UI file picker) + export (save dialog) per backup
  - Disk space pre-check before backup (warns if insufficient)
- Role-based auth: Admin, Cashier, Waiter, Kitchen
- **318 automated tests** (Vitest + Supertest integration), all passing
- 15/15 production checklist items complete
- Electron packaging: NSIS Setup + Portable `.exe` (`npm run dist:win`)
- One-click Windows startup scripts (`scripts/start-all.bat`)
- Customer notification sound on new order
- electron-updater auto-update (GitHub Releases, v1.0.3+); `dist:release` generates `latest.yml`
- **First-run setup wizard** (4 adım: hoş geldiniz → işletme adı → admin parola → tamamlandı); `setup:is-completed`/`setup:complete` IPC; `pos-config.json` `setupCompleted` flag
- `UpdateNotification`: expandable release notes ("Değişiklikleri gör/gizle"), indirme progress bar, "Kur ve Yeniden Başlat"
- **Operasyonel görünürlük (D-3):** `userData/logs/store-bridge.log` (5 MB rotation), `crashes.log` JSON-line crash reporter (`uncaughtException`/`unhandledRejection`), `X-Request-Id` correlation header (her API request), JSON-line structured access log
- **D-4 monolitik ayrıştırma:** Electron main process modüllere ayrıldı; orders/payments route'ları domain service çağıran ince HTTP katmanlarına dönüştü; API client domain modüllerine bölündü; OrderScreen ve PrinterDetailPage ilk güvenli hook/component extraction dilimlerini aldı.
- Product image upload (server/uploads/products/, /uploads static)
- Combo menu support (product_combos table, UI in MenuProductEditorPage)
- Customer 360 profile (total spend, order count, last visit, top 3 products)
- Advanced order analytics (top 10 products, peak hours, daily revenue — recharts)
- Order report Excel export + print/PDF (daily + order history)
- Waiter call QR code (table QR → customer scan → real-time notification via Socket.io)
- Receipt templates rebuilt (4 templates: PAKET KASA, PAKET MUTFAK, MASA MUTFAK, MASA KASA — 32-char separators)
- Supertest integration tests (auth, orders, payments, reports, adminPrinters, bridgePrintJobs, takeawayDelivery, tables, orderLifecycle, **adminBridgeObservability** — 10 files)
- `orderPaymentState.test.js`: 33 unit test — roundMoney, getPaidTotal, isOrderFullyPaid, canCloseOrder, getPaymentStateLabel, getPaymentSummary
- `orderActionPolicy.test.js`: 30 unit test — canOpenOrderPayment, canEditOrderItem, canVoidOrderItem, canSaveOrderDraft
- QA regression audit: `docs/audit/08-qa-regression-audit.md` + `docs/testing/regression-checklist.md`
- `ConfirmDialog` + `useConfirmDialog`: all `window.confirm` calls replaced with in-app modal
- `orderActionPolicy.js` + `orderPaymentState.js`: centralized order/payment decision utilities
- `api/core.js`: HTTP core separated from `api.js` facade
- Print queue: lease-based claim, claim ownership guard, manual retry for failed jobs, structured error codes
- `printErrorMessages.js`: 16 ESC/POS error codes → Turkish `{ label, action }` dictionary (client/src/utils/)
- `toast.warning` type in ToastContext — used for print failures, backup alerts
- `StoreBridgePage` (`/settings/bridge`): health badge, queue summary, printer list, 200-line log tail, "Destek Paketi İndir"
- `GET /admin/support-bundle`: full diagnostic bundle (system, DB, bridge, print queue, logs)
- `backup-failed` IPC channel: Electron → preload → App.jsx → toast.warning on backup error
- MaintenancePage: backup staleness banner (warns if last backup >2 days old)
- PaymentScreen: toast.warning with `getPrintErrorAction()` when print job fails after payment
- StoreBridge: API timeout enforcement, health-retry on startup, CallerID reconnect + bounded POST retry + duplicate ringing guard
- Electron persistent logging: all process stdout/stderr + uncaught exceptions written to `userData/logs/electron-main.log`
- JWT secret persisted to `pos-config.json` on first launch (sessions survive restarts without explicit `.env` config)
- CallerID helper `.exe` included via `extraResources`; **self-contained win-x64 publish** — no .NET runtime required on target machine
- `store-bridge/printers/encoding.js`: encoding/ESC-POS logic extracted from `renderers.js` into standalone module
- Full audit documentation in `docs/audit/` (11 numbered reports: 00–10, + repo-cleanup-audit); sprint pass docs in `docs/audit/archive/`
- Desktop install runbook: `docs/runbooks/desktop-install-runbook.md`
- Backup & restore runbook: `docs/runbooks/backup-restore-runbook.md`
- Code signing runbook: `docs/runbooks/code-signing-runbook.md`
- Printer acceptance checklist: `docs/runbooks/printer-acceptance-checklist.md`
- `ErrorBoundary` component: React crash → "Yenile" ekranı (beyaz ekran koruması), mounted at app root in `main.jsx`
- Security hardening: `err.message` removed from all 500 responses; failed login → `login_failed` audit log; **`pos-config.json` removed from git tracking + gitignored**
- Bridge max restart guard: `BRIDGE_MAX_RESTARTS=10` — stops infinite restart loop
- ESLint: `client/eslint.config.js` (ESLint 10 flat config), **`lint:ci --max-warnings 0`** — zero warnings enforced in CI
- Playwright e2e: `e2e/table-order-payment-close.spec.js` + `e2e/takeaway-order.spec.js`
- `scripts/smoke-server-health.cjs`: starts server with temp DB, polls `/api/health`, verifies migration — wired into `dist:prepare`
- Repo cleanup: 451 MB artifacts removed, 9 orphaned scripts deleted, `docs/audit/archive/` organized

## Pending Tasks

All backup/restore critical gaps (P1), operational visibility (D-3), and monolithic decomposition (D-4) are complete.

### Next Required Roadmap Step — D-5 Product Gaps
Follow the audit report dependency order. Do not start DB-1/O-1/mobile/cloud work until D-5 is either completed or explicitly deferred by the user.

1. **D-5.1 Period close / X-Z report** — add day/shift close model, X preview, Z close, closed-period lock behavior, and reports UI.
2. **D-5.2 Refund / return flow** — add post-payment refund records tied to original payments/orders, protect closed periods, and surface refund totals in reports.
3. **D-5.3 Tip / bahşiş model** — add tip capture and reporting after the refund foundation is in place.
4. **D-5.4 Reservation → table seating** — connect reservations to table occupancy/open-order flow with arrived/no-show guardrails.
5. **D-5.5 Payment terminal SDK** — optional; keep deferred unless hardware/provider is chosen.
6. **D-5.6 e-belge integration** — optional; keep deferred until fiscal provider and legal scope are chosen.

### Remaining Architectural Debt (after D-5, low risk)
- `TablesScreen.jsx` — extract `useTablesData`, `TakeawaySidebar`, `TableCard` components.
- Continue gradual `OrderScreen.jsx` extraction only in small, tested slices; do not do a large UI rewrite.
- `server/routes/orders.js` inline status enum → import from `server/constants/orderStatus.js`.

### Print queue UI (P2)
- Print queue summary panel in Admin UI (pending/failed/stale counts)
- `last_error_code` surfaced in failed job rows with actionable resolution messages
- Manual retry confirmation modal for failed print jobs
- StoreBridge log written to file (parallel to `electron-main.log`)

### Desktop / release (P1→P2)
- Code signing certificate + signed NSIS pipeline (currently SmartScreen warning on install) — see `docs/runbooks/code-signing-runbook.md`
- Backup encryption (AES-256) with key management — low priority, defer to v2 if needed

### After production testing (v2 roadmap)
- Multi-branch dashboard
- Online order integrations (Yemeksepeti, Getir)
- Mobile waiter app (tablet/offline)
- Loyalty program
- Frontend test coverage (React component tests)
- QR code local generation (replace external api.qrserver.com dependency)

## Critical Technical Notes
- **`better-sqlite3`** — must be rebuilt for Electron ABI; `npm run dist:prepare` handles this automatically via `scripts/rebuild-server-native.cjs`. Requires Visual Studio "Desktop development with C++" for source builds. Vitest uses system Node: if `npm run test` fails with an ABI/version mismatch after `postinstall` or an Electron rebuild, run `npm rebuild better-sqlite3` in `server/`.
- **`store-bridge/node_modules`** — `dist:prepare` runs `npm install --prefix store-bridge --omit=dev` since Sprint 9. Previously missing, caused iconv-lite crash in v1.0.2. Do NOT remove this step.
- **PC857 Turkish encoding** — `ESC t 12` command; per-printer `skipInit` setting available to skip `ESC @` initialization (fixes Turkish chars on some network printers). Encoding logic lives in `store-bridge/printers/encoding.js` (extracted from `renderers.js` in Sprint 10).
- **CallerID** — Primary: C# SDK helper (`tools/callerid-sdk-helper`), **self-contained win-x64 binary** (no .NET runtime needed). Fallback: clipboard listener (`scripts/callerid-clipboard-listener.ps1`). Both POST to `POST /api/bridge/caller-id/incoming` with `X-Bridge-Token`. CallerID helper `.exe` is bundled via `extraResources`; `desktop:preflight` verifies it exists before packaging.
- **BRIDGE_TOKEN** — must always be masked in logs (`***`); never log in plain text.
- **DB transactions** — order, payment, and print operations must be atomic (all-or-nothing).
- **Mock mode** — must default to OFF; must never be enabled in production.
- **userData path** — in packaged Electron, SQLite lives at `app.getPath('userData')` (`%APPDATA%\restoran-pos\pos.db`). On first launch, migrates from `server/data/pos.db` if userData is empty. `uploads/` and `backups/` also live under userData.
- **Electron logging** — all process stdout/stderr (backend, StoreBridge, CallerID) and uncaught exceptions are written to `userData/logs/electron-main.log`. Check this file first for field support.
- **JWT_SECRET** — on first Electron launch the secret is auto-generated and persisted to `userData/pos-config.json`, so sessions survive restarts without requiring `server/.env`. Set explicitly in `.env` for browser-only (`prod`) mode. **`pos-config.json` is gitignored — never commit it.**
- **`server/.env`** — never committed to git.
- **`pos-config.json`** (root) — local Electron config, contains JWT secret. Gitignored since Sprint 11. Never commit.
- **CORS_ORIGINS** — LAN IP support configured via env var.
- **Socket.io** — kitchen, table, and takeaway screens use real-time events (not polling).
- **electron-builder** — pinned to `24.13.3`; do NOT upgrade to 25.x (known 7za/packaging issues).
- **Print queue lease** — `print_jobs` rows use `claimed_until` for lease-based ownership. A claimed job whose lease has expired is fair game for re-claim. Status updates are rejected (409) if the claiming bridge ID doesn't match. Failed jobs require explicit admin manual retry — no automatic retry by design (prevents duplicate kitchen receipts).
- **ConfirmDialog** — `window.confirm` is banned. Use `client/src/components/common/ConfirmDialog.jsx` + `useConfirmDialog.js` hook for all destructive-action confirmations.
- **ESLint** — `lint:ci` enforces `--max-warnings 0`. Any new warning breaks the CI gate. Fix warnings before committing.
- **dist:release** — Full release chain: `npm run dist:release` = `dist:win` + `dist:gen-update-meta` (generates `latest.yml` for electron-updater).
- **Desktop Readiness checks** — `receipt_printer` and `kitchen_printer` are `warning` (not `blocker`). Businesses without printers can complete setup. See `buildDesktopReadiness()` in `server/routes/admin.js`.
- **`app.setup` settings key** — written by `db:seed` and by `POST /api/admin/desktop-readiness/complete`. Controls whether app redirects to readiness page on every navigation. If not set, users are locked out of all non-settings screens.

## Folder Structure
```
restoran-pos-v3/
├── client/                    # React 18 + Vite frontend
│   └── src/
│       ├── components/        # auth, layout, tables, orders, payments,
│       │                      # kitchen, callerid, customers, reports, settings
│       │   └── common/        # ConfirmDialog, useConfirmDialog, ErrorBoundary,
│       │                      # ManualPrintSelectorModal
│       ├── context/           # Auth, Toast (w/ warning), IncomingCall, Socket
│       ├── services/          # API service layer
│       │   └── api/           # HTTP core + domain mixins; api.js is thin facade
│       ├── utils/             # orderActionPolicy.js, orderPaymentState.js,
│       │                      # printErrorMessages.js, tableUtils.js, displayTheme.js
│       ├── constants/         # Constants, formatters, menuUi
│       └── styles/            # global.css
├── server/                    # Express backend
│   ├── config/                # DB connection, index.js
│   ├── middleware/            # auth.js, bridgeAuth.js, validate.js
│   ├── routes/                # auth, tables, products, orders, payments,
│   │                          # customers, callerid, reports, printer,
│   │                          # admin, bridge, reservations, stock, waiterCall, attributes
│   ├── services/              # printJobs.js, callerIdService.js,
│   │                          # printRouting.js, printerAutoPrintPolicy.js
│   ├── constants/             # orderStatus.js
│   ├── utils/                 # helpers.js, phoneNormalize.js
│   ├── migrations/            # run.js — idempotent schema migration
│   ├── seeds/                 # Demo data (run.js)
│   ├── tests/                 # 318 Vitest tests (24 files)
│   │   ├── integration/       # 10 integration test files
│   │   └── frontend/          # storeBridgeClientMappings.test.js
│   └── index.js               # Server entry point
├── electron/
│   ├── main.cjs               # Thin Electron orchestrator (logs → userData/logs/)
│   ├── modules/               # config, logging, process, backup, bridge, callerId, window modules
│   └── preload.cjs            # IPC bridge (contextBridge)
├── store-bridge/              # Local printer bridge; hardware CID (HID/clipboard)
│   ├── printers/
│   │   ├── encoding.js        # PC857/Win1254 encode, ESC-POS helpers
│   │   └── renderers.js       # Receipt rendering (re-exports encoding.js)
│   ├── callerid/              # Cid812Provider.js
│   └── jobs/                  # poller.js
├── tools/callerid-sdk-helper/ # C# CallerID SDK helper (.NET 8, self-contained win-x64)
├── e2e/                       # Playwright smoke tests (table-order-payment, takeaway)
├── scripts/                   # Build helpers + Windows .bat starters
│   ├── build-callerid-helper.cjs   # dotnet publish self-contained win-x64
│   ├── check-desktop-release.cjs  # desktop:preflight validation
│   ├── gen-update-meta.cjs        # latest.yml generator for electron-updater
│   ├── smoke-server-health.cjs    # Server health smoke test (dist:prepare chain)
│   ├── smoke-electron-sqlite.cjs  # Electron+SQLite smoke test
│   └── rebuild-server-native.cjs  # better-sqlite3 ABI rebuild
├── docs/
│   ├── runbooks/              # desktop-install, backup-restore, code-signing,
│   │                          # printer-acceptance-checklist
│   └── testing/               # regression-checklist.md
├── resources/                 # elevate.exe (Windows UAC)
└── package.json
```

## Commands
```bash
# Development
npm run dev             # Vite (5173) + API (3001) concurrently
npm run test            # Run all 318 tests (from repo root; delegates to server)
npm run test:watch      # Watch mode
npm run lint            # ESLint with warnings (dev)
npm run lint:ci         # ESLint --max-warnings 0 (CI gate — must stay 0)

# E2E
npm run test:e2e        # Playwright smoke tests (requires running app)
npm run test:e2e:ui     # Playwright UI mode

# Production (browser)
npm run prod            # Build client → start Express in production mode

# Electron
npm run electron:prod         # Build client → launch Electron
npm run build:callerid-helper # Build CallerID C# helper exe (requires .NET 8)
npm run desktop:preflight     # Verify all release inputs exist before packaging
npm run smoke:server-health   # Server health + migration smoke test
npm run dist:prepare          # Build + rebuild native + smoke tests + preflight → win-unpacked
npm run dist:nsis             # NSIS Setup.exe (needs dist:prepare first)
npm run dist:portable         # Portable .exe (needs dist:prepare first)
npm run dist:win              # Full chain: dist:prepare → dist:nsis → dist:portable
npm run dist:release          # dist:win + generates latest.yml (electron-updater)

# Utilities
npm run db:seed         # Create DB and load demo data
npm run all:start       # Windows: start-all.bat (POS + Bridge + CallerID)
```

## Developer Rules
- UI text and all user-facing content: **Turkish**
- Code, variable names, comments: **English**
- Small, safe steps — no large refactors
- Present a summary before making changes: "What will change and why"
- Do not touch working code unnecessarily
- Every new feature must not break the existing **318 tests**
- `lint:ci` must stay at 0 warnings — fix before every commit
- Summarize what changed only when asked — do not add trailing summaries to every response
- **Always read this file at the start of every session** before making any changes

## Demo Credentials
| Role    | Email              | Password |
|---------|--------------------|----------|
| Admin   | admin@demo.com     | 123456   |
| Cashier | kasiyer@demo.com   | 123456   |
| Waiter  | garson@demo.com    | 123456   |
| Kitchen | mutfak@demo.com    | 123456   |
