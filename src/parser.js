// OCPP 1.6J parsing + analytics — browser port of ocpp_parser.py
// Pure functions, no DOM. Input: array of row objects from PapaParse.

// Only actions that actually CHANGE configuration are marked on charts.
// Read-only actions (GetConfiguration, GetLocalListVersion, ...) are ignored.
export const CONFIG_CHANGE = new Set([
  'ChangeConfiguration', 'ChangeAvailability', 'SetChargingProfile',
  'ClearChargingProfile', 'SendLocalList',
]);

export const FAULT_STATUS = 'Faulted';

export const SERIES_COLOR = {
  voltage: '#3b82f6', current: '#22c55e', power: '#f59e0b',
  energy: '#a855f7', soc: '#06b6d4', temperature: '#ef4444', frequency: '#8b5cf6',
};

export const STATUS_COLOR = {
  Faulted: '#ef4444', Available: '#22c55e', Charging: '#3b82f6',
  Preparing: '#f59e0b', SuspendedEV: '#a855f7', SuspendedEVSE: '#8b5cf6',
  Finishing: '#06b6d4', Unavailable: '#94a3b8', Reserved: '#0ea5e9',
};

// ---- frame helpers ------------------------------------------------------
export function parseTs(s) {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function decodeFrame(message) {
  let frame;
  try { frame = JSON.parse(message); } catch { return { mtid: null, uid: null, action: null, payload: null }; }
  if (!Array.isArray(frame) || frame.length === 0) return { mtid: null, uid: null, action: null, payload: null };
  const mtid = frame[0];
  const uid = frame.length > 1 ? String(frame[1]) : null;
  if (mtid === 2 && frame.length >= 4) {
    return { mtid: 2, uid, action: frame[2], payload: typeof frame[3] === 'object' && frame[3] ? frame[3] : {} };
  }
  if (mtid === 3 && frame.length >= 3) {
    return { mtid: 3, uid, action: null, payload: typeof frame[2] === 'object' && frame[2] ? frame[2] : {} };
  }
  return { mtid, uid, action: null, payload: {} };
}

function buildConfigDetail(action, payload) {
  if (action === 'ChangeConfiguration') {
    return payload.key != null ? `${payload.key}: ${payload.value ?? ''}` : null;
  }
  if (action === 'ChangeAvailability') {
    return `conn ${payload.connectorId} → ${payload.type}`;
  }
  if (action === 'SetChargingProfile') {
    return `conn ${payload.connectorId}`;
  }
  if (action === 'ClearChargingProfile') {
    return payload.id != null ? `profile id: ${payload.id}` : null;
  }
  if (action === 'SendLocalList') {
    return `${payload.updateType} (v${payload.listVersion})`;
  }
  return null;
}

function measurandKey(sv) {
  const m = sv.measurand || 'Energy.Active.Import.Register';
  return sv.phase ? `${m} (${sv.phase})` : m;
}

export function shortLabel(key) {
  const base = key.split(' (')[0];
  const nice = {
    'Voltage': 'Voltage',
    'Current.Import': 'Current',
    'Power.Active.Import': 'Power',
    'Energy.Active.Import.Register': 'Energy',
    'SoC': 'State of Charge',
    'Temperature': 'Temperature',
    'Frequency': 'Frequency',
  };
  let label = nice[base] || base;
  if (key.includes(' (')) label += ' ' + key.slice(key.indexOf(' ('));
  return label;
}

export function seriesColor(key) {
  const low = key.toLowerCase();
  for (const [k, c] of Object.entries(SERIES_COLOR)) if (low.includes(k)) return c;
  return '#64748b';
}

// ---- main parse ---------------------------------------------------------
export function parseRows(rows) {
  const deviceIds = new Set();
  const transactions = new Map(); // key -> tx object (insertion-ordered)
  const statusChanges = [];
  const lastStatus = new Map();   // connectorId -> "status|err"
  const configEvents = [];
  const pendingConfig = new Map(); // uid -> configEvent ref (for CALLRESULT correlation)
  const boots = [];
  let heartbeats = 0;
  const counts = {};
  let pendingStart = null;

  const ensureTx = (key, seed) => {
    if (!transactions.has(key)) {
      transactions.set(key, {
        txid: seed.txid ?? null, connector: seed.connector ?? null,
        series: new Map(), first: null, last: null,
        start: null, stop: null, meterStart: null, meterStop: null, idTag: null,
      });
    }
    return transactions.get(key);
  };

  for (const row of rows) {
    const ts = parseTs(row['TIMESTAMP']);
    const dev = row['DEVICE ID'];
    if (dev) deviceIds.add(dev);
    const action = row['ACTION'];
    const typ = row['TYPE'];
    const src = row['SOURCE'];
    counts[action] = (counts[action] || 0) + 1;
    const { mtid, uid, payload } = decodeFrame(row['MESSAGE'] || '');
    if (payload == null) continue;

    if (action === 'MeterValues' && mtid === 2) {
      const txid = payload.transactionId;
      const conn = payload.connectorId;
      const key = (txid !== undefined && txid !== null) ? txid : `no-tx@conn${conn}`;
      const tx = ensureTx(key, { txid: txid ?? null, connector: conn });
      if (tx.connector == null) tx.connector = conn;
      for (const mv of payload.meterValue || []) {
        const mvTs = parseTs(mv.timestamp) || ts;
        if (!mvTs) continue;
        if (!tx.first || mvTs < tx.first) tx.first = mvTs;
        if (!tx.last || mvTs > tx.last) tx.last = mvTs;
        for (const sv of mv.sampledValue || []) {
          const val = parseFloat(sv.value);
          if (Number.isNaN(val)) continue;
          const mk = measurandKey(sv);
          if (!tx.series.has(mk)) tx.series.set(mk, []);
          tx.series.get(mk).push([mvTs, val, sv.unit || '']);
        }
      }
    } else if (action === 'StartTransaction') {
      if (mtid === 2) {
        pendingStart = {
          ts: parseTs(payload.timestamp) || ts,
          connector: payload.connectorId,
          meterStart: payload.meterStart,
          idTag: payload.idTag,
        };
      } else if (mtid === 3) {
        const txid = payload.transactionId;
        if (txid != null && pendingStart) {
          const tx = ensureTx(txid, { txid, connector: pendingStart.connector });
          tx.start = pendingStart.ts;
          tx.connector = pendingStart.connector;
          tx.meterStart = pendingStart.meterStart;
          tx.idTag = pendingStart.idTag;
          pendingStart = null;
        }
      }
    } else if (action === 'StopTransaction' && mtid === 2) {
      const txid = payload.transactionId;
      if (transactions.has(txid)) {
        const tx = transactions.get(txid);
        tx.stop = parseTs(payload.timestamp) || ts;
        tx.meterStop = payload.meterStop;
      }
    } else if (action === 'StatusNotification' && mtid === 2) {
      const conn = payload.connectorId;
      const status = payload.status ?? null;
      const err = payload.errorCode ?? null;
      const evTs = parseTs(payload.timestamp) || ts;
      const sig = `${status}|${err}`;
      const prevSig = lastStatus.get(conn);
      if (prevSig !== sig) {
        statusChanges.push({
          ts: evTs, connector: conn, status, errorCode: err,
          info: payload.info || '',
          prev: prevSig ? prevSig.split('|')[0] : null,
        });
        lastStatus.set(conn, sig);
      }
    } else if (CONFIG_CHANGE.has(action)) {
      if (mtid === 2) {
        const ev = { ts, action, kind: 'change', source: src, detail: buildConfigDetail(action, payload), result: null };
        configEvents.push(ev);
        if (uid) pendingConfig.set(uid, ev);
      } else if (mtid === 3 && uid && pendingConfig.has(uid)) {
        pendingConfig.get(uid).result = payload.status ?? null;
        pendingConfig.delete(uid);
      }
    } else if (action === 'BootNotification' && mtid === 2) {
      boots.push({
        ts, fw: payload.firmwareVersion, model: payload.chargePointModel,
        vendor: payload.chargePointVendor,
      });
    } else if (action === 'Heartbeat' && mtid === 2) {
      heartbeats += 1;
    }
  }

  for (const tx of transactions.values()) {
    for (const arr of tx.series.values()) arr.sort((a, b) => a[0] - b[0]);
  }

  const span0 = rows.length ? parseTs(rows[0]['TIMESTAMP']) : null;
  const span1 = rows.length ? parseTs(rows[rows.length - 1]['TIMESTAMP']) : null;

  return {
    deviceIds, transactions, statusChanges, configEvents,
    boots, heartbeats, counts, rowCount: rows.length, span: [span0, span1],
  };
}

// ---- analytics ----------------------------------------------------------
export function txWindow(tx) {
  return [tx.start || tx.first, tx.stop || tx.last];
}

export function faultsDuringTx(tx, statusChanges) {
  const [start, stop] = txWindow(tx);
  if (!start || !stop) return { episodes: 0, total: 0, details: [] };
  const conn = tx.connector;
  let episodes = 0, total = 0;
  const details = [];
  for (const sc of statusChanges) {
    if (!sc.ts || sc.ts < start || sc.ts > stop) continue;
    if (sc.connector !== conn && sc.connector !== 0) continue;
    if (sc.status === FAULT_STATUS) {
      total += 1;
      if (sc.prev !== FAULT_STATUS) { episodes += 1; details.push(sc); }
    }
  }
  return { episodes, total, details };
}

export function seriesStats(tx) {
  const out = {};
  for (const [key, pts] of tx.series.entries()) {
    if (!pts.length) continue;
    const vals = pts.map((p) => p[1]);
    out[key] = {
      min: Math.min(...vals), max: Math.max(...vals),
      first: pts[0][1], last: pts[pts.length - 1][1],
      unit: pts[0][2], n: vals.length,
    };
  }
  return out;
}

export function fmtDur(start, stop) {
  if (!start || !stop) return '—';
  let secs = Math.floor((stop - start) / 1000);
  const h = Math.floor(secs / 3600); secs -= h * 3600;
  const m = Math.floor(secs / 60); const s = secs - m * 60;
  return `${h}h ${m}m ${s}s`;
}

export function findSeriesKey(stats, ...needles) {
  for (const key of Object.keys(stats)) {
    const low = key.toLowerCase();
    if (needles.every((n) => low.includes(n))) return key;
  }
  return null;
}

export function globalExtremes(transactions) {
  const g = {};
  for (const tx of transactions.values()) {
    if (!tx.series.size) continue;
    const stats = seriesStats(tx);
    for (const [key, st] of Object.entries(stats)) {
      const base = shortLabel(key).split(' (')[0];
      if (!g[base]) g[base] = { min: null, max: null, unit: '' };
      g[base].unit = st.unit;
      g[base].min = g[base].min == null ? st.min : Math.min(g[base].min, st.min);
      g[base].max = g[base].max == null ? st.max : Math.max(g[base].max, st.max);
    }
  }
  return g;
}
