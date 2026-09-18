# Parent Account Finder

Standalone read-only lookup app for Sales Ops (separate from the `Account
Parent-Mapping Monitor` app, which shows a full weekly dashboard of every
duplicate-name group instead of a per-ID lookup). Paste or upload an **Account ID or
Opportunity ID** — one at a time, or a single Excel column of mixed IDs — and see
whether that Account has likely duplicate-name matches that should be grouped under
one Parent Account: Account ID, Account Name, Account Owner, current Parent Account,
and a suggested Parent Account. For manual review and correction directly in CRM. It
never writes back to CRM.

**Data model:** `backend/resources/db/migration/V1__init.sql` — `accounts_mirror` (one
row per CRM Account, Indonesia record type only, refreshed on every sync),
`fuzzy_matches` (near-duplicate name pairs, recomputed every sync), `sync_runs` (audit
trail), and `lookup_jobs` (one row per batch paste/upload run, results stored as JSON).
Same `record_type_id = 10` (Indonesia) scoping and the same reason as the Monitor app:
the free-text `account_record_type` field is sometimes blank on newer Accounts and
silently drops genuine Indonesia Accounts.

**Why a local mirror, not a live CRM query per lookup:** exact-name and
shared-phone/NPWP/identification-number matching need to scan the *whole* Indonesia
Account set, not just what a live CRM search call happens to rank highly. The mirror
is kept in sync by the same weekly background job + "Sync now" endpoint as the Monitor
app (`backend/main.py`'s `do_sync`), and every lookup queries it with a handful of
indexed queries (`normalized_name`, `phone_digits`, `tax_id_digits`,
`identification_number_digits` — all indexed) rather than a full scan.

**ID resolution (`_resolve_account` in `backend/main.py`):** tries the mirror as an
Account id first, then a live Opportunity lookup (`GET /objects/Opportunity/records/{id}`)
to resolve its `account_id`, then a live Account lookup as a last resort (covers an
Account created after the last sync). This is a best-effort type sniff — Account and
Opportunity ids are separate CRM sequences with non-overlapping observed ranges
(confirmed live: Accounts ~1.4M vs Opportunities ~900K) — a documented limitation, not
a bug.

**Matching logic (ported from the Monitor app, scoped to one Account instead of the
whole mirror):** exact normalized-name match, fuzzy name match (rapidfuzz
`token_sort_ratio` ≥ 88, computed at sync time into `fuzzy_matches`), and shared
phone/NPWP/identification-number. Suggested parent per group: the existing parent used
by the most group members (majority vote), else the oldest-created member — same as
the Monitor app's `_summarize_group`. Unlike the Monitor's dashboard (which hides
already-correctly-parented Accounts), this app shows every group member with a
per-row status, since a lookup tool should confirm the full picture for the ID asked
about.

**CRM integration:** `backend/crm_client.py` — same REST contract as the sibling
Monitor and EKYC apps' `crm_client.py` (`X-API-Key` auth, `/api/v1/objects/...`), but
read-only: `list_all_accounts()` (paginated, for the sync) and `get_record()` (single
record, for live ID resolution). No write methods.

## Substrait deployment

This project deploys to the **Substrait platform** (linked via the gitignored
`.substrait/config.json`). Deploy with **`/substrait:deploy`** (packages source-only,
uploads, `--watch` follows the build to the live preview); re-link with
`/substrait:link`. The `substrait-app` skill has the full contract; the essentials:

**Hard requirements (platform-enforced):**
- Backend in any language. Its Dockerfile — `cicd/Dockerfile.backend` (repo-root build
  context), `cicd/Dockerfile`, or `backend/Dockerfile` (backend/ context) — must
  `EXPOSE 8000`, serve `GET /health` (200) and the API under **`/api`**.
- Frontend optional, any framework: built site served on **port 80** via
  `cicd/Dockerfile.frontend` (or `frontend/Dockerfile`). One ingress host routes
  `/api` → backend, everything else → frontend (no `frontend/` → everything → backend,
  so serve `/` yourself). The frontend calls the API via **relative `/api` paths** —
  never an absolute URL, never `VITE_API_URL`.
- Database is **always OceanBase (MySQL wire)** — MySQL driver only, never Postgres.
  The platform injects `DATABASE_URL` and `JWT_SECRET`. **All DDL lives in
  Flyway files** `backend/resources/db/migration/V*.sql` (MySQL dialect) — the app
  never `CREATE TABLE`s.
- Backing services (redis / kafka / qdrant): declare them in a **`substrait.yaml`** at
  the repo root (`services: {redis: {}, kafka: {persistent: true}, qdrant: {}}`) — the
  platform provisions them and injects `REDIS_URL` / `KAFKA_BROKERS` / `QDRANT_URL`
  only for what's declared. Ephemeral unless `persistent: true`. This app declares
  none — just the database above.
- Custom env vars/secrets: declare in `backend/.env.example` (`NAME=value`, trailing
  `# secret` marks a secret) — the portal pre-creates them for the owner to fill in.
  Build-time frontend vars go in a committed `frontend/.env.production` (public,
  non-secret values only).
- Never create `k8s/` (platform-owned, discarded). Uploads are source-only, ≤ 16 MB
  (no `node_modules/`, `.venv/`, `dist/`, build output).

**Platform capabilities to build on:**
- **User identity (Google SSO):** when the app owner enables SSO (portal Access tab),
  every gated backend request carries unspoofable `X-Forwarded-Email` /
  `X-Forwarded-User` headers — identity with no OAuth flow in the app. Absent in local
  dev, on declared public paths, and when SSO is off (then they're client-spoofable —
  never treat as access control). The browser can't see them: expose e.g. `/api/me`.
  SSO-exempt paths (MCP servers, webhooks) are declared on the Access tab and must be
  authenticated by the app itself (e.g. Bearer token from an env secret).
- **API endpoint inventory:** the portal's API tab lists the backend's endpoints,
  auto-harvested from the app's OpenAPI spec after each deploy (FastAPI serves
  `/openapi.json` by default). Spec-less stacks: `/substrait:deploy` generates
  `.substrait/endpoints.json` instead.

**Local dev:** use a MySQL-wire DB so drivers/migrations run unchanged — never SQLite.
Scaffolded projects: `docker compose up -d db && docker compose run --rm migrate`, then
the backend on `:8000` (reading `DATABASE_URL`) and `npm run dev` in `frontend/`.
