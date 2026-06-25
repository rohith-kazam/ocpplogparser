# OCPP Log Report

A fully **client-side** OCPP 1.6J log analyzer. Upload a CSV export of OCPP traffic
in the browser and get, per transaction:

- individual graphs for every measurand in the `MeterValues` (Voltage, Current, Power,
  Energy, and anything else present, phase-aware);
- markers wherever a `StatusNotification` state changed (diamonds, red for `Faulted`)
  or the **configuration was changed** (squares — `ChangeConfiguration`,
  `ChangeAvailability`, `SetChargingProfile`, `ClearChargingProfile`, `SendLocalList`;
  read-only actions like `GetConfiguration` are intentionally ignored);
- a summary: mid-transaction fault count, peak/min voltage, max/min power, max/min
  current, energy delivered, duration;
- a device-level summary and the full StatusNotification timeline.

Nothing is uploaded to a server — parsing and charting happen entirely in your browser,
so the page also works offline once loaded. It's responsive down to phone screens.

## Expected CSV format

Columns: `TIMESTAMP, DEVICE ID, SOURCE, TYPE, ACTION, MESSAGE`, where `MESSAGE` is the
raw OCPP-J frame, e.g. `[2,"<uid>","MeterValues",{...}]` (CALL) or `[3,"<uid>",{...}]`
(CALLRESULT).

## Run locally

```bash
npm install
npm run dev      # http://localhost:5173
```

## Build

```bash
npm run build    # outputs static site to dist/
npm run preview  # serve the built site locally
```

## Deploy to Netlify

**Option A — drag & drop (fastest):**
1. Run `npm run build`.
2. Go to https://app.netlify.com/drop and drag the `dist/` folder onto the page.
   Netlify gives you a live URL immediately.

**Option B — connect a Git repo (auto-deploy on push):**
1. Push this folder to a GitHub/GitLab repo.
2. In Netlify: *Add new site → Import an existing project* and pick the repo.
3. Netlify reads `netlify.toml` automatically:
   - build command: `npm run build`
   - publish directory: `dist`
4. Deploy. Every push redeploys.

**Option C — Netlify CLI:**
```bash
npm install -g netlify-cli
netlify deploy --build --prod
```

## Project layout

```
index.html          entry point + upload UI
src/parser.js       OCPP frame decoding + analytics (no DOM)
src/charts.js       Plotly figure builder
src/main.js         file upload + DOM rendering
src/style.css       styles
netlify.toml        Netlify build config
vite.config.js      Vite config (base: './')
```
