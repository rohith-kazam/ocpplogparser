# CONTEXT.md — OCPP Log Report

> Handoff/context file for editing this project in VSCode. Read this first.
> If you use an AI coding assistant, you can rename or symlink this to
> `CLAUDE.md`, `AGENTS.md`, or `.github/copilot-instructions.md` — the content
> is the same.

## What this is

A **100% client-side** OCPP 1.6J log analyzer. The user uploads a CSV export of
OCPP traffic in the browser; the app parses it in JavaScript (no server, nothing
uploaded) and renders, per charging transaction: a graph for each measurand, markers
at status/config changes, and a fault/voltage/power/current summary.

It was ported from an original Python script (`ocpp_parser.py`, not in this repo —
it generated a static HTML report). The JS port reproduces that script's numbers
exactly. Keep that parity in mind when changing analytics.

## Tech stack

- **Vite 5** (build tool, dev server). No framework — vanilla ES modules.
- **Plotly.js** (`plotly.js-dist-min`) for charts, bundled into the build.
- **PapaParse** for CSV parsing.
- No TypeScript, no React, no state library. Keep it dependency-light.

## Commands

```bash
npm install
npm run dev       # dev server, http://localhost:5173
npm run build     # static site -> dist/
npm run preview   # serve the built dist/ locally
```

Deploy: Netlify reads `netlify.toml` (build `npm run build`, publish `dist`).
See README.md for the three deploy options.

## File map

| File | Responsibility |
|------|----------------|
| `index.html` | Entry point + upload UI markup (dropzone, intro, empty `#report`). |
| `src/parser.js` | **Pure logic, no DOM.** OCPP frame decoding + all analytics. The brain. |
| `src/charts.js` | Builds one Plotly figure per measurand. Imports `Plotly`. |
| `src/main.js` | Glue: file upload/drag-drop, calls `parseRows`, builds the report DOM. |
| `src/style.css` | All styles. Dark "instrument panel" theme via CSS variables. |
| `vite.config.js` | `base: './'` (relative asset paths so it works on any Netlify path). |
| `netlify.toml` | Build config + SPA redirect. |

