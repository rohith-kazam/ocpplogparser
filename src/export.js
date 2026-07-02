// PDF export — one chart, or the whole report. Built directly with jsPDF
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import logoUrl from './assets/kazam-logo.png';

let logoPromise;
function loadLogo() {
  if (!logoPromise) {
    logoPromise = new Promise((res) => {
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = () => res(null);
      im.src = logoUrl;
    });
  }
  return logoPromise;
}

const safe = (s) => String(s || 'ocpp').replace(/[^\w.-]+/g, '_');

function imgSize(dataURI) {
  return new Promise((res) => {
    const im = new Image();
    im.onload = () => res({ w: im.naturalWidth, h: im.naturalHeight });
    im.onerror = () => res({ w: 4, h: 3 });
    im.src = dataURI;
  });
}

// One ApexCharts chart → landscape PDF fit to page width.
export async function chartToPdf(chart, title) {
  const filename = `${safe(title)}.pdf`;
  const { imgURI } = await chart.dataURI({ scale: 2 });
  const { w: iw, h: ih } = await imgSize(imgURI);
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  const m = 32;
  const drawW = pdf.internal.pageSize.getWidth() - m * 2;
  pdf.setFontSize(13);
  pdf.text(String(title), m, m);
  pdf.addImage(imgURI, 'PNG', m, m + 14, drawW, drawW * (ih / iw));
  pdf.save(filename);
}

// The whole report → paginated portrait PDF, assembled from a data model.
// model = { header:{device,model,fw,span,frames}, summary:[{label,value}],
//           txs:[{title, charts:[{chart}]}], timeline:[{cells:[], fault}] }
export async function reportToPdf(model) {
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const m = 40;
  const cw = pageW - m * 2;

  const INK = [17, 24, 39], MUTED = [107, 114, 128], LINE = [229, 231, 235], ACCENT = [17, 24, 39];
  let y = m;
  const ensure = (need) => { if (y + need > pageH - m) { pdf.addPage(); y = m; } };
  const heading = (text) => {
    ensure(26);
    pdf.setFont('helvetica', 'bold').setFontSize(11).setTextColor(...INK);
    pdf.text(text, m, y); y += 7;
    pdf.setDrawColor(...LINE).setLineWidth(0.5).line(m, y, m + cw, y); y += 15;
    pdf.setFont('helvetica', 'normal');
  };

  // ---- minimal header ----
  const h = model.header;
  pdf.setFont('helvetica', 'bold').setFontSize(20).setTextColor(...INK);
  pdf.text('OCPP Log Report', m, y + 6);
  const logo = await loadLogo();
  if (logo) {
    const logoH = 18, logoW = logoH * (logo.naturalWidth / logo.naturalHeight);
    pdf.addImage(logo, 'PNG', pageW - m - logoW, y - 8, logoW, logoH);
  } else {
    pdf.setFont('helvetica', 'normal').setFontSize(9).setTextColor(...MUTED);
    pdf.text('kazam', pageW - m, y + 6, { align: 'right' });
  }
  y += 18;
  pdf.setFontSize(9).setTextColor(...MUTED);
  pdf.text(`Device ${h.device}${h.model ? ` · ${h.model}` : ''}${h.fw ? ` · FW ${h.fw}` : ''}`, m, y); y += 12;
  if (h.span || h.frames != null) {
    pdf.text(`${h.span || ''}${h.span ? '  ·  ' : ''}${h.frames} frames`, m, y); y += 10;
  }
  // single accent hairline under the header
  pdf.setDrawColor(...ACCENT).setLineWidth(1).line(m, y, m + 44, y);
  pdf.setDrawColor(...LINE).setLineWidth(0.5).line(m + 44, y, m + cw, y);
  y += 22;

  // ---- device summary: borderless two-column key/value rows ----
  heading('Device summary');
  const gap = 24, colW = (cw - gap) / 2, rowH = 30;
  for (let i = 0; i < model.summary.length; i++) {
    const col = i % 2;
    if (col === 0) ensure(rowH);
    const x = m + col * (colW + gap);
    pdf.setFont('helvetica', 'normal').setFontSize(7).setTextColor(...MUTED);
    pdf.text(String(model.summary[i].label).toUpperCase(), x, y + 8);
    pdf.setFont('helvetica', 'bold').setFontSize(11.5).setTextColor(...INK);
    pdf.text(pdf.splitTextToSize(String(model.summary[i].value), colW)[0], x, y + 22);
    if (col === 1 || i === model.summary.length - 1) {
      pdf.setDrawColor(...LINE).setLineWidth(0.5).line(m, y + rowH - 4, m + cw, y + rowH - 4);
      y += rowH;
    }
  }
  y += 12;

  // ---- per-transaction charts ----
  for (const tx of model.txs) {
    heading(tx.title);
    for (const ci of tx.charts) {
      if (!ci.chart) continue;
      const { imgURI } = await ci.chart.dataURI({ scale: 2 });
      const { w, h: ih } = await imgSize(imgURI);
      const dh = cw * (ih / w);
      ensure(dh + 8);
      pdf.addImage(imgURI, 'PNG', m, y, cw, dh); y += dh + 8;
    }
    y += 6;
  }

  // ---- status timeline ----
  if (model.timeline.length) {
    heading(`StatusNotification timeline (${model.timeline.length})`);
    autoTable(pdf, {
      startY: y,
      head: [['Time (UTC)', 'Conn', 'Status', 'Error', 'Info']],
      body: model.timeline.map((r) => r.cells),
      margin: { left: m, right: m },
      theme: 'plain',
      styles: { fontSize: 8, cellPadding: 4, font: 'courier', textColor: INK, lineColor: LINE, lineWidth: { bottom: 0.5 } },
      headStyles: { fontStyle: 'bold', textColor: MUTED, lineColor: LINE, lineWidth: { bottom: 0.75 } },
      didParseCell: (d) => {
        if (d.section === 'body' && model.timeline[d.row.index]?.fault) {
          d.cell.styles.textColor = [185, 28, 28];
        }
      },
    });
  }

  // ---- footer on every page ----
  const pages = pdf.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    pdf.setPage(p);
    pdf.setFont('helvetica', 'normal').setFontSize(8).setTextColor(...MUTED);
    pdf.text('Generated client-side · times in UTC', m, pageH - 18);
    pdf.text(`${p} / ${pages}`, pageW - m, pageH - 18, { align: 'right' });
  }

  pdf.save(model.filename);
}
