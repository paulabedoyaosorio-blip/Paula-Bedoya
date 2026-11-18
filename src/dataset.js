'use strict';
/**
 * Capa de datos: lectura del CSV de tráfico vehicular de la ANI, normalización,
 * auditoría de calidad y pre-agregación de cubos que alimentan la API.
 *
 * El CSV original tiene valores con separador de miles y fechas tipo
 * "2015 Aug 01 12:00:00 AM"; aquí se normaliza todo a tipos numéricos y a
 * claves "YYYY-MM" / "YYYY".
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { aggregateBuffer } = require('./aggregates');

const MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/**
 * "27,730" -> 27730 ; "1.234.567" -> 1234567 ; "1.234,56" -> 1234.56 ;
 * "(1,200)" -> -1200 ; "" -> 0
 */
function parseNumber(raw) {
  if (raw === undefined || raw === null) return 0;
  let s = String(raw).trim();
  if (!s) return 0;
  let sign = 1;
  if (s.startsWith('(') && s.endsWith(')')) { sign = -1; s = s.slice(1, -1); }
  s = s.replace(/\s/g, '');
  const hasComma = s.includes(',');
  const hasDot = s.includes('.');
  if (hasComma && hasDot) {
    // el último separador es el decimal
    s = s.lastIndexOf(',') > s.lastIndexOf('.')
      ? s.replace(/\./g, '').replace(',', '.')
      : s.replace(/,/g, '');
  } else if (hasComma) {
    s = /^\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.');
  } else if (hasDot) {
    s = /^\d{1,3}(\.\d{3})+$/.test(s) ? s.replace(/\./g, '') : s;
  }
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? sign * n : 0;
}

/** "2015 Aug 01 12:00:00 AM" -> { year: 2015, month: 8 } */
function parsePeriod(raw) {
  const s = String(raw || '').trim();
  const m = s.match(/^(\d{4})\s+([A-Za-z]{3})/);
  if (!m) {
    const iso = s.match(/^(\d{4})-(\d{2})/);
    if (iso) return { year: Number(iso[1]), month: Number(iso[2]) };
    return null;
  }
  const month = MONTHS[m[2].toLowerCase()] || null;
  return month ? { year: Number(m[1]), month } : null;
}

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Divide una línea CSV respetando comillas. */
function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; } else inQuotes = !inQuotes;
    } else if (c === ',' && !inQuotes) {
      out.push(cur); cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out;
}

const DEFAULT_CSV = path.join(__dirname, '..', 'data', 'trafico_ani.csv');

const QUALITY_RULES = [
  { code: 'fecha_invalida', label: 'Periodo (Desde) no interpretable' },
  { code: 'periodo_inconsistente', label: 'Periodo mayor a un mes o "Hasta" anterior a "Desde"' },
  { code: 'duplicado', label: 'Registro duplicado (misma llave peaje/categoría/periodo)' },
  { code: 'trafico_negativo', label: 'Cantidad de tráfico negativa' },
  { code: 'evasores_mayor_trafico', label: 'Evasores mayores que el tráfico' },
  { code: 'exentos_mayor_trafico', label: 'Exentos (787) mayores que el tráfico' },
  { code: 'tarifa_cero', label: 'Valor de tarifa en cero' },
  { code: 'sin_id', label: 'Peaje sin identificador (IdPeaje)' },
  { code: 'categoria_atipica', label: 'Categoría tarifaria poco frecuente' },
];

/**
 * Carga el CSV, normaliza y construye las agregaciones en memoria.
 * @param {string} [csvPath]
 */