**Rule of thumb:** analytics/domain logic goes in `parser.js` (and stays DOM-free so
it's unit-testable in Node); anything touching `document` goes in `main.js`; anything
touching Plotly goes in `charts.js`.

## CSV / data format

Input columns: `TIMESTAMP, DEVICE ID, SOURCE, TYPE, ACTION, MESSAGE`.
`MESSAGE` is a raw OCPP-J frame (JSON array):

- CALL:       `[2, "<uid>", "<Action>", { ...payload }]`
- CALLRESULT: `[3, "<uid>", { ...payload }]`
- CALLERROR:  `[4, "<uid>", "<errCode>", ...]`

`decodeFrame()` returns `{ mtid, action, payload }`. Only CALL (`mtid === 2`) carries
the action name and request payload; CALLRESULT (`mtid === 3`) carries the response.

## Data model produced by `parseRows(rows)`

```
{
  deviceIds:  Set<string>,
  transactions: Map<key, {
      txid, connector,
      series: Map<measurandKey, [ [Date, value, unit], ... ]>,  // sorted by time
      first, last,            // from MeterValues timestamps
      start, stop,            // from Start/StopTransaction (may be null)
      meterStart, meterStop, idTag,
  }>,
  statusChanges: [ { ts, connector, status, errorCode, info, prev } ],
  configEvents:  [ { ts, action, kind:'change', source } ],
  boots: [...], heartbeats: number, counts: {action: n},
  rowCount, span: [Date, Date],
}
```

`measurandKey(sv)` = `measurand` plus `" (phase)"` when phased, e.g.
`"Voltage (L1)"`, `"Energy.Active.Import.Register"`. `shortLabel()` maps these to
human names (Voltage / Current / Power / Energy / ...).

## Domain decisions & invariants (DO NOT silently change these)

1. **Transaction grouping** is by `transactionId`, taken directly from each
   `MeterValues` payload. A `StartTransaction` CALL has no txid — it arrives in the
   CALLRESULT — so the code holds a `pendingStart` and attaches it when the result
   comes in. MeterValues whose txid is unknown are bucketed under `no-tx@conn<N>`.

2. **Status change** = a change in the `(status, errorCode)` pair for a given
   connector vs. the previous notification on that connector. Unchanged repeats are
   dropped. `prev` records the previous status (used for fault-edge detection).

3. **Config markers fire ONLY on configuration *changes*.** `CONFIG_CHANGE` =
   `ChangeConfiguration, ChangeAvailability, SetChargingProfile, ClearChargingProfile,
   SendLocalList`. Read-only actions (`GetConfiguration`, `GetLocalListVersion`, ...)
   are intentionally **not** marked. This was an explicit user requirement.

4. **Fault counting** (`faultsDuringTx`): an *episode* is a rising edge into
   `Faulted` (`status === 'Faulted' && prev !== 'Faulted'`) within the transaction's
   active window, on the transaction's connector or connector 0 (controller-level).
   The charger repeats a Faulted notification ~every 60 s while faulted, so raw
   notification counts overstate it — the UI shows both ("3" with sub "3 fault
   notifications").

5. **Transaction window** = `[start || first, stop || last]` — i.e. use the
   StartTransaction/StopTransaction times if present, else fall back to the first/last
   MeterValues timestamp. Markers and faults are filtered to this window.

6. **All times are UTC.** Display uses ISO slices; do not localize without telling
   the user.

7. **Summary stats** (`seriesStats`): per-measurand min/max/first/last/unit. Energy
   delivered = `last - first` of the energy register (Wh → kWh for display).

## Charts (`charts.js`)

`renderChart(el, key, pts, statusChanges, configEvents, windowRange)`:
- line+markers trace for the measurand (color from `seriesColor`);
- a "Status change" scatter (diamonds, colored by `STATUS_COLOR`, red for Faulted)
  with a faint dotted vertical guide line per event;
- a "Config change" scatter (cyan squares) with dashed guide lines;
- vertical guides are Plotly `layout.shapes` with `yref:'paper'`.
- Plotly config: `{ responsive: true, displaylogo: false }`.

Charts are rendered inside a `requestAnimationFrame` after the DOM is built, because
Plotly needs the container to already have a width.

## Styling

Dark theme, CSS variables in `:root` (`--bg`, `--panel`, `--accent` amber,
`--accent-2` green, `--danger` red, `--mono` for data). Cards grid is
`auto-fill minmax(160px,1fr)`; charts grid is 1 col on mobile, 2 cols ≥780px.
Monospace is used for all numeric/data text to give the instrument-panel feel.
Keep the boldness in the accent + fault-red; everything else stays quiet.

## Regression check (sample log)

The dev sample log (`5buc2j`, Jun-23→24 2026) must yield:

- 10564 frames, **2 transactions**, 151 status changes, **0 config events**
  (the sample has only config *reads*), **7 device fault episodes**.
- TX 62499107 (conn 1): faults ep=3; Voltage 0.02–266.04 V; Current 0–30.14 A;
  Power 0–6946 W; Energy 815943→819979 Wh.
- TX 80278700 (conn 1): faults ep=2; Voltage 0.02–259.68 V; Current 0–29.39 A;
  Power 0–6899 W; Energy 819982→827336 Wh.

If you touch `parser.js`, re-verify these. Quick Node test:

```js
// run from project root: node check.mjs
import fs from 'fs';
import Papa from 'papaparse';
import { parseRows, faultsDuringTx, seriesStats } from './src/parser.js';
const text = fs.readFileSync('PATH/TO/sample.csv', 'utf8');
const data = parseRows(Papa.parse(text, { header: true, skipEmptyLines: true }).data);
console.log(data.rowCount, data.transactions.size,
  data.statusChanges.length, data.configEvents.length);
```

## How to extend (common tasks)

- **New measurand** (e.g. Temperature, SoC, Frequency): nothing required in the
  parser — `parseRows` already captures any `sampledValue`. To give it a nice name
  add an entry to `shortLabel`'s `nice` map; to give it a line color add a key to
  `SERIES_COLOR` in `parser.js`. The Voltage/Current/Power/Energy charts are ordered
  first in `main.js` (`order = [vkey,ikey,pkey,ekey]`); others follow in discovery
  order.
- **New summary card:** add a `card(...)` call in the per-tx block of `buildReport`
  (`main.js`) using values from `seriesStats(tx)`.
- **New device-level metric:** compute it in `buildReport` near `globalExtremes`,
  append a `card(...)` to `devCards`.
- **Add an export button (CSV/JSON/HTML):** add the button in `index.html`, wire it
  in `main.js`. The full parsed `data` object is available in `buildReport` scope —
  serialize from there. (Not yet implemented; was offered.)
- **Shrink the bundle:** Plotly is ~4.7 MB (1.4 MB gzip). To drop it from the bundle,
  load Plotly from a CDN `<script>` in `index.html` and mark it external in
  `vite.config.js` (`build.rollupOptions.external`), then use the global `Plotly`
  instead of importing it in `charts.js`. Trade-off: needs internet to load the lib.

## Gotchas

- Don't import DOM code into `parser.js` — it must stay runnable in plain Node for the
  regression check.
- `base: './'` in `vite.config.js` is deliberate (relative paths). Don't switch to
  absolute `/` unless you know the deploy path is the domain root.
- PapaParse handles the doubled-quote (`""`) escaping inside `MESSAGE`; don't hand-roll
  CSV splitting.
- The sample CSV is single-phase (L1) and AC. Multi-phase logs will produce multiple
  series per measurand (e.g. `Voltage (L1)`, `Voltage (L2)`) — that's expected and the
  UI already renders one chart each.