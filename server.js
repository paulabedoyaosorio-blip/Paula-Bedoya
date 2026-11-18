'use strict';
/**
 * Servidor HTTP del tablero: API de datos + generación de PDF + frontend.
 */

const fs = require('fs');
const path = require('path');
const express = require('express');
const { loadDataset } = require('./src/dataset');
const A = require('./src/analysis');
const { renderPdf } = require('./src/pdf');

const PORT = process.env.PORT === undefined || process.env.PORT === '' ? 3000 : Number(process.env.PORT);
const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.text({ type: ['text/csv', 'text/plain'], limit: '120mb' }));
app.disable('x-powered-by');

let DS = null;

/* ------------------------------- utilidades ------------------------------- */

function parseFilters(src = {}) {
  const asList = (v) => {
    if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
    if (typeof v === 'string' && v.trim()) return v.split('|').map((x) => x.trim()).filter(Boolean);
    return [];
  };
  return {
    desde: src.desde || null,
    hasta: src.hasta || null,
    peajes: asList(src.peajes),
    categorias: asList(src.categorias),
  };
}

function parseEstimation(src = {}) {
  const n = (v, d = 0) => {
    const x = Number(v);
    return Number.isFinite(x) ? x : d;
  };
  return {
    peaje: src.peaje || null,
    horizonte: Math.min(36, Math.max(1, n(src.horizonte, 12))),
    ventana: Math.min(120, Math.max(6, n(src.ventana, 36))),
    tarifaGrowthPct: Math.max(-50, Math.min(100, n(src.tarifaGrowthPct, 0))),
    trafficAdjustPct: Math.max(-90, Math.min(200, n(src.trafficAdjustPct, 0))),
    tarifaOverride: n(src.tarifaOverride, 0) || null,
  };
}

function datasetMeta(ds) {
  return {
    source: ds.source,
    months: ds.months,
    peajes: ds.peajes,
    categorias: ds.categorias,
    quality: ds.quality,
    rareCategories: ds.rareCategories,
  };
}

/* ---------------------------------- API ---------------------------------- */

app.get('/api/meta', (req, res) => {
  res.json(datasetMeta(DS));
});

app.get('/api/analysis', (req, res) => {
  const f = parseFilters(req.query);
  const analysis = A.buildAnalysis(DS, f);
  const rankingTop = (analysis.ranking || []).slice(0, 200);
  res.json({
    ...analysis,
    ranking: rankingTop,
    rankingCount: (analysis.ranking || []).length,
    findings: A.findings(analysis, DS),
    recommendations: A.recommendations(analysis, null),
    filters: f,
  });
});

app.get('/api/series', (req, res) => {
  const f = parseFilters(req.query);
  const s = DS.series(f);
  res.json({
    months: s.months,
    trafico: Array.from(s.trafico),
    evasores: Array.from(s.evasores),
    exentos: Array.from(s.exentos),
    recaudo: Array.from(s.recaudo),
  });
});

app.get('/api/peaje/:nombre', (req, res) => {
  const nombre = req.params.nombre;
  const exists = DS.peajes.find((p) => p.peaje === nombre);
  if (!exists) return res.status(404).json({ error: 'Peaje no encontrado' });
  const s = DS.peajeSeries(nombre);
  const cats = DS.rankCategorias({ peajes: [nombre] });
  const yearly = {};
  DS.months.forEach((m, i) => {
    const y = m.split('-')[0];
    yearly[y] = yearly[y] || { year: y, trafico: 0, recaudo: 0, meses: 0 };
    yearly[y].trafico += s.trafico[i];
    yearly[y].recaudo += s.recaudo[i];
    yearly[y].meses += 1;
  });
  res.json({
    peaje: exists,
    months: DS.months,
    series: {
      trafico: Array.from(s.trafico),
      evasores: Array.from(s.evasores),
      exentos: Array.from(s.exentos),
      recaudo: Array.from(s.recaudo),
    },
    categorias: cats,
    yearly: Object.values(yearly),
  });
});

app.get('/api/forecast', (req, res) => {
  const f = parseFilters(req.query);
  const est = parseEstimation(req.query);
  const rd = A.buildReportData(DS, { ...f, estimacion: { ...est, peaje: est.peaje || f.peajes[0] || null } });
  res.json({
    historico: { months: rd.analysis.series.months, trafico: rd.analysis.series.trafico, recaudo: rd.analysis.series.recaudo },
    pronostico: rd.forecast,
    estimacion: rd.estimation,
    hallazgos: rd.findings,
    recomendaciones: rd.recommendations,
  });
});

