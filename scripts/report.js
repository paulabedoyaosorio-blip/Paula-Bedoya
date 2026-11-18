'use strict';
/**
 * Genera el informe PDF sin levantar el servidor.
 *
 * Uso:
 *   node scripts/report.js --desde 2024-01 --hasta 2026-05 --peajes ANDES,ALVARADO \
 *     --horizonte 12 --tarifa-growth 5 --out out/informe.pdf
 */

const fs = require('fs');
const path = require('path');
const { loadDataset } = require('../src/dataset');
const A = require('../src/analysis');
const { renderPdf } = require('../src/pdf');

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) out[key] = true;
    else { out[key] = next; i++; }
  }
  return out;
}

(async () => {
  const args = parseArgs(process.argv.slice(2));
  const ds = await loadDataset(args.csv || undefined);
  const list = (v) => (v ? String(v).split(',').map((s) => s.trim()).filter(Boolean) : []);

  const rd = A.buildReportData(ds, {
    desde: args.desde || ds.months[Math.max(0, ds.months.length - 24)],
    hasta: args.hasta || ds.months[ds.months.length - 1],
    peajes: list(args.peajes),
    categorias: list(args.categorias),
    titulo: args.titulo,
    autor: args.autor || '',
    entidad: args.entidad || '',
    notas: args.notas || '',
    estimacion: {
      peaje: args.peaje || null,
      horizonte: Number(args.horizonte) || 12,
      ventana: Number(args.ventana) || 36,
      tarifaGrowthPct: Number(args['tarifa-growth']) || 0,
      trafficAdjustPct: Number(args['trafico-ajuste']) || 0,
      tarifaOverride: Number(args.tarifa) || null,
    },
  });

  const out = path.resolve(args.out || path.join('out', 'informe_trafico_ani.pdf'));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const buf = await renderPdf(rd);
  fs.writeFileSync(out, buf);
  console.log(`Informe generado: ${out} (${(buf.length / 1024).toFixed(0)} KB)`);
  console.log(`Periodo ${rd.analysis.series.desde} → ${rd.analysis.series.hasta} · ${A.n0(rd.analysis.totals.trafico)} pasos · recaudo estimado ${A.fmtMoney(rd.analysis.totals.recaudo)}`);
  console.log(`Pronóstico ${rd.forecast.months.length} meses · recaudo proyectado ${A.fmtMoney(rd.estimation.totalRecaudo)}`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
