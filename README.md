# Recovery & Resilience | Pillar Intelligence

A source-backed, read-only management dashboard for the supplied Sudan recovery pillar. D3.js handles every analytical chart and interactive geographic layer. Lucide provides interface icons only. The original palette reference and all input files are unchanged.

## Run

Use a current Node.js LTS release and npm:

```powershell
npm install
npm run audit
npm run data
npm run dev -- --port 5173
```

Open the URL printed by Vite, normally http://127.0.0.1:5173/. Vite selects another port if occupied. This loopback development preview intentionally skips SSO; never expose it to a network. HTTP serving is required for local JSON requests; opening the HTML directly is not supported.

The generated data bundle is already included. After editing source workbooks or `Evidence-Based Planning and implementation Maps - Tracker(Tracker).csv`, rerun `audit` and `data`, then reload the page. Inputs are processed locally, not uploaded to a service. The added water register is decoded as Windows-1252 and ingested by the data build.

```powershell
npm test
npx playwright install chromium
npm run test:e2e
npm run build
```

The browser suite uses a separate local test server on port 5175. Screenshots are written to `test-results/`. The production bundle is in `dist/`; serve it from an HTTP server at the origin root.

## UNDP Single Sign-On

The production server uses Microsoft Entra ID with a tenant-specific authorization-code flow, PKCE, nonce/state checks, server-side Redis sessions, CSRF-protected login/logout, and authenticated delivery of the app shell and **all** data/static files. Access is currently allowed to any authenticated user in the configured UNDP tenant; no group/role filter is applied.

Before SSO can work, the UNDP identity team must create or approve a **single-tenant Web app registration** and provide the tenant ID, client ID, approved HTTPS application origin, and redirect URI. Register `${APP_ORIGIN}/auth/callback` and the post-logout return `${APP_ORIGIN}/auth/login?loggedOut=1`; provide the client secret through a deployment secret manager, not source control. Provision a private TLS-enabled Redis service for sessions.

Copy `.env.example` to an untracked `.env` for local configured testing, replace every placeholder with IT-approved values, build, and run:

```powershell
npm run dev:sso
```

Production SSO deployment runs `npm run build` followed by `npm start` behind HTTPS and the approved reverse proxy. In this mode, deploy `dist/` only through `server.mjs`; hosting it as public static files bypasses the session gate. The standalone Vite `npm run dev` preview is also not protected and is bound to loopback only.

The automated SSO tests use a mocked Entra client; they verify PKCE, state/nonce forwarding, tenant rejection, CSRF, logout and protected files, but cannot verify the live UNDP tenant or registration. The current workspace does not contain an app registration, Redis deployment or identity-team configuration, so production sign-in becomes usable only after those are supplied.

### Netlify Drop

This project has a separate public static build for Netlify Drop. To include an ACLED snapshot, set `ACLED_USERNAME` and `ACLED_PASSWORD` as local `.env` values or Netlify **Build** environment variables, then run:

```powershell
npm install
npm run build:static
```

When credentials are present, the build fetches Sudan events from the ACLED API for the trailing 365 days ending on the build date and writes `public/data/acled-snapshot.json`, which Vite copies to `dist/data/acled-snapshot.json`. Optional `ACLED_SNAPSHOT_START` and `ACLED_SNAPSHOT_END` variables override that range. Without credentials, the static dashboard still builds but has no ACLED data; the script logs that snapshot refresh was skipped. Then drop the generated `dist/` folder onto Netlify Drop. If connecting the repository to Netlify instead, `netlify.toml` runs the same build automatically; configure credentials with the **Builds** scope.

This static profile deliberately skips the SSO session lookup and disables live ACLED API access; the fetched snapshot is bundled into the public site. **Every file in `dist/data/` is public and downloadable**, including ACLED events, project data, source workbook audits, and reference layers. Use this deployment only because all bundled data have been approved for public release. The 17.9 MB points-of-interest layer is OpenStreetMap-derived ODbL data. The standard SSO deployment remains available separately through `server.mjs`.

### Direct ACLED API

The Analysis workspace can fetch Sudan events directly through the server-side ACLED API proxy. This requires an ACLED/myACLED account with API access; UNDP SSO does not provide ACLED API entitlement. Set `ACLED_USERNAME` and `ACLED_PASSWORD` in the production deployment's secret manager (or an untracked local `.env` for configured testing). Never put these values in frontend code, browser storage, or a committed environment file. The endpoint requires an authenticated app session, validates the requested dates, and does not persist fetched events. The Vite development preview disables the direct-fetch control; use the built authenticated server (`npm run dev:sso`) for an authorized integration test. Local CSV import remains available as a fallback. Each request is limited to 50,000 events; narrow the date range if the response reports truncation.

