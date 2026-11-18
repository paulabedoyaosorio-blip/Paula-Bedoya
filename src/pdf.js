'use strict';
/**
 * Generador del informe PDF: portada, resumen ejecutivo, indicadores,
 * gráficos, tablas de detalle, hallazgos, metodología y anexo de estimación.
 */

const path = require('path');
const PDFDocument = require('pdfkit');
const charts = require('./charts');
const A = require('./analysis');

const FONT_DIR = path.join(__dirname, '..', 'assets', 'fonts');
const REG = path.join(FONT_DIR, 'DejaVuSans.ttf');
const BOLD = path.join(FONT_DIR, 'DejaVuSans-Bold.ttf');

const C = {
  navy: '#0f2557',
  blue: '#2563eb',
  teal: '#0f766e',
  orange: '#ea580c',
  red: '#b91c1c',
  green: '#15803d',
  ink: '#0f172a',
  body: '#334155',
  muted: '#64748b',
  line: '#dfe6f1',
  soft: '#f4f7fb',
};

const PAGE = { size: 'A4', margin: 46 };
const WIDTH = 595.28;
const CONTENT_W = WIDTH - PAGE.margin * 2;

function newDoc() {
  const doc = new PDFDocument({
    size: PAGE.size,
    margin: PAGE.margin,
    bufferPages: true,
    info: {
      Title: 'Informe de tráfico vehicular — Peajes ANI',
      Author: 'Arena.ai',
      Subject: 'Análisis y estimación de tráfico y recaudo en peajes de la ANI',
      Creator: 'Tablero ANI · Node.js',
    },
  });
  doc.registerFont('Body', REG);
  doc.registerFont('Bold', BOLD);
  doc.font('Body');
  return doc;
}

/* ------------------------------- utilidades ------------------------------- */

function hr(doc, { color = C.line, width = 1, gap = 8 } = {}) {
  const y = doc.y;
  doc.save().moveTo(PAGE.margin, y).lineTo(PAGE.margin + CONTENT_W, y)
    .lineWidth(width).strokeColor(color).stroke().restore();
  doc.y = y + gap;
}

/** Título de sección: no se dibuja si no hay espacio para el encabezado y el primer bloque. */
function sectionTitle(doc, title, subtitle, keep = 170) {
  ensure(doc, keep);
  doc.moveDown(0.5);
  doc.fillColor(C.navy).font('Bold').fontSize(15).text(title, { width: CONTENT_W });
  if (subtitle) doc.fillColor(C.muted).font('Body').fontSize(9).text(subtitle, { width: CONTENT_W });
  const y = doc.y + 3;
  doc.save().rect(PAGE.margin, y, 46, 2.4).fill(C.blue).restore();
  doc.y = y + 12;
}

function ensure(doc, needed) {
  if (doc.y + needed > doc.page.height - PAGE.margin - 20) {
    doc.addPage();
    doc.font('Body').fontSize(9.5).fillColor(C.body);
  }
}

function paragraph(doc, text, opts = {}) {
  doc.fillColor(opts.color || C.body).font(opts.font || 'Body').fontSize(opts.size || 9.5);
  doc.text(text, { width: opts.width || CONTENT_W, align: opts.align || 'left', lineGap: 2 });
}

function image(doc, chart, { x = PAGE.margin, w = CONTENT_W } = {}) {
  const h = (chart.height / chart.width) * w;
  ensure(doc, h + 14);
  doc.image(chart.buffer, x, doc.y, { width: w, height: h });
  doc.y += h + 8;
}

