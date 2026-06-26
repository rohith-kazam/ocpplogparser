// Chart building with Plotly — port of build_figure() from ocpp_parser.py
import Plotly from 'plotly.js-dist-min';
import { shortLabel, seriesColor, STATUS_COLOR } from './parser.js';

// Guard against recursive hover events (Plotly.Fx.hover fires plotly_hover synchronously).
let _syncHover = false;

function nearestY(pts, ts) {
  if (!pts.length) return null;
  let best = pts[0], bestDiff = Math.abs(pts[0][0] - ts);
  for (const p of pts) {
    const d = Math.abs(p[0] - ts);
    if (d < bestDiff) { best = p; bestDiff = d; }
  }
  return best[1];
}

// Render one measurand chart into `el`.
export function renderChart(el, key, pts, statusChanges, configEvents, windowRange) {
  const label = shortLabel(key);
  const unit = pts.length ? pts[0][2] : '';
  const color = seriesColor(key);
  const [start, stop] = windowRange;

  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);

  const traces = [{
    x: xs, y: ys, mode: 'lines+markers', name: label,
    line: { color, width: 2 }, marker: { size: 3 },
    hovertemplate: `<b>${label}</b>: %{y:.2f} ${unit}<br>%{x|%H:%M:%S}<extra></extra>`,
  }];

  const shapes = [];

  // status-change markers
  const sx = [], sy = [], stext = [], scolors = [];
  for (const sc of statusChanges) {
    const ts = sc.ts;
    if (!ts || (start && stop && (ts < start || ts > stop))) continue;
    const y = nearestY(pts, ts);
    if (y == null) continue;
    sx.push(ts); sy.push(y);
    scolors.push(STATUS_COLOR[sc.status] || '#475569');
    const errSuffix = sc.errorCode && sc.errorCode !== 'NoError' ? ` (${sc.errorCode})` : '';
    const prevPart = sc.prev ? `<br><i>was: ${sc.prev}</i>` : '';
    stext.push(`<b>${sc.status}${errSuffix}</b><br>conn ${sc.connector}${prevPart}` +
      (sc.info ? `<br>${sc.info}` : ''));
    shapes.push({
      type: 'line', xref: 'x', yref: 'paper', x0: ts, x1: ts, y0: 0, y1: 1,
      line: { color: STATUS_COLOR[sc.status] || '#94a3b8', width: 1, dash: 'dot' },
      opacity: 0.35,
    });
  }
  if (sx.length) {
    traces.push({
      x: sx, y: sy, mode: 'markers', name: 'Status change',
      marker: { symbol: 'diamond', size: 11, color: scolors, line: { width: 1, color: '#0f172a' } },
      text: stext,
      hovertemplate: '<b>Status change</b><br>%{text}<br>%{x|%H:%M:%S}<extra>Status</extra>',
    });
  }

  // configuration-change markers
  const cx = [], cy = [], ctext = [];
  for (const ce of configEvents) {
    const ts = ce.ts;
    if (!ts || (start && stop && (ts < start || ts > stop))) continue;
    const y = nearestY(pts, ts);
    if (y == null) continue;
    cx.push(ts); cy.push(y);
    let ctip = `<b>${ce.action}</b>`;
    if (ce.detail) ctip += `<br>${ce.detail}`;
    if (ce.result) ctip += `<br><i>${ce.result}</i>`;
    ctext.push(ctip);
    shapes.push({
      type: 'line', xref: 'x', yref: 'paper', x0: ts, x1: ts, y0: 0, y1: 1,
      line: { color: '#0ea5e9', width: 1, dash: 'dash' }, opacity: 0.3,
    });
  }
  if (cx.length) {
    traces.push({
      x: cx, y: cy, mode: 'markers', name: 'Config change',
      marker: { symbol: 'square', size: 10, color: '#0ea5e9', line: { width: 1, color: '#0369a1' } },
      text: ctext,
      hovertemplate: '%{text}<br>%{x|%H:%M:%S}<extra>Config</extra>',
    });
  }

  const layout = {
    title: { text: `${label}${unit ? `  (${unit})` : ''}`, font: { size: 15, color: '#e2e8f0' } },
    margin: { l: 44, r: 12, t: 40, b: 30 },
    height: 340,
    shapes,
    legend: { orientation: 'h', yanchor: 'bottom', y: 1.02, xanchor: 'left', x: 0, font: { size: 10, color: '#94a3b8' } },
    hovermode: 'closest',
    hoverdistance: 40,
    hoverlabel: {
      bgcolor: 'rgba(15,23,42,0.93)',
      bordercolor: 'rgba(148,163,184,0.35)',
      font: { family: 'ui-monospace, SFMono-Regular, Menlo, monospace', size: 11, color: '#e2e8f0' },
    },
    plot_bgcolor: 'rgba(0,0,0,0)', paper_bgcolor: 'rgba(0,0,0,0)',
    font: { family: 'ui-monospace, SFMono-Regular, Menlo, monospace', size: 11, color: '#94a3b8' },
    xaxis: {
      showgrid: true, gridcolor: 'rgba(148,163,184,0.12)', zeroline: false,
      showspikes: true, spikemode: 'across', spikecolor: 'rgba(148,163,184,0.3)',
      spikethickness: 1, spikedash: 'dot', spikesnap: 'cursor',
    },
    yaxis: {
      title: { text: unit, font: { size: 10 } },
      showgrid: true, gridcolor: 'rgba(148,163,184,0.12)', zeroline: false,
      showspikes: true, spikemode: 'across', spikecolor: 'rgba(148,163,184,0.15)',
      spikethickness: 1, spikedash: 'dot',
    },
  };

  Plotly.newPlot(el, traces, layout, { responsive: true, displaylogo: false, displayModeBar: 'hover' });

  // Sync hover across all sibling charts in the same transaction.
  el.on('plotly_hover', function(eventData) {
    if (_syncHover || !eventData.points || !eventData.points.length) return;
    const xTs = new Date(eventData.points[0].x).getTime();
    _syncHover = true;
    const siblings = el.parentElement ? Array.from(el.parentElement.children) : [];
    for (const sib of siblings) {
      if (sib === el || !sib.data || !sib.data[0] || !sib.data[0].x.length) continue;
      if (sib.dataset.txid !== el.dataset.txid) continue;
      const sibXs = sib.data[0].x;
      let best = 0, bestDiff = Infinity;
      for (let i = 0; i < sibXs.length; i++) {
        const d = Math.abs(new Date(sibXs[i]).getTime() - xTs);
        if (d < bestDiff) { bestDiff = d; best = i; }
      }
      Plotly.Fx.hover(sib, [{ curveNumber: 0, pointNumber: best }]);
    }
    _syncHover = false;
  });

  el.on('plotly_unhover', function() {
    if (_syncHover) return;
    _syncHover = true;
    const siblings = el.parentElement ? Array.from(el.parentElement.children) : [];
    for (const sib of siblings) {
      if (sib === el || !sib.data) continue;
      if (sib.dataset.txid !== el.dataset.txid) continue;
      Plotly.Fx.hover(sib, []);
    }
    _syncHover = false;
  });

  // Sync zoom/pan/reset across all sibling charts in the same transaction.
  // Plotly.relayout is async, so we stamp each target element before calling it
  // and clear in the Promise — a module-level boolean would reset too early.
  el.on('plotly_relayout', function(eventData) {
    if (el._zoomBusy) return;
    const x0 = eventData['xaxis.range[0]'];
    const x1 = eventData['xaxis.range[1]'];
    const autorange = eventData['xaxis.autorange'];
    if (x0 === undefined && x1 === undefined && !autorange) return;
    const update = autorange
      ? { 'xaxis.autorange': true }
      : { 'xaxis.range[0]': x0, 'xaxis.range[1]': x1 };
    const siblings = el.parentElement ? Array.from(el.parentElement.children) : [];
    for (const sib of siblings) {
      if (sib === el || !sib.data) continue;
      if (sib.dataset.txid !== el.dataset.txid) continue;
      sib._zoomBusy = true;
      Plotly.relayout(sib, update).then(() => { sib._zoomBusy = false; });
    }
  });
}