The evidence cutoff defaults to **2026-10-19**, not the computer clock. To generate a different snapshot:

```powershell
$env:REPORT_DATE = '2026-10-19'
npm run data
```

## Workspaces

- **Executive overview:** award allocations by currency, activity index, non-unique site service estimates, mapped footprint, closure/reporting exceptions, linked scorecard and watchlist.
- **GIS monitoring:** 19 dissolved state outlines and 189 locality boundaries, project observations, zoom/pan, state/locality selection, screen-grid clustering, estimated service-density choropleth, contextual humanitarian severity, reference layers and site details.
- **Analysis & vulnerability:** state/locality vulnerability screening using IOM DTM displacement, OCHA JIAF needs/severity and mapped site presence; direct ACLED API fetch or fallback CSV import adds conflict maps, hotspots, event types, fatalities, date filters and monthly trends. A visible notice marks provisional results until conflict data is loaded. Displacement is a snapshot, not a movement time series.
- **Project tracker:** award register, activities/deliverables, award timeline, observed handovers, award deadlines, source monitoring KPIs, source risk narratives and derived management exceptions.
- **Pillar analytics:** D3 bar, schedule time series, treemap, heatmap, Sankey and stakeholder network views. Chart selections filter the selected pillar.
- **Evidence & sources:** all 12 XLSX workbooks, 94 sheets and the 252-row water-project register, lazy source-cell inspection, full-source CSV export, methods and reference inventory. The source register intentionally remains independent of pillar filters.

Filters cover state, mapped locality, donor, partner, sector, derived status, tracker/workplan type, project and award-date overlap. Period selection is **not** a historical reporting-snapshot selector. Geography filters select associated awards; budget and activity-index figures remain **award-wide**, not amounts or achievements apportioned to the selected locality.

## Data Model

- `projects`: one management record per award/project unit, with factsheet source, budget/currency evidence, dates, reporting freshness, derived status, RAG and alerts. FD and ER are separate records from one combined workbook.
- `activities`: tracker activities and consolidated REVIVE activities, with numeric target/actual where unambiguous, source-column label, sector and source row. Repeated REVIVE cost lines are retained separately in `financialLines` rather than counted as extra activities.
- `sites`: intervention observations, coordinate text and parsed WGS84 coordinates, source geography and boundary match, estimate/unit, source status and handover. Water-register map, coordinate, BOQ and SOW readiness fields remain distinct from implementation status. Missing coordinates remain unmapped; repeated register rows are retained.
- `locations`, `updates`: reported geographic/partner links and narrative updates. Weekly periods lacking a year are not assigned invented dates.
- `monitoring`, `risks`, `milestones`, `deadlines`: REVIVE monitoring-plan targets and risks, observed handovers and award-end follow-up dates. Monitoring responsibility is not a certified risk owner.
- `beneficiaryRecords`: explicit direct/indirect beneficiary-register fields. Empty targets/actuals stay null.
- `conflictEvents`: API-fetched or imported ACLED rows are held in the browser session and are not persisted; a refresh clears them. API credentials and token handling remain server-side.
- `inventory`, `issues`, `references`, `authorityReference`, `waterRegister`: workbook/CSV coverage, spatial exceptions, reference facilities, education-authority data and water-register readiness totals.

Generated management data lives in `public/data/model.json`; working D3-compatible boundaries are in `public/data/boundaries.geojson`. Each sheet is served on demand from `public/data/audit/`. Large contextual layers load only when selected and are capped at 7,000 displayed features within the selected extent. The source audit is retained separately in `data/workbook-audit.json`; formulas use existing cached results, with no spreadsheet recalculation.

## Interpretation

Read [DATA_ANALYSIS.md](DATA_ANALYSIS.md) for workbook relationships, exact totals, missing data, source-column choices and management recommendations.

No utilization percentage, unique beneficiary coverage percentage, statistical hotspot significance or certified project closure is invented. Numeric progress is a partial activity-evidence index, not official project completion. Gray/no-data states are meaningful.

## Deployment Boundary

The SSO server protects access when deployed with the approved Entra and Redis configuration. The application remains read-only and has no database, multiuser editing, approval workflow or scheduled ingestion. Hosting still requires TLS, monitoring, backups for configuration, and an approved retention policy. The source-cell bundles may contain personal contact information from input registers; restrict access or prepare a redacted publishing build before sharing. Do not expose the Vite development server publicly.

D3, icons and code are served from installed packages. Google Fonts is optional; the interface has font fallbacks if external font access is blocked. Reference assets are supplied local snapshots, not live basemaps. Input datasets and their source-license terms remain the organization's responsibility.