function kpiGrid(doc, items, { columns = 3, gap = 10, boxH = 66 } = {}) {
  const boxW = (CONTENT_W - gap * (columns - 1)) / columns;
  const rows = Math.ceil(items.length / columns);
  ensure(doc, rows * (boxH + gap) + 4);
  const top = doc.y;
  items.forEach((item, i) => {
    const row = Math.floor(i / columns);
    const col = i % columns;
    const x = PAGE.margin + col * (boxW + gap);
    const y = top + row * (boxH + gap);
    doc.save().roundedRect(x, y, boxW, boxH, 7).fill(item.tone || C.soft).restore();
    doc.fillColor(C.muted).font('Bold').fontSize(7.2).text(String(item.label).toUpperCase(), x + 10, y + 9, { width: boxW - 20, characterSpacing: 0.4, lineBreak: false, ellipsis: true });
    doc.fillColor(item.color || C.navy).font('Bold').fontSize(item.size || 15.5).text(item.value, x + 10, y + 21, { width: boxW - 20, lineBreak: false, ellipsis: true });
    if (item.hint) doc.fillColor(item.hintColor || C.muted).font('Body').fontSize(7.4).text(item.hint, x + 10, y + 44, { width: boxW - 20, lineBreak: false, ellipsis: true });
  });
  doc.y = top + rows * (boxH + gap);
  doc.x = PAGE.margin;
}

function table(doc, { headers, rows, widths, align, zebra = true, fontsize = 8, headerBg = C.navy, gap = 4 }) {
  const total = widths.reduce((a, b) => a + b, 0);
  const w = widths.map((x) => (x / total) * CONTENT_W);
  const padX = 5;
  const bottomLimit = () => doc.page.height - PAGE.margin - 18;

  const drawHeader = () => {
    const y0 = doc.y;
    doc.save().rect(PAGE.margin, y0, CONTENT_W, 18).fill(headerBg).restore();
    doc.fillColor('#ffffff').font('Bold').fontSize(fontsize - 0.2);
    let x = PAGE.margin;
    headers.forEach((h, i) => {
      doc.text(String(h), x + padX, y0 + 5.5, { width: w[i] - padX * 2, align: (align && align[i]) || 'left', lineBreak: false, ellipsis: true });
      x += w[i];
    });
    doc.y = y0 + 18;
  };

  ensure(doc, 46);
  drawHeader();

  rows.forEach((row, ri) => {
    const cells = row.map((c) => String(c));
    const isBold = false;
    doc.font(isBold ? 'Bold' : 'Body').fontSize(fontsize);
    const textH = Math.max(...cells.map((c, i) => doc.heightOfString(c, { width: w[i] - padX * 2 })));
    const rowH = Math.max(fontsize + 6, textH + gap * 2);

    if (doc.y + rowH > bottomLimit()) {
      doc.addPage();
      doc.font('Body').fontSize(fontsize);
      drawHeader();
    }
    const y = doc.y;
    if (zebra && ri % 2 === 1) doc.save().rect(PAGE.margin, y, CONTENT_W, rowH).fill('#f7f9fc').restore();
    doc.fillColor(C.body).font(isBold ? 'Bold' : 'Body').fontSize(fontsize);
    let x = PAGE.margin;
    cells.forEach((cell, i) => {
      doc.text(cell, x + padX, y + gap, {
        width: w[i] - padX * 2,
        align: (align && align[i]) || 'left',
        lineGap: 1,
      });
      x += w[i];
    });
    doc.y = y + rowH;
    doc.save().moveTo(PAGE.margin, doc.y).lineTo(PAGE.margin + CONTENT_W, doc.y).lineWidth(0.4).strokeColor('#eef2f8').stroke().restore();
  });
  doc.y += 8;
  doc.x = PAGE.margin;
}

function bullet(doc, text, { icon = '•', color = C.blue } = {}) {
  const w = CONTENT_W - 16;
  const h = doc.font('Body').fontSize(9.4).heightOfString(text, { width: w, lineGap: 2 });
  ensure(doc, h + 12);
  const y = doc.y;
  doc.fillColor(color).font('Bold').fontSize(9.6).text(icon, PAGE.margin, y + 0.6, { width: 12, lineBreak: false });
  doc.fillColor(C.body).font('Body').fontSize(9.4).text(text, PAGE.margin + 16, y, { width: w, lineGap: 2 });
  doc.y = y + h + 5;
  doc.x = PAGE.margin;
}

function callout(doc, text, { color = C.teal, bg = '#ecfdf5' } = {}) {
  const h = doc.heightOfString(text, { width: CONTENT_W - 24, lineGap: 2 }) + 18;
  ensure(doc, h + 8);
  const y = doc.y;
  doc.save().roundedRect(PAGE.margin, y, CONTENT_W, h, 6).fill(bg)
    .rect(PAGE.margin, y, 3, h).fill(color).restore();
  doc.fillColor('#0f172a').font('Body').fontSize(8.8).text(text, PAGE.margin + 14, y + 9, { width: CONTENT_W - 26, lineGap: 2 });
  doc.y = y + h + 9;
}

