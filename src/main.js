import Papa from 'papaparse';
import {
  parseRows, txWindow, faultsDuringTx, seriesStats, fmtDur,
  findSeriesKey, globalExtremes, shortLabel, FAULT_STATUS,
} from './parser.js';
import { renderChart } from './charts.js';

const $ = (sel) => document.querySelector(sel);
const el = (tag, cls, html) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html != null) n.innerHTML = html;
  return n;
};
const esc = (s) => (s == null ? '' : String(s))
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const fmtTime = (d) => d
  ? d.toISOString().slice(0, 19).replace('T', ' ')
  : '';
const fmtShort = (d) => d
  ? d.toISOString().slice(5, 16).replace('T', ' ')
  : '';

function card(label, value, sub = '', accent = '') {
  const c = el('div', 'card');
  c.appendChild(el('div', 'card-label', esc(label)));
  const v = el('div', 'card-value', esc(value));
  if (accent) v.style.color = accent;
  c.appendChild(v);
  c.appendChild(el('div', 'card-sub', esc(sub)));
  return c;
}

function buildReport(data) {
  const out = $('#report');
  out.innerHTML = '';

  const { transactions, statusChanges, configEvents, span } = data;
  const device = [...data.deviceIds].sort().join(', ') || 'unknown';
  const realTxs = [...transactions.entries()].filter(([, t]) => t.series.size);

  const faultEpisodes = statusChanges.filter(
    (s) => s.status === FAULT_STATUS && s.prev !== FAULT_STATUS).length;
  const faultNotifs = statusChanges.filter((s) => s.status === FAULT_STATUS).length;
  const errorCodes = [...new Set(statusChanges
    .map((s) => s.errorCode)
    .filter((e) => e && e !== 'NoError'))].sort();
  const g = globalExtremes(transactions);
  const boot = data.boots[0] || {};

  // ---- header strip ----
  const head = el('div', 'report-head');
  head.appendChild(el('div', 'rh-title',
    `Device <b>${esc(device)}</b>` +
    (boot.model ? ` · ${esc(boot.model)}` : '') +
    (boot.fw ? ` · FW ${esc(boot.fw)}` : '')));
  head.appendChild(el('div', 'rh-sub',
    (span[0] && span[1]
      ? `${esc(fmtTime(span[0]))} → ${esc(span[1].toISOString().slice(11, 16))} UTC`
      : '') +
    ` · ${data.rowCount} frames`));
  out.appendChild(head);

  // ---- device summary ----
  out.appendChild(el('h2', null, 'Device summary'));
  const devCards = el('div', 'cards');
  devCards.appendChild(card('Transactions', realTxs.length));
  devCards.appendChild(card('Fault episodes', faultEpisodes,
    `${faultNotifs} notifications`, faultEpisodes ? '#ef4444' : '#22c55e'));
  devCards.appendChild(card('Error codes', errorCodes.join(', ') || 'None', '',
    errorCodes.length ? '#ef4444' : '#22c55e'));
  devCards.appendChild(card('Status changes', statusChanges.length));
  devCards.appendChild(card('Config changes', configEvents.length));
  devCards.appendChild(card('Boots / Heartbeats', `${data.boots.length} / ${data.heartbeats}`));
  for (const base of ['Voltage', 'Current', 'Power']) {
    if (g[base] && g[base].max != null) {
      devCards.appendChild(card(`${base} range`,
        `${g[base].min.toFixed(2)} – ${g[base].max.toFixed(2)} ${g[base].unit}`,
        'across all transactions'));
    }
  }
  out.appendChild(devCards);

  // ---- per-transaction sections ----
  const chartJobs = [];
  let txIndex = 0;
  for (const [key, tx] of realTxs) {
    txIndex += 1;
    const [start, stop] = txWindow(tx);
    const stats = seriesStats(tx);
    const { episodes, total } = faultsDuringTx(tx, statusChanges);

    const vkey = findSeriesKey(stats, 'voltage');
    const ikey = findSeriesKey(stats, 'current');
    const pkey = findSeriesKey(stats, 'power');
    const ekey = findSeriesKey(stats, 'energy');

    let energyDelivered = '';
    if (ekey) {
      const d = stats[ekey].last - stats[ekey].first;
      energyDelivered = stats[ekey].unit === 'Wh'
        ? `${(d / 1000).toFixed(3)} kWh` : `${d.toFixed(2)} ${stats[ekey].unit}`;
    }

    const section = el('section', 'tx');
    const h = el('h2', 'tx-h');
    h.innerHTML = `Transaction ${esc(tx.txid != null ? tx.txid : key)}` +
      `<span class="conn">connector ${esc(tx.connector)}</span>`;
    section.appendChild(h);

    const cards = el('div', 'cards');
    cards.appendChild(card('Mid-transaction faults', episodes,
      `${total} fault notifications`, episodes ? '#ef4444' : '#22c55e'));
    cards.appendChild(card('Duration', fmtDur(start, stop),
      (start ? fmtShort(start) : '') + (stop ? ' → ' + stop.toISOString().slice(11, 16) : '')));
    if (vkey) cards.appendChild(card('Peak voltage', `${stats[vkey].max.toFixed(2)} V`,
      `min ${stats[vkey].min.toFixed(2)} V`, '#3b82f6'));
    if (ikey) cards.appendChild(card('Max current', `${stats[ikey].max.toFixed(2)} A`,
      `min ${stats[ikey].min.toFixed(2)} A`, '#22c55e'));
    if (pkey) cards.appendChild(card('Max power', `${stats[pkey].max.toFixed(0)} W`,
      `min ${stats[pkey].min.toFixed(0)} W`, '#f59e0b'));
    if (ekey) cards.appendChild(card('Energy delivered', energyDelivered,
      `${stats[ekey].first.toFixed(0)} → ${stats[ekey].last.toFixed(0)} ${stats[ekey].unit}`, '#a855f7'));
    section.appendChild(cards);

    const order = [vkey, ikey, pkey, ekey].filter(Boolean);
    for (const k of Object.keys(stats)) if (!order.includes(k)) order.push(k);

    const charts = el('div', 'charts');
    for (const k of order) {
      const chartDiv = el('div', 'chart');
      chartDiv.dataset.txid = String(key);
      charts.appendChild(chartDiv);
      chartJobs.push(() => renderChart(chartDiv, k, tx.series.get(k),
        statusChanges, configEvents, [start, stop]));
    }
    section.appendChild(charts);
    out.appendChild(section);
  }

  // ---- status timeline ----
  const realChanges = statusChanges.filter((s) => s.status);
  const details = el('details');
  details.open = false;
  details.appendChild(el('summary', null,
    `StatusNotification timeline (${realChanges.length} changes)`));
  const scroll = el('div', 'scroll');
  const rows = realChanges.map((sc) => {
    const fault = sc.status === FAULT_STATUS || (sc.errorCode && sc.errorCode !== 'NoError');
    return `<tr class="${fault ? 'fault' : ''}"><td>${esc(fmtTime(sc.ts))}</td>` +
      `<td>${esc(sc.connector)}</td><td>${esc(sc.status)}</td>` +
      `<td>${esc(sc.errorCode)}</td><td>${esc(sc.info)}</td></tr>`;
  }).join('');
  scroll.innerHTML = '<table><thead><tr><th>Time (UTC)</th><th>Conn</th>' +
    '<th>Status</th><th>Error</th><th>Info</th></tr></thead><tbody>' + rows + '</tbody></table>';
  details.appendChild(scroll);
  out.appendChild(details);

  // render charts after layout settles (Plotly needs sized containers)
  requestAnimationFrame(() => chartJobs.forEach((job) => job()));
}

