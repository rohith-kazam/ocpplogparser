// Chart building with ApexCharts.
import ApexCharts from 'apexcharts';
import { shortLabel, seriesColor, STATUS_COLOR } from './parser.js';
import { chartToPdf } from './export.js';

const CONFIG_COLOR = '#0ea5e9';
const ms = (d) => (d instanceof Date ? d.getTime() : d);
const hms = (t) => new Date(t).toISOString().slice(11, 19); // UTC HH:MM:SS

function nearestY(pts, ts) {
  if (!pts.length) return null;
  let best = pts[0], bestDiff = Math.abs(ms(pts[0][0]) - ts);
  for (const p of pts) {
    const d = Math.abs(ms(p[0]) - ts);
    if (d < bestDiff) { best = p; bestDiff = d; }
  }
  return best[1];
}

const inWindow = (t, start, stop) => !(start && stop) || (t >= start && t <= stop);

// Render one measurand chart into `el`.
export function renderChart(el, key, pts, statusChanges, configEvents, windowRange) {
  const label = shortLabel(key);
  const unit = pts.length ? pts[0][2] : '';
  const color = seriesColor(key);
  const start = windowRange[0] ? ms(windowRange[0]) : null;
  const stop = windowRange[1] ? ms(windowRange[1]) : null;

  const series = [{
    name: label, type: 'line',
    data: pts.map((p) => ({ x: ms(p[0]), y: p[1] })),
  }];
  const colors = [color];
  const markerSizes = [3];
  const markerShapes = ['circle'];
  const annotations = [];

  // status changes → one scatter series per distinct status (so each gets its color)
  const byStatus = new Map();
  for (const sc of statusChanges) {
    const t = ms(sc.ts);
    if (!t || !inWindow(t, start, stop)) continue;
    const y = nearestY(pts, t);
    if (y == null) continue;
    const scol = STATUS_COLOR[sc.status] || '#64748b';
    if (!byStatus.has(sc.status)) byStatus.set(sc.status, { color: scol, data: [] });
    byStatus.get(sc.status).data.push({
      x: t, y,
      meta: `<b>${sc.status} / ${sc.errorCode}</b><br>conn ${sc.connector}` +
        (sc.info ? `<br>${sc.info}` : ''),
    });
    annotations.push({ x: t, borderColor: scol, strokeDashArray: 2, opacity: 0.35 });
  }
  for (const [status, s] of byStatus) {
    series.push({ name: status, type: 'scatter', data: s.data });
    colors.push(s.color);
    markerSizes.push(7);
    markerShapes.push('circle');
  }

  // configuration changes → one scatter series (squares)
  const cfg = [];
  for (const ce of configEvents) {
    const t = ms(ce.ts);
    if (!t || !inWindow(t, start, stop)) continue;
    const y = nearestY(pts, t);
    if (y == null) continue;
    cfg.push({ x: t, y, meta: `<b>Config change</b><br>${ce.action} (${ce.kind})` });
    annotations.push({ x: t, borderColor: CONFIG_COLOR, strokeDashArray: 6, opacity: 0.3 });
  }
  if (cfg.length) {
    series.push({ name: 'Config change', type: 'scatter', data: cfg });
    colors.push(CONFIG_COLOR);
    markerSizes.push(8);
    markerShapes.push('square');
  }

  const options = {
    chart: {
      type: 'line', height: 360, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      background: 'transparent', parentHeightOffset: 0,
      toolbar: {
        offsetY: -4, autoSelected: 'pan',
        tools: {
          download: true, selection: false, pan: true, zoom: true, zoomin: true, zoomout: true, reset: true,
          customIcons: [{
            icon: '<span style="font:600 10px/24px var(--sans,sans-serif);color:#64748b;padding:0 2px">PDF</span>',
            title: 'Download this chart as PDF', index: -1,
            click: (c) => chartToPdf(c, `${label}${unit ? ` (${unit})` : ''}`),
          }],
        },
      },
      zoom: { enabled: true, type: 'x', autoScaleYaxis: false },
      animations: { enabled: false },
    },
    series, colors,
    stroke: { width: series.map((s) => (s.type === 'line' ? 2 : 0)), curve: 'straight' },
    markers: { size: markerSizes, shape: markerShapes, strokeColors: '#fff', strokeWidth: 1, hover: { sizeOffset: 2 } },
    title: { text: `${label}${unit ? `  (${unit})` : ''}`, offsetX: 4, offsetY: 2, style: { fontSize: '14px', fontWeight: 700, color: '#0f1b2d' } },
    legend: { show: false },
    grid: { borderColor: 'rgba(15,27,45,0.08)', strokeDashArray: 0, padding: { left: 8, right: 12, top: 0, bottom: 0 } },
    xaxis: {
      type: 'datetime', ...(start && stop ? { min: start, max: stop } : {}),
      labels: { datetimeUTC: true, style: { colors: '#64748b', fontSize: '10px' }, format: 'HH:mm:ss' },
      axisBorder: { color: 'rgba(15,27,45,0.12)' }, axisTicks: { color: 'rgba(15,27,45,0.12)' },
    },
    yaxis: {
      title: { text: unit, style: { color: '#64748b', fontSize: '10px', fontWeight: 400 } },
      labels: { style: { colors: '#64748b', fontSize: '10px' }, formatter: (v) => (v == null ? '' : v.toFixed(2)) },
    },
    annotations: { xaxis: annotations },
    tooltip: {
      custom: ({ seriesIndex, dataPointIndex, w }) => {
        const p = w.config.series[seriesIndex]?.data?.[dataPointIndex];
        const inner = p?.meta
          ? p.meta
          : `${hms(p?.x)}<br>${p?.y != null ? p.y.toFixed(2) : ''} ${unit}`;
        return `<div class="apex-tip">${inner}</div>`;
      },
    },
  };

  const chart = new ApexCharts(el, options);
  chart.render();
  // double-click resets zoom (ApexCharts only offers a toolbar reset otherwise)
  if (start && stop) el.addEventListener('dblclick', () => chart.zoomX(start, stop));
  return chart;
}