/* -------------------------------- portada -------------------------------- */

function cover(doc, rd) {
  const H = doc.page.height;
  doc.save().rect(0, 0, WIDTH, H).fill(C.navy).restore();
  doc.save().rect(0, 0, WIDTH, 6).fill(C.blue).restore();
  // retícula decorativa
  doc.save().opacity(0.12);
  for (let i = 0; i < 9; i++) {
    doc.rect(WIDTH - 210 + i * 22, H - 320, 12, 260).fill('#60a5fa');
  }
  doc.restore();
  doc.save().opacity(0.9).circle(WIDTH - 90, 120, 46).lineWidth(1.2).strokeColor('#3b82f6').stroke().restore();
  doc.save().opacity(0.5).circle(WIDTH - 90, 120, 70).lineWidth(1).strokeColor('#1d4ed8').stroke().restore();

  doc.fillColor('#93c5fd').font('Bold').fontSize(8.5).text('TABLERO ANALÍTICO · ANI', PAGE.margin, 92, { characterSpacing: 1.6 });
  doc.fillColor('#ffffff').font('Bold').fontSize(30).text(rd.meta.titulo, PAGE.margin, 112, { width: CONTENT_W - 90, lineGap: 3 });
  doc.fillColor('#bfdbfe').font('Body').fontSize(11).text(
    'Análisis de datos históricos, indicadores operativos, pronóstico de tráfico y estimación de recaudo en los peajes administrados por la Agencia Nacional de Infraestructura.',
    PAGE.margin, doc.y + 12, { width: CONTENT_W - 110, lineGap: 3 },
  );

  const y0 = H - 300;
  doc.save().roundedRect(PAGE.margin, y0, CONTENT_W, 176, 10).fill('#16306b').restore();
  doc.fillColor('#93c5fd').font('Bold').fontSize(8).text('PERIODO ANALIZADO', PAGE.margin + 16, y0 + 14, { characterSpacing: 1 });
  doc.fillColor('#ffffff').font('Bold').fontSize(13).text(
    `${A.monthLabel(rd.analysis.series.months[0])} — ${A.monthLabel(rd.analysis.series.months[rd.analysis.series.months.length - 1])}`,
    PAGE.margin + 16, y0 + 28,
  );
  const facts = [
    ['REGISTROS', A.n0(rd.source.rows)],
    ['PEAJES', A.n0(rd.analysis.ranking.length)],
    ['MESES', A.n0(rd.analysis.series.months.length)],
    ['CATEGORÍAS', A.n0(rd.analysis.categorias.length)],
  ];
  facts.forEach(([k, v], i) => {
    const x = PAGE.margin + 16 + i * ((CONTENT_W - 32) / 4);
    doc.fillColor('#93c5fd').font('Bold').fontSize(7.4).text(k, x, y0 + 62, { characterSpacing: 0.8 });
    doc.fillColor('#ffffff').font('Bold').fontSize(15).text(v, x, y0 + 74);
  });
  doc.save().moveTo(PAGE.margin + 16, y0 + 104).lineTo(PAGE.margin + CONTENT_W - 16, y0 + 104).lineWidth(0.7).strokeColor('#2b4b8f').stroke().restore();
  doc.fillColor('#cbd5e1').font('Body').fontSize(8.4).text(
    `Fuente: ${rd.source.file} · ${A.n0(rd.source.rows)} registros · cargado el ${new Date(rd.source.loadedAt).toLocaleDateString('es-CO', { day: '2-digit', month: 'long', year: 'numeric' })}`,
    PAGE.margin + 16, y0 + 114, { width: CONTENT_W - 32, lineGap: 2 },
  );
  if (rd.meta.entidad) doc.fillColor('#cbd5e1').font('Body').fontSize(8.4).text(`Entidad / área: ${rd.meta.entidad}`, PAGE.margin + 16, y0 + 136);
  if (rd.meta.autor) doc.fillColor('#cbd5e1').font('Body').fontSize(8.4).text(`Elaborado por: ${rd.meta.autor}`, PAGE.margin + 16, y0 + 148);

  doc.fillColor('#64748b').font('Body').fontSize(7.6).text(
    `Generado con el tablero interactivo el ${new Date(rd.meta.generado).toLocaleString('es-CO')}`,
    PAGE.margin, H - 56, { width: CONTENT_W },
  );
}

