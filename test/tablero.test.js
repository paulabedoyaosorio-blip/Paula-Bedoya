'use strict';
/**
 * Pruebas de humo del tablero: datos, agregaciones, análisis, pronóstico,
 * generación de PDF y endpoints HTTP principales.
 *
 * Uso: npm test  (o node --test test/)
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { loadDataset, parseNumber, parsePeriod } = require('../src/dataset');
const A = require('../src/analysis');
const { renderPdf } = require('../src/pdf');

let ds;

test.before(async () => {
  ds = await loadDataset();
});

test('parseNumber entiende separadores de miles y negativos', () => {
  assert.strictEqual(parseNumber('27,730'), 27730);
  assert.strictEqual(parseNumber('1.234.567'), 1234567);
  assert.strictEqual(parseNumber('(1,200)'), -1200);
  assert.strictEqual(parseNumber(''), 0);
});

test('parsePeriod interpreta el formato de la ANI', () => {
  assert.deepStrictEqual(parsePeriod('2015 Aug 01 12:00:00 AM'), { year: 2015, month: 8 });
  assert.deepStrictEqual(parsePeriod('2026-05'), { year: 2026, month: 5 });
  assert.strictEqual(parsePeriod('no-fecha'), null);
});

test('el dataset carga el archivo completo y sin filas descartadas', () => {
  assert.ok(ds.source.rows > 140000, `filas: ${ds.source.rows}`);
  assert.strictEqual(ds.source.skipped, 0);
  assert.ok(ds.months.length > 100);
  assert.ok(ds.peajes.length > 150);
  assert.strictEqual(ds.months[0], '2014-01');
});

test('las agregaciones por peaje suman el total nacional', () => {
  const national = Array.from(ds.national.trafico).reduce((a, b) => a + b, 0);
  const byPeaje = ds.peajes.reduce((a, p) => a + p.trafico, 0);
  assert.strictEqual(Math.round(national), Math.round(byPeaje));
});

test('el filtro de peajes y categorías reduce los totales', () => {
  const todos = ds.totals({ desde: '2025-01', hasta: '2025-12' });
  const uno = ds.totals({ desde: '2025-01', hasta: '2025-12', peajes: ['ANDES'] });
  assert.ok(uno.trafico > 0 && uno.trafico < todos.trafico);
  const cats = ds.totals({ desde: '2025-01', hasta: '2025-12', categorias: ['I', 'II'] });
  assert.ok(cats.trafico > 0 && cats.trafico < todos.trafico);
});

test('la serie filtrada tiene una etiqueta por mes', () => {
  const s = ds.series({ desde: '2024-01', hasta: '2024-12' });
  assert.strictEqual(s.months.length, 12);
  assert.strictEqual(s.trafico.length, 12);
  assert.strictEqual(s.trafico.length, s.recaudo.length);
});

test('la estacionalidad devuelve 12 índices que suman 12', () => {
  const s = ds.series({ desde: '2020-01', hasta: '2025-12' });
  const idx = A.seasonality(s.months, Array.from(s.trafico));
  assert.strictEqual(idx.length, 12);
  const suma = idx.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(suma - 12) < 0.001, `suma ${suma}`);
});

test('el pronóstico respeta el horizonte y valida contra el histórico', () => {
  const s = ds.series({ desde: '2020-01', hasta: '2026-05' });
  const fc = A.forecast(s.months, Array.from(s.trafico), { horizon: 9, window: 36 });
  assert.strictEqual(fc.months.length, 9);
  assert.strictEqual(fc.values.length, 9);
  assert.ok(fc.months[0] > '2026-05');
  assert.ok(fc.values.every((v) => v >= 0));
  assert.ok(fc.accuracy && fc.accuracy.mape >= 0);
});

test('la estimación de recaudo aplica tarifa y ajustes', () => {
  const s = ds.series({ desde: '2022-01', hasta: '2026-05' });
  const fc = A.forecast(s.months, Array.from(s.trafico), { horizon: 3, window: 36 });
  const base = A.estimate(fc, { tarifaPromedio: 10000 });
  const caro = A.estimate(fc, { tarifaPromedio: 10000, tarifaGrowthPct: 10 });
  assert.strictEqual(base.rows.length, 3);
  assert.ok(caro.totalRecaudo > base.totalRecaudo);
  assert.ok(base.rows.every((r) => r.recaudo > 0));
});

test('el concentrador y los hallazgos se construyen con el análisis', () => {
  const an = A.buildAnalysis(ds, { desde: '2025-01', hasta: '2025-12' });
  assert.ok(an.concentration.hhi > 0);
  assert.ok(an.ranking.length > 0);
  assert.ok(an.ranking[0].trafico >= an.ranking[an.ranking.length - 1].trafico);
  const f = A.findings(an, ds);
  assert.ok(f.length > 3);
  assert.ok(f.every((x) => typeof x.text === 'string' && x.text.length > 20));
});

test('el informe PDF se genera con las secciones requeridas', async () => {
  const rd = A.buildReportData(ds, {
    desde: '2024-01',
    hasta: '2026-05',
    peajes: ['ANDES', 'ALVARADO'],
    estimacion: { horizonte: 6 },
  });
  const buf = await renderPdf(rd);
  assert.ok(buf.length > 50000, `pdf ${buf.length}`);
  assert.strictEqual(buf.slice(0, 5).toString(), '%PDF-');
  const out = path.join(os.tmpdir(), 'informe_test.pdf');
  fs.writeFileSync(out, buf);
  assert.ok(fs.statSync(out).size > 50000);
  fs.unlinkSync(out);
});

test('los endpoints HTTP responden con datos y PDF', async () => {
  process.env.PORT = '0';
  const { start } = require('../server');
  const server = await start();
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const meta = await (await fetch(`${base}/api/meta`)).json();
    assert.ok(meta.months.length > 100);

    const an = await (await fetch(`${base}/api/analysis?desde=2025-01&hasta=2025-12&peajes=ANDES`)).json();
    assert.ok(an.totals.trafico > 0);
    assert.ok(Array.isArray(an.findings) && an.findings.length > 0);

    const fc = await (await fetch(`${base}/api/forecast?desde=2023-01&hasta=2026-05&horizonte=6`)).json();
    assert.strictEqual(fc.pronostico.months.length, 6);

    const pdfRes = await fetch(`${base}/api/report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ desde: '2025-01', hasta: '2026-05', estimacion: { horizonte: 6 } }),
    });
    assert.strictEqual(pdfRes.status, 200);
    assert.strictEqual(pdfRes.headers.get('content-type'), 'application/pdf');
    const buf = Buffer.from(await pdfRes.arrayBuffer());
    assert.strictEqual(buf.slice(0, 5).toString(), '%PDF-');

    const csv = await (await fetch(`${base}/api/export.csv?desde=2025-01&hasta=2025-12`)).text();
    assert.ok(csv.includes('Peaje') && csv.split('\n').length > 100);
  } finally {
    server.close();
  }
});
