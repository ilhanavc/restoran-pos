# CLAUDE.md — Restoran POS v3

## Project Overview
Windows desktop restaurant POS application. Production-ready as of April 2026.

**Stack:** Electron + React 18/Vite (frontend) · Node.js/Express (backend) · SQLite (`better-sqlite3`) · Socket.io (real-time) · JWT/bcrypt (auth)

**Overall score: 8.6/10** (up from 7.5/10) · 8 sprints completed · 101 automated tests · 15/15 production checklist items passed

## Scores
| Category            | Score  | Change |
|---------------------|--------|--------|
| Feature Completeness| 9/10   | +1     |
| Code Quality        | 8/10   | +1     |
| Security            | 9/10   | +3     |
| Performance         | 8/10   | +1     |
| Test Coverage       | 7/10   | +6     |
| Documentation       | 7/10   | ±0     |
| Deployment          | 8/10   | +1     |
| **Overall**         | **8.6**| **+1.1** |

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
- 101 automated tests (Vitest), all passing
- 15/15 production checklist items complete
- Electron packaging: NSIS Setup + Portable `.exe` (`npm run dist:win`)
- One-click Windows startup scripts (`scripts/start-all.bat`)
- Customer notification sound on new order

## Pending Tasks (Priority Order)

### Short (1–3 days)
1. **Order report PDF/Excel export** — customer export exists; order report export missing
2. **Waiter call (QR code)** — table-side QR for calling waiter
3. **electron-updater auto-update** — OTA updates for packaged app
4. **Supertest integration tests** — end-to-end API flow tests

### Medium (weeks)
5. **Product image upload + combo menu**
6. **Customer 360 profile** — lifetime spend, favorite items, analytics
7. **Advanced order analytics**

### Long-term
- Multi-branch dashboard
- Online order integrations (Yemeksepeti, Getir)
- Mobile waiter app (tablet/offline)
- Loyalty program

## Critical Technical Notes
- **`better-sqlite3`** — must be rebuilt for Electron ABI; `npm run dist:prepare` handles this automatically via `scripts/rebuild-server-native.cjs`. Requires Visual Studio "Desktop development with C++" for source builds. Vitest uses system Node: if `npm run test` fails with an ABI/version mismatch after `postinstall` or an Electron rebuild, run `npm rebuild better-sqlite3` in `server/`.
- **PC857 Turkish encoding** — `ESC t 12` command; per-printer `skipInit` setting available to skip `ESC @` initialization (fixes Turkish chars on some network printers).
- **CallerID** — Primary: C# SDK helper (`tools/callerid-sdk-helper`). Fallback: clipboard listener (`scripts/callerid-clipboard-listener.ps1`). Both POST to `POST /api/bridge/caller-id/incoming` with `X-Bridge-Token`.
- **BRIDGE_TOKEN** — must always be masked in logs (`***`); never log in plain text.
- **DB transactions** — order, payment, and print operations must be atomic (all-or-nothing).
- **Mock mode** — must default to OFF; must never be enabled in production.
- **userData path** — in packaged Electron, SQLite lives at `app.getPath('userData')` (`%APPDATA%\restoran-pos\pos.db`). On first launch, migrates from `server/data/pos.db` if userData is empty.
- **CORS_ORIGINS** — LAN IP support configured via env var.
- **Socket.io** — kitchen, table, and takeaway screens use real-time events (not polling).
- **electron-builder** — pinned to `24.13.3`; do NOT upgrade to 25.x (known 7za/packaging issues).
- **JWT_SECRET** — must be set in `server/.env` for production; Electron generates random per-launch if missing (sessions won't persist across restarts).
- **`server/.env`** — never committed to git.

## Folder Structure
```
restoran-pos-v3/
├── client/                    # React 18 + Vite frontend
│   └── src/
│       ├── components/        # auth, layout, tables, orders, payments,
│       │                      # kitchen, takeaway, callerid, customers,
│       │                      # reports, settings
│       ├── context/           # Auth + Toast context
│       ├── services/          # API service layer
│       ├── constants/         # Constants, formatters
│       └── styles/            # Global CSS
├── server/                    # Express backend
│   ├── config/                # DB connection
│   ├── middleware/            # Auth, authorization
│   ├── routes/                # auth, tables, products, orders, payments,
│   │                          # customers, callerid, reports, printer,
│   │                          # admin, bridge
│   ├── migrations/            # Table creation
│   ├── seeds/                 # Demo data
│   ├── tests/                 # Vitest tests (101 tests)
│   └── index.js               # Server entry point
├── electron/
│   └── main.cjs               # Electron main process
├── store-bridge/              # Local printer bridge; hardware CID (HID/clipboard)
├── tools/callerid-sdk-helper/ # C# CallerID SDK helper (.NET)
├── scripts/                   # .bat startup scripts, build helpers
└── package.json
```

## Commands
```bash
# Development
npm run dev             # Vite (5173) + API (3001) concurrently
npm run test            # Run all 101 tests (from repo root; delegates to server)
npm run test:watch      # Watch mode

# Production (browser)
npm run prod            # Build client → start Express in production mode

# Electron
npm run electron:prod   # Build client → launch Electron
npm run dist:prepare    # Build + rebuild native + smoke test → release/win-unpacked
npm run dist:nsis       # NSIS Setup.exe (needs dist:prepare first)
npm run dist:portable   # Portable .exe (needs dist:prepare first)
npm run dist:win        # Full chain: dist:prepare → dist:nsis → dist:portable

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
- Every new feature must not break the existing 101 tests
- Summarize what changed only when asked — do not add trailing summaries to every response

## Demo Credentials
| Role    | Email              | Password |
|---------|--------------------|----------|
| Admin   | admin@demo.com     | 123456   |
| Cashier | kasiyer@demo.com   | 123456   |
| Waiter  | garson@demo.com    | 123456   |
| Kitchen | mutfak@demo.com    | 123456   |