/* --------------------------- secciones del informe --------------------------- */

function executiveSummary(doc, rd) {
  const { analysis: an, forecast: fc, estimation: est } = rd;
  sectionTitle(doc, '1. Resumen ejecutivo', 'Indicadores del periodo seleccionado, comparación con el periodo anterior y resultado de la estimación.', 400);
  image(doc, charts.monthlyTraffic(an.series.months, an.series.trafico, an.series.recaudo), {});

  const d = an.deltas;
  const arrow = (v) => (v === null || v === undefined ? 's/d' : `${v >= 0 ? '+' : '−'}${A.n1(Math.abs(v))}%`);
  kpiGrid(doc, [
    { label: 'Tráfico total (pasos)', value: A.n0(an.totals.trafico), hint: d ? `${arrow(d.trafico.pct)} vs periodo previo` : '—', hintColor: d && d.trafico.pct < 0 ? C.red : C.green },
    { label: 'Recaudo estimado', value: A.fmtMoney(an.totals.recaudo), hint: d ? `${arrow(d.recaudo.pct)} vs periodo previo` : '—', hintColor: d && d.recaudo.pct < 0 ? C.red : C.green },
    { label: 'Tarifa promedio', value: A.fmtMoney(an.totals.tarifaPromedio), hint: 'COP por paso vehicular' },
    { label: 'Tasa de evasión', value: A.pct(an.totals.tasaEvasion), hint: `${A.n0(an.totals.evasores)} evasores reportados` },
    { label: 'Exentos (787)', value: A.pct(an.totals.tasaExencion), hint: `${A.n0(an.totals.exentos)} pasos exentos` },
    { label: 'Pronóstico próximos 12 m', value: A.fmtMoney(est.totalRecaudo), hint: `${A.n0(est.totalTrafico)} pasos esperados`, tone: '#fff7ed', color: C.orange },
  ]);

  doc.moveDown(0.3);
  paragraph(doc, 'Principales hallazgos', { font: 'Bold', color: C.navy, size: 11 });
  doc.moveDown(0.2);
  rd.findings.slice(0, 5).forEach((f) => bullet(doc, f.text, {
    icon: f.type === 'alerta' || f.type === 'negativo' ? '!' : f.type === 'calidad' ? 'i' : '✓',
    color: f.type === 'alerta' || f.type === 'negativo' ? C.red : f.type === 'calidad' ? C.orange : C.teal,
  }));

  if (fc.accuracy) {
    callout(doc,
      `Validación del modelo: al pronosticar los últimos 6 meses observados, el error absoluto medio fue ${A.n2(fc.accuracy.mape)}% (MAPE) y ${A.n0(fc.accuracy.precision)}% de los meses quedó dentro de ±10%. ${fc.method}.`);
  }
}