async function loadDataset(csvPath = process.env.CSV_PATH || DEFAULT_CSV) {
  const startedAt = Date.now();
  if (!fs.existsSync(csvPath)) {
    throw new Error(`No se encontró el archivo de datos: ${csvPath}`);
  }

  const stream = fs.createReadStream(csvPath, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  const agg = aggregateBuffer();

  let header = null;
  let idx = {};
  let lineNo = 0;
  let skipped = 0;
  const quality = {};
  for (const r of QUALITY_RULES) quality[r.code] = { ...r, count: 0, samples: [], registros: 0, trafico: 0 };

  const bumpQuality = (code, ctx) => {
    const q = quality[code];
    q.count += 1;
    q.registros += 1;
    q.trafico += ctx.trafico || 0;
    if (q.samples.length < 6) q.samples.push(ctx.sample);
  };

  const seenKeys = new Set();
  const categoryCount = new Map();
  const rowsForCategoryAudit = [];

  for await (const rawLine of rl) {
    lineNo += 1;
    let line = rawLine;
    if (lineNo === 1) line = line.replace(/^\uFEFF/, '');
    if (!line.trim()) continue;

    if (!header) {
      const cols = splitCsvLine(line).map((c) => c.replace(/^\uFEFF/, '').trim());
      header = cols;
      const need = ['IdPeaje', 'Peaje', 'CategoriaTarifa', 'Desde', 'Hasta', 'ValorTarifa', 'CantidadTrafico', 'CantidadEvasores', 'CantidadExentos787'];
      idx = {};
      for (const n of need) idx[n] = cols.indexOf(n);
      const missing = need.filter((n) => idx[n] === -1);
      if (missing.length) throw new Error(`El CSV no contiene las columnas: ${missing.join(', ')}`);
      continue;
    }

    const cells = splitCsvLine(line);
    if (cells.length < header.length) { skipped += 1; continue; }

    const idPeaje = String(cells[idx.IdPeaje] || '').replace(/"/g, '').trim();
    const peaje = String(cells[idx.Peaje] || '').replace(/"/g, '').trim();
    const categoria = String(cells[idx.CategoriaTarifa] || '').replace(/"/g, '').trim();
    const desdeRaw = cells[idx.Desde];
    const hastaRaw = cells[idx.Hasta];
    const tarifa = parseNumber(cells[idx.ValorTarifa]);
    const trafico = parseNumber(cells[idx.CantidadTrafico]);
    const evasores = parseNumber(cells[idx.CantidadEvasores]);
    const exentos = parseNumber(cells[idx.CantidadExentos787]);
    const periodo = parsePeriod(desdeRaw);
    const hasta = parsePeriod(hastaRaw);

    const sample = `Peaje ${peaje || '(sin nombre)'} · ${categoria} · ${String(desdeRaw || '').slice(0, 11)}`;

    if (!peaje) { skipped += 1; continue; }
    if (!periodo) bumpQuality('fecha_invalida', { trafico, sample });
    if (!idPeaje) bumpQuality('sin_id', { trafico, sample });
    if (trafico < 0) bumpQuality('trafico_negativo', { trafico, sample });
    if (evasores > trafico) bumpQuality('evasores_mayor_trafico', { trafico, sample });
    if (exentos > trafico) bumpQuality('exentos_mayor_trafico', { trafico, sample });
    if (tarifa === 0) bumpQuality('tarifa_cero', { trafico, sample });

    if (periodo && hasta) {
      const sameMonth = hasta.year === periodo.year && hasta.month === periodo.month;
      const span = (hasta.year - periodo.year) * 12 + (hasta.month - periodo.month);
      if (!sameMonth || span < 0) bumpQuality('periodo_inconsistente', { trafico, sample });
    } else if (periodo && !hasta) {
      bumpQuality('periodo_inconsistente', { trafico, sample });
    }

    const ym = periodo ? `${periodo.year}-${String(periodo.month).padStart(2, '0')}` : null;
    const key = `${idPeaje}|${peaje}|${categoria}|${ym}`;
    if (seenKeys.has(key)) bumpQuality('duplicado', { trafico, sample });
    seenKeys.add(key);

    categoryCount.set(categoria, (categoryCount.get(categoria) || 0) + 1);
    rowsForCategoryAudit.push(categoria);

    agg.add({
      idPeaje: Number(idPeaje) || 0,
      peaje,
      categoria,
      year: periodo ? periodo.year : null,
      month: periodo ? periodo.month : null,
      tarifa,
      trafico,
      evasores,
      exentos,
    });
  }

  // Categorías atípicas: presentes en menos del 0,2% de los registros.
  const totalRows = rowsForCategoryAudit.length;
  const rareCats = new Set();
  for (const [cat, n] of categoryCount) if (n / totalRows < 0.002) rareCats.add(cat);
  for (const cat of rowsForCategoryAudit) {
    if (rareCats.has(cat)) bumpQuality('categoria_atipica', { trafico: 0, sample: `Categoría ${cat}` });
  }
  // evita doble conteo de tráfico en muestras de categoría atípica
  quality.categoria_atipica.trafico = 0;

  const built = agg.finish({
    source: {
      file: path.basename(csvPath),
      bytes: fs.statSync(csvPath).size,
      rows: totalRows,
      skipped,
      loadedAt: new Date().toISOString(),
      loadMs: Date.now() - startedAt,
    },
    quality: Object.values(quality).map((q) => ({
      code: q.code,
      label: q.label,
      count: q.count,
      pct: totalRows ? (q.count / totalRows) * 100 : 0,
      samples: q.samples,
    })),
    rareCategories: [...rareCats].sort(),
  });

  return built;
}

module.exports = { loadDataset, parseNumber, parsePeriod, QUALITY_RULES, DEFAULT_CSV };
