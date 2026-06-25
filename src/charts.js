// Chart building with Plotly — port of build_figure() from ocpp_parser.py
import Plotly from 'plotly.js-dist-min';
import { shortLabel, seriesColor, STATUS_COLOR } from './parser.js';

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
    hovertemplate: `%{x|%H:%M:%S}<br>%{y:.2f} ${unit}<extra></extra>`,
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
    stext.push(`${sc.status} / ${sc.errorCode}<br>conn ${sc.connector}` +
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
      hovertemplate: '<b>Status change</b><br>%{text}<br>%{x|%H:%M:%S}<extra></extra>',
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
    ctext.push(`${ce.action} (${ce.kind})`);
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
      hovertemplate: '<b>Config change</b><br>%{text}<br>%{x|%H:%M:%S}<extra></extra>',
    });
  }

  const layout = {
    title: { text: `${label}${unit ? `  (${unit})` : ''}`, font: { size: 15, color: '#e2e8f0' } },
    margin: { l: 44, r: 12, t: 40, b: 30 },
    height: 340,
    shapes,
    legend: { orientation: 'h', yanchor: 'bottom', y: 1.02, xanchor: 'left', x: 0, font: { size: 10, color: '#94a3b8' } },
    hovermode: 'closest',
    plot_bgcolor: 'rgba(0,0,0,0)', paper_bgcolor: 'rgba(0,0,0,0)',
    font: { family: 'ui-monospace, SFMono-Regular, Menlo, monospace', size: 11, color: '#94a3b8' },
    xaxis: { showgrid: true, gridcolor: 'rgba(148,163,184,0.12)', zeroline: false },
    yaxis: { title: { text: unit, font: { size: 10 } }, showgrid: true, gridcolor: 'rgba(148,163,184,0.12)', zeroline: false },
  };

  Plotly.newPlot(el, traces, layout, { responsive: true, displaylogo: false, displayModeBar: 'hover' });
}