function sectionIndicators(doc, rd) {
  const { analysis: an } = rd;
  sectionTitle(doc, '2. Análisis del tráfico', 'Evolución mensual acumulada, distribución anual, estacionalidad y meses atípicos.', 300);
  ensure(doc, 260);
  image(doc, charts.yearlyBars(an.yearly), { w: CONTENT_W });

  const rows = an.yearly.map((y, i) => {
    const prev = an.yearly[i - 1];
    const partial = y.meses < 12;
    const varPct = prev && prev.trafico > 0 && !partial && prev.meses === 12
      ? ((y.trafico - prev.trafico) / prev.trafico) * 100
      : null;
    return [
      partial ? `${y.year} (${y.meses} m)` : y.year,
      A.n0(y.trafico),
      varPct === null ? (partial ? 'año parcial' : '—') : `${varPct >= 0 ? '+' : ''}${A.n2(varPct)}%`,
      A.n0(y.evasores),
      A.n0(y.exentos),
      A.fmtMoney(y.recaudo),
      A.fmtMoney(y.tarifaPromedio),
    ];
  });
  table(doc, {
    headers: ['Año', 'Tráfico', 'Var. %', 'Evasores', 'Exentos 787', 'Recaudo est.', 'Tarifa prom.'],
    rows,
    widths: [9, 19, 11, 14, 15, 18, 14],
    align: ['left', 'right', 'right', 'right', 'right', 'right', 'right'],
    fontsize: 7.8,
  });

  quote(doc, `La serie cubre ${an.series.months.length} meses. ${an.cagr ? `El crecimiento anual compuesto (CAGR) en los años completos analizados es de ${A.pct(an.cagr.value)}.` : 'No hay suficientes años completos para calcular un CAGR.'}`);

  ensure(doc, 300);
  paragraph(doc, 'Estacionalidad del tráfico', { font: 'Bold', color: C.navy, size: 11 });
  image(doc, charts.seasonalBars(an.seasonal, A.MONTH_LABELS));
  paragraph(doc, 'Cada barra indica el índice de tráfico de ese mes calendario frente al promedio mensual del mismo año; valores sobre 100% señalan meses de mayor demanda (temporadas altas), útiles para planear mantenimientos y refuerzos operativos fuera de esos picos.', { size: 9 });

  if (an.anomalies.length) {
    doc.moveDown(0.4);
    paragraph(doc, 'Meses con comportamiento atípico (z-score robusto ≥ 3)', { font: 'Bold', color: C.navy, size: 10.5 });
    doc.moveDown(0.2);
    table(doc, {
      headers: ['Mes', 'Tráfico', 'Desviación (z)'],
      rows: an.anomalies.slice(0, 8).map((a) => [A.monthLabel(a.month), A.n0(a.value), A.n1(a.z)]),
      widths: [16, 16, 14],
      align: ['left', 'right', 'right'],
      fontsize: 8,
    });
  }
}

function sectionRankings(doc, rd) {
  const { analysis: an } = rd;
  sectionTitle(doc, '3. Ranking de peajes y categorías', 'Peajes con mayor operación, concentración del tráfico y composición vehicular.', 270);
  ensure(doc, 260);
  image(doc, charts.rankingBars(an.ranking.slice(0, 12).map((r) => ({ label: r.peaje, value: r.trafico })), { limit: 12, label: 'Tráfico (pasos)' }));
  paragraph(doc, `Los 5 primeros peajes concentran el ${A.pct(an.concentration.top5)} del tráfico y los 10 primeros el ${A.pct(an.concentration.top10)} (HHI ${A.n0(an.concentration.hhi)}, índice de Gini ${A.n2(an.concentration.gini)}). Un HHI bajo indica que el tráfico está distribuido entre muchos peajes, por lo que una afectación puntual tiene impacto limitado en el total nacional.`, { size: 9 });

  ensure(doc, 300);
  image(doc, charts.compositionDoughnut(an.categorias.map((c) => ({ label: c.categoria, value: c.trafico }))), { w: 310, x: PAGE.margin });

  const rows = an.ranking.slice(0, 20).map((r, i) => [
    String(i + 1),
    r.peaje,
    A.n0(r.trafico),
    A.pct((r.trafico / (an.totals.trafico || 1)) * 100),
    A.n0(r.evasores),
    A.fmtMoney(r.tarifaPromedio),
    A.fmtMoney(r.recaudo),
  ]);
  ensure(doc, 90);
  paragraph(doc, 'Detalle del top 20 de peajes', { font: 'Bold', color: C.navy, size: 10.5 });
  doc.moveDown(0.2);
  table(doc, {
    headers: ['#', 'Peaje', 'Tráfico', 'Part. %', 'Evasores', 'Tarifa prom.', 'Recaudo est.'],
    rows,
    widths: [7, 22, 17, 10, 12, 15, 17],
    align: ['left', 'left', 'right', 'right', 'right', 'right', 'right'],
    fontsize: 7.6,
  });

  ensure(doc, 260);
  image(doc, charts.scatterRanking(an.ranking, { limit: 40 }));
  paragraph(doc, 'Relación entre tarifa promedio por paso y volumen de tráfico: los peajes en el cuadrante superior izquierdo aportan alto volumen con tarifa moderada, mientras que el cuadrante derecho combina menor tráfico con tarifas altas (perfiles concesionados o corredores sin cobro parcial).', { size: 9 });
}