// ---- file handling ------------------------------------------------------
function handleFile(file) {
  $('#status').textContent = `Parsing ${file.name} …`;
  $('#dropzone').classList.add('busy');
  Papa.parse(file, {
    header: true,
    skipEmptyLines: true,
    worker: false,
    complete: (res) => {
      try {
        const required = ['TIMESTAMP', 'ACTION', 'MESSAGE'];
        const fields = res.meta.fields || [];
        const missing = required.filter((c) => !fields.includes(c));
        if (missing.length) {
          throw new Error(`CSV is missing column(s): ${missing.join(', ')}. ` +
            `Expected an OCPP log export with TIMESTAMP, DEVICE ID, SOURCE, TYPE, ACTION, MESSAGE.`);
        }
        const data = parseRows(res.data);
        if (!data.transactions.size) {
          $('#status').innerHTML =
            '<span class="warn">No MeterValues / transactions found in this log.</span>';
        } else {
          $('#status').textContent =
            `${file.name} — ${data.rowCount} frames, ${[...data.transactions.values()]
              .filter((t) => t.series.size).length} transaction(s).`;
        }
        document.body.classList.add('has-report');
        buildReport(data);
      } catch (err) {
        $('#status').innerHTML = `<span class="warn">${esc(err.message)}</span>`;
      } finally {
        $('#dropzone').classList.remove('busy');
      }
    },
    error: (err) => {
      $('#status').innerHTML = `<span class="warn">Could not read file: ${esc(err.message)}</span>`;
      $('#dropzone').classList.remove('busy');
    },
  });
}

function init() {
  const dz = $('#dropzone');
  const input = $('#fileInput');

  $('#pick').addEventListener('click', () => input.click());
  input.addEventListener('change', (e) => {
    if (e.target.files[0]) handleFile(e.target.files[0]);
  });

  ['dragenter', 'dragover'].forEach((ev) =>
    dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach((ev) =>
    dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('drag'); }));
  dz.addEventListener('drop', (e) => {
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  });

  $('#export-pdf').addEventListener('click', () => window.print());

  $('#reset').addEventListener('click', () => {
    document.body.classList.remove('has-report');
    $('#report').innerHTML = '';
    $('#status').textContent = '';
    input.value = '';
  });
}

document.addEventListener('DOMContentLoaded', init);