app.get('/api/export.csv', (req, res) => {
  const f = parseFilters(req.query);
  const ranking = DS.rankPeajes({ desde: f.desde, hasta: f.hasta, categorias: f.categorias });
  const rows = [['Peaje', 'IdPeaje', 'Trafico', 'Evasores', 'Exentos787', 'RecaudoEstimado', 'TarifaPromedio', 'TasaEvasionPct']];
  for (const r of ranking) {
    if (f.peajes.length && !f.peajes.includes(r.peaje)) continue;
    rows.push([r.peaje, r.id, Math.round(r.trafico), Math.round(r.evasores), Math.round(r.exentos), Math.round(r.recaudo), Math.round(r.tarifaPromedio), r.tasaEvasion.toFixed(4)]);
  }
  const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="resumen_peajes.csv"');
  res.send(`\uFEFF${csv}`);
});

app.post('/api/upload', async (req, res) => {
  try {
    const csv = typeof req.body === 'string' ? req.body : '';
    if (!csv || csv.length < 200) return res.status(400).json({ error: 'El archivo está vacío o no es un CSV válido' });
    const header = csv.slice(0, 400);
    const requeridas = ['Peaje', 'CategoriaTarifa', 'Desde', 'ValorTarifa', 'CantidadTrafico'];
    const faltantes = requeridas.filter((c) => !header.includes(c));
    if (faltantes.length) return res.status(400).json({ error: `Faltan columnas requeridas: ${faltantes.join(', ')}` });

    const dir = path.join(__dirname, 'data', 'uploads');
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const file = path.join(dir, `corte_${stamp}.csv`);
    fs.writeFileSync(file, csv, 'utf8');

    const previous = DS;
    const nuevo = await loadDataset(file);
    DS = nuevo;
    res.json({ ok: true, source: DS.source, months: DS.months.length, peajes: DS.peajes.length, backup: previous.source.file });
  } catch (err) {
    console.error('Error cargando archivo:', err);
    res.status(400).json({ error: 'No se pudo procesar el archivo', detail: err.message });
  }
});

app.post('/api/report', async (req, res) => {
  try {
    const body = req.body || {};
    const filters = parseFilters(body);
    const est = parseEstimation(body.estimacion || {});
    const secciones = body.secciones || {};
    // un peaje objetivo solo se usa si viene explícito en la estimación
    const rd = A.buildReportData(DS, {
      ...filters,
      titulo: (body.titulo || '').slice(0, 160) || undefined,
      autor: (body.autor || '').slice(0, 120),
      entidad: (body.entidad || '').slice(0, 120),
      notas: (body.notas || '').slice(0, 600),
      secciones,
      estimacion: { ...est, peaje: est.peaje || null },
    });
    const buf = await renderPdf(rd);
    const nombre = `Informe_Trafico_ANI_${(rd.analysis.series.desde || '').replace('-', '')}_${(rd.analysis.series.hasta || '').replace('-', '')}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${nombre}"`);
    res.setHeader('X-Report-Pages-Hint', String(rd.analysis.series.months.length));
    res.send(buf);
  } catch (err) {
    console.error('Error generando PDF:', err);
    res.status(500).json({ error: 'No fue posible generar el informe', detail: err.message });
  }
});

/* -------------------------------- frontend -------------------------------- */

app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

app.get('/vendor/chart.umd.js', (req, res) => {
  res.sendFile(path.join(__dirname, 'node_modules', 'chart.js', 'dist', 'chart.umd.js'));
});

app.get('/health', (req, res) => res.json({ ok: Boolean(DS), months: DS ? DS.months.length : 0, peajes: DS ? DS.peajes.length : 0 }));

/* --------------------------------- arranque -------------------------------- */

async function start() {
  const t0 = Date.now();
  if (!DS) DS = await loadDataset();
  console.log(`Datos cargados: ${DS.source.rows} registros, ${DS.months.length} meses, ${DS.peajes.length} peajes (${Date.now() - t0} ms)`);
  const server = app.listen(PORT, '0.0.0.0');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  console.log(`Tablero ANI escuchando en http://0.0.0.0:${server.address().port}`);
  return server;
}

if (require.main === module) {
  start().catch((err) => {
    console.error('No se pudo iniciar el servidor:', err);
    process.exit(1);
  });
}

module.exports = { app, start };