function sectionForecast(doc, rd) {
  const { analysis: an, forecast: fc, estimation: est } = rd;
  sectionTitle(doc, '4. Pronóstico y estimación de recaudo', `Horizonte de ${fc.months.length} meses · ${fc.method}.`, 400);
  const histM = an.series.months.slice(-Math.max(24, Math.min(48, an.series.months.length)));
  const histV = an.series.trafico.slice(-histM.length);
  ensure(doc, 330);
  image(doc, charts.forecastChart(histM, histV, fc));

  kpiGrid(doc, [
    { label: 'Tráfico proyectado', value: A.n0(est.totalTrafico), hint: `${fc.months.length} meses` },
    { label: 'Recaudo proyectado', value: A.fmtMoney(est.totalRecaudo), hint: 'Tarifa promedio × tráfico', tone: '#fff7ed', color: C.orange },
    { label: 'Tarifa base usada', value: A.fmtMoney(est.tarifaBase), hint: 'Del periodo analizado' },
  ]);

  image(doc, charts.estimationBars(est.rows));

  const rows = est.rows.map((r) => [
    A.monthLabel(r.month),
    A.n0(r.traficoBase),
    A.n0(r.trafico),
    A.fmtMoney(r.tarifa),
    A.fmtMoney(r.recaudo),
  ]);
  ensure(doc, 90);
  paragraph(doc, 'Detalle mensual de la proyección', { font: 'Bold', color: C.navy, size: 10.5 });
  doc.moveDown(0.2);
  table(doc, {
    headers: ['Mes', 'Tráfico pronosticado', 'Tráfico ajustado', 'Tarifa proyectada', 'Recaudo estimado'],
    rows,
    widths: [16, 22, 22, 19, 21],
    align: ['left', 'right', 'right', 'right', 'right'],
    fontsize: 7.8,
  });
  if (fc.accuracy) {
    callout(doc,
      `Desempeño del modelo: MAPE ${A.n2(fc.accuracy.mape)}% y acierto de ${A.n0(fc.accuracy.precision)}% dentro de ±10% en la validación de los últimos 6 meses. Pendiente estimada: ${A.n0(fc.trendSlope)} pasos por mes. El recaudo se calcula con la tarifa promedio observada y no incluye ajustes oficiales de tarifa, evasión no reportada ni cambios de concesión.`);
  }
}

function sectionQuality(doc, rd) {
  const { analysis: an } = rd;
  const issues = an.quality.filter((q) => q.count > 0).sort((a, b) => b.count - a.count);
  sectionTitle(doc, '5. Calidad de datos', 'Reglas de validación aplicadas al archivo de origen y su efecto sobre los indicadores.', 120);
  if (!issues.length) {
    paragraph(doc, 'No se detectaron registros que incumplan las reglas de validación.');
  } else {
    table(doc, {
      headers: ['Regla de validación', 'Registros', '% del total', 'Efecto'],
      rows: issues.map((q) => [
        q.label,
        A.n0(q.count),
        A.pct(q.pct),
        q.code === 'tarifa_cero' ? 'Subestima el recaudo' : q.code === 'duplicado' ? 'Sobreestima totales' : q.code === 'categoria_atipica' ? 'Revisar homologación' : 'Revisar registro',
      ]),
      widths: [34, 13, 13, 22],
      align: ['left', 'right', 'right', 'left'],
      fontsize: 8,
    });
    const tarifaCero = issues.find((q) => q.code === 'tarifa_cero');
    if (tarifaCero) {
      callout(doc,
        `El recaudo del informe se calcula como ValorTarifa × CantidadTrafico. Los ${A.n0(tarifaCero.count)} registros con tarifa cero (${A.pct(tarifaCero.pct)} de las filas) aportan tráfico sin recaudo asociado; por eso el recaudo debe leerse como una cota inferior y contrastarse con las cifras oficiales de la ANI.`, { color: C.orange, bg: '#fff7ed' });
    }
    const samples = issues.filter((q) => q.samples && q.samples.length).slice(0, 3);
    if (samples.length) {
      paragraph(doc, 'Ejemplos de registros observados', { font: 'Bold', color: C.navy, size: 9.5 });
      doc.moveDown(0.2);
      samples.forEach((q) => {
        bullet(doc, `${q.label}: ${q.samples.slice(0, 2).join(' · ')}`, { icon: '–', color: C.muted });
      });
    }
    if (an.rareCategories.length) {
      doc.moveDown(0.2);
      paragraph(doc, `Categorías tarifarias poco frecuentes detectadas (menos del 0,2% de los registros): ${an.rareCategories.join(', ')}.`, { size: 8.6, color: C.muted });
    }
  }
  doc.moveDown(0.6);
  paragraph(doc, 'Fuente y trazabilidad', { font: 'Bold', color: C.navy, size: 10.5 });
  doc.moveDown(0.2);
  table(doc, {
    headers: ['Atributo', 'Valor'],
    rows: [
      ['Archivo de origen', rd.source.file],
      ['Registros procesados', A.n0(rd.source.rows)],
      ['Tamaño del archivo', `${A.n1(rd.source.bytes / 1e6)} MB`],
      ['Filas descartadas', A.n0(rd.source.skipped)],
      ['Cargado', new Date(rd.source.loadedAt).toLocaleString('es-CO')],
    ],
    widths: [24, 40],
    fontsize: 8,
  });
}

function sectionFindings(doc, rd) {
  sectionTitle(doc, '6. Hallazgos y recomendaciones', 'Lectura analítica de los resultados y acciones sugeridas.', 120);
  const groups = [
    ['Lo que dicen los datos', rd.findings.filter((f) => ['contexto', 'positivo', 'negativo', 'estructura', 'composicion', 'patron'].includes(f.type))],
    ['Alertas', rd.findings.filter((f) => ['alerta', 'calidad'].includes(f.type))],
  ];
  for (const [title, list] of groups) {
    if (!list.length) continue;
    ensure(doc, 60);
    paragraph(doc, title, { font: 'Bold', color: C.navy, size: 10.5 });
    doc.moveDown(0.25);
    list.forEach((f) => bullet(doc, f.text, {
      icon: title === 'Alertas' ? '!' : '✓',
      color: title === 'Alertas' ? C.orange : C.teal,
    }));
    doc.moveDown(0.4);
  }
  ensure(doc, 90);
  paragraph(doc, 'Recomendaciones', { font: 'Bold', color: C.navy, size: 10.5 });
  doc.moveDown(0.25);
  rd.recommendations.forEach((r, i) => bullet(doc, r, { icon: String(i + 1), color: C.blue }));
}

function sectionMethod(doc, rd) {
  sectionTitle(doc, '7. Metodología', 'Cómo se calcularon los indicadores y cómo debe interpretarse el informe.', 150);
  const items = [
    ['Tráfico', 'Suma de CantidadTrafico de los registros que cumplen los filtros. Cada registro corresponde a un peaje, una categoría tarifaria y un mes.'],
    ['Recaudo estimado', 'Suma de ValorTarifa × CantidadTrafico. No es el recaudo oficial: excluye tarifa cero, evasión no reportada y descuentos operativos.'],
    ['Tasa de evasión', 'CantidadEvasores / (CantidadTrafico + CantidadEvasores).'],
    ['Tasa de exención (787)', 'CantidadExentos787 / (CantidadTrafico + CantidadExentos787).'],
    ['CAGR', '((Tráfico año final / Tráfico año inicial) ^ (1 / años) − 1) usando solo años con los 12 meses completos.'],
    ['Estacionalidad', 'Promedio del cociente entre el tráfico de cada mes y el promedio del año al que pertenece, normalizado a 12 índices que suman 12.'],
    ['Concentración', 'HHI = suma de las participaciones al cuadrado (×10.000) y Gini sobre las participaciones por peaje.'],
    ['Pronóstico', 'Regresión lineal sobre la serie desestacionalizada (ventana configurable) multiplicada por los índices estacionales. La banda corresponde a ±1,645 errores estándar escalados con el horizonte (~90% de confianza).'],
    ['Validación', 'Backtesting: se entrena sin los últimos 6 meses y se compara contra lo observado (MAPE y acierto a ±10%).'],
  ];
  table(doc, {
    headers: ['Indicador', 'Cálculo'],
    rows: items,
    widths: [16, 48],
    fontsize: 8,
  });
  if (rd.meta.notas) {
    paragraph(doc, `Notas del informe: ${rd.meta.notas}`, { size: 8.6, color: C.muted });
  }
  quote(doc, `Este informe fue generado automáticamente desde el tablero interactivo con los datos del archivo ${rd.source.file}. Las cifras son estimaciones analíticas y deben validarse con los reportes oficiales de la ANI antes de su uso contractual o financiero.`);
}

function quote(doc, text) {
  ensure(doc, 44);
  const h = doc.heightOfString(text, { width: CONTENT_W - 24, lineGap: 2 }) + 16;
  const y = doc.y;
  doc.save().rect(PAGE.margin, y, CONTENT_W, h).fill(C.soft)
    .rect(PAGE.margin, y, 3, h).fill(C.blue).restore();
  doc.fillColor(C.body).font('Body').fontSize(8.6).text(text, PAGE.margin + 14, y + 8, { width: CONTENT_W - 26, lineGap: 2 });
  doc.y = y + h + 10;
}

/* ------------------------------- paginación ------------------------------- */

function decoratePages(doc, rd) {
  const range = doc.bufferedPageRange();
  for (let i = range.start + 1; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    // evita que pdfkit agregue páginas al escribir en el margen
    doc.page.margins.bottom = 0;
    doc.page.margins.top = 0;
    // encabezado
    doc.save().font('Bold').fontSize(7.4).fillColor(C.muted)
      .text('INFORME DE TRÁFICO VEHICULAR · PEAJES ANI', PAGE.margin, 24, { width: CONTENT_W, characterSpacing: 0.6, lineBreak: false });
    doc.font('Body').fontSize(7.4).fillColor(C.muted)
      .text(`${A.monthLabel(rd.analysis.series.months[0])} — ${A.monthLabel(rd.analysis.series.months[rd.analysis.series.months.length - 1])}`, PAGE.margin, 24, { width: CONTENT_W, align: 'right', lineBreak: false });
    doc.save().moveTo(PAGE.margin, 36).lineTo(PAGE.margin + CONTENT_W, 36).lineWidth(0.6).strokeColor(C.line).stroke().restore();
    // pie
    const y = doc.page.height - 32;
    doc.save().moveTo(PAGE.margin, y).lineTo(PAGE.margin + CONTENT_W, y).lineWidth(0.6).strokeColor(C.line).stroke().restore();
    doc.fillColor(C.muted).font('Body').fontSize(7.2)
      .text('Tablero analítico ANI · cifras estimadas a partir del archivo de datos', PAGE.margin, y + 7, { width: CONTENT_W - 70, lineBreak: false });
    doc.font('Bold').fontSize(7.4).fillColor(C.navy)
      .text(`${i - range.start} / ${range.count - 1}`, PAGE.margin + CONTENT_W - 70, y + 7, { width: 70, align: 'right', lineBreak: false });
  }
}

/* --------------------------------- builder -------------------------------- */

/**
 * @param {object} rd datos de buildReportData
 * @param {NodeJS.WritableStream} [out] destino; por defecto se retorna un Buffer
 * @returns {Promise<Buffer|void>}
 */
function renderPdf(rd, out) {
  return new Promise((resolve, reject) => {
    try {
      const doc = newDoc();
      const chunks = [];
      if (out) doc.pipe(out);
      else doc.on('data', (c) => chunks.push(c));

      cover(doc, rd);
      doc.addPage();
      executiveSummary(doc, rd);
      sectionIndicators(doc, rd);
      sectionRankings(doc, rd);
      sectionForecast(doc, rd);
      sectionQuality(doc, rd);
      sectionFindings(doc, rd);
      sectionMethod(doc, rd);
      decoratePages(doc, rd);

      doc.on('end', () => resolve(out ? undefined : Buffer.concat(chunks)));
      doc.on('error', reject);
      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = { renderPdf, newDoc };
