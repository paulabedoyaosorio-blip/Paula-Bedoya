'use strict';
/**
 * Motor analítico: comparativos, estacionalidad, concentración, detección de
 * anomalías, pronóstico con estacionalidad y generación de hallazgos.
 */

const MONTH_LABELS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

const fmtInt = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 });
const fmtOne = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 1 });
const fmtTwo = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 2 });

function n0(v) { return fmtInt.format(Number.isFinite(v) ? Math.round(v) : 0); }
function n1(v) { return fmtOne.format(Number.isFinite(v) ? v : 0); }
function n2(v) { return fmtTwo.format(Number.isFinite(v) ? v : 0); }
function pct(v) { return `${n2(v)}%`; }

function fmtMoney(v) {
  const n = Number(v) || 0;
  const abs = Math.abs(n);
  if (abs >= 1e12) return `$${(n / 1e12).toFixed(2).replace('.', ',')} bill.`;
  if (abs >= 1e9) return `$${(n / 1e9).toFixed(1).replace('.', ',')} mil M`;
  if (abs >= 1e6) return `$${(n / 1e6).toFixed(1).replace('.', ',')} M`;
  return `$${n0(n)}`;
}

function shortMoney(v) {
  const n = Number(v) || 0;
  const abs = Math.abs(n);
  if (abs >= 1e12) return `${(n / 1e12).toFixed(2).replace('.', ',')} B`; // billones
  if (abs >= 1e9) return `${(n / 1e9).toFixed(1).replace('.', ',')} mM`; // miles de millones
  if (abs >= 1e6) return `${(n / 1e6).toFixed(1).replace('.', ',')} M`;
  return n0(n);
}

function monthLabel(ym) {
  if (!ym) return '—';
  const [y, m] = ym.split('-').map(Number);
  return `${MONTH_LABELS[m - 1]} ${y}`;
}

function addMonths(ym, k) {
  const [y, m] = ym.split('-').map(Number);
  const idx = y * 12 + (m - 1) + k;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`;
}

/** Periodo inmediatamente anterior de igual longitud. */
function previousPeriod(desde, hasta, months) {
  const i0 = months.indexOf(desde);
  const i1 = months.indexOf(hasta);
  if (i0 < 0 || i1 < 0) return null;
  const len = i1 - i0 + 1;
  const p1 = i0 - 1;
  const p0 = p1 - len + 1;
  if (p1 < 0 || p0 < 0) return null;
  return { desde: months[p0], hasta: months[p1], len };
}

function delta(actual, prev) {
  if (!Number.isFinite(prev) || prev === 0) return { pct: null, abs: actual - prev };
  return { pct: ((actual - prev) / Math.abs(prev)) * 100, abs: actual - prev };
}

/** Regresión lineal simple y = a + b·x */
function ols(xs, ys) {
  const n = xs.length;
  if (n < 2) return { a: ys[0] || 0, b: 0, r2: 0 };
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  const b = sxx === 0 ? 0 : sxy / sxx;
  const a = my - b * mx;
  const r2 = sxx === 0 || syy === 0 ? 0 : (sxy * sxy) / (sxx * syy);
  return { a, b, r2 };
}

/**
 * Índices de estacionalidad multiplicativos (media de cada mes calendario
 * respecto a la tendencia del año). Devuelve 12 índices centrados en 1.
 */
function seasonality(months, values) {
  const byMonth = Array.from({ length: 12 }, () => []);
  const annualAvg = new Map();
  const acc = new Map();
  months.forEach((ym, i) => {
    const [y, m] = ym.split('-').map(Number);
    if (!acc.has(y)) acc.set(y, { sum: 0, n: 0 });
    const a = acc.get(y);
    a.sum += values[i];
    a.n += 1;
  });
  for (const [y, a] of acc) annualAvg.set(y, a.n ? a.sum / a.n : 0);
  months.forEach((ym, i) => {
    const [y, m] = ym.split('-').map(Number);
    const avg = annualAvg.get(y);
    if (avg > 0) byMonth[m - 1].push(values[i] / avg);
  });
  const idx = byMonth.map((arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 1));
  const mean = idx.reduce((a, b) => a + b, 0) / 12 || 1;
  return idx.map((v) => (mean ? v / mean : 1));
}

/**
 * Pronóstico con tendencia lineal sobre serie desestacionalizada + índices
 * estacionales mensuales. Incluye validación en los últimos 6 meses.
 */
function forecast(months, values, { horizon = 12, window = 36 } = {}) {
  const n = months.length;
  const h = Math.max(1, Math.min(36, Math.floor(horizon)));
  if (!n) return { months: [], values: [], lo: [], hi: [], method: 'Sin datos', accuracy: null };

  const use = Math.min(window, n);
  const start = n - use;
  const histMonths = months.slice(start);
  const histValues = values.slice(start);

  const seasonal = seasonality(histMonths, histValues);
  const deseason = histValues.map((v, i) => {
    const m = Number(histMonths[i].split('-')[1]) - 1;
    return seasonal[m] > 0 ? v / seasonal[m] : v;
  });

  const fit = ols(histMonths.map((_, i) => i), deseason);
  // Error estándar de la regresión sobre la serie desestacionalizada
  const resid = deseason.map((v, i) => v - (fit.a + fit.b * i));
  const dof = Math.max(1, use - 2);
  const sigma = Math.sqrt(resid.reduce((a, e) => a + e * e, 0) / dof);

  const out = { months: [], values: [], lo: [], hi: [], low: [], high: [] };
  const lastMonth = months[n - 1];
  const baseIndex = n - 1 - start;
  for (let k = 1; k <= h; k++) {
    const ym = addMonths(lastMonth, k);
    const mIdx = Number(ym.split('-')[1]) - 1;
    const trend = fit.a + fit.b * (baseIndex + k);
    const se = Math.max(0.01, seasonal[mIdx]);
    const v = Math.max(0, trend * se);
    const band = 1.645 * sigma * se * Math.sqrt(1 + k / use); // ~90%
    out.months.push(ym);
    out.values.push(v);
    out.low.push(Math.max(0, v - band));
    out.high.push(v + band);
  }
  out.lo = out.low;
  out.hi = out.high;

  // Backtesting: entrena sin los últimos 6 meses y mide error
  let accuracy = null;
  if (n >= 18) {
    const cut = 6;
    const trMonths = months.slice(0, n - cut);
    const trValues = values.slice(0, n - cut);
    const testMonths = months.slice(n - cut);
    const testValues = values.slice(n - cut);
    const seas = seasonality(trMonths, trValues);
    const des = trValues.map((v, i) => {
      const m = Number(trMonths[i].split('-')[1]) - 1;
      return seas[m] > 0 ? v / seas[m] : v;
    });
    const f = ols(trMonths.map((_, i) => i), des);
    let ape = 0;
    let hits = 0;
    testMonths.forEach((ym, k) => {
      const m = Number(ym.split('-')[1]) - 1;
      const pred = Math.max(0, (f.a + f.b * (trMonths.length + k)) * seas[m]);
      const actual = testValues[k];
      if (actual > 0) ape += Math.abs((actual - pred) / actual);
      if (Math.abs(actual - pred) / (actual || 1) <= 0.1) hits += 1;
    });
    accuracy = {
      mape: (ape / testMonths.length) * 100,
      precision: (hits / testMonths.length) * 100,
      testMonths,
      testValues,
    };
  }

  out.method = `Tendencia lineal sobre serie desestacionalizada (ventana ${use} meses) + índices estacionales mensuales`;
  out.trendSlope = fit.b;
  out.r2 = fit.r2;
  out.seasonal = seasonal;
  out.accuracy = accuracy;
  out.window = use;
  out.trendMonthlyPct = histValues.length
    ? (fit.b / (histValues.reduce((a, b) => a + b, 0) / histValues.length)) * 100
    : 0;
  return out;
}

/** Detecta meses atípicos por z-score robusto (MAD) sobre la serie. */
function anomalies(months, values, threshold = 3) {
  const n = values.length;
  if (n < 8) return [];
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const sorted = [...values].sort((a, b) => a - b);
  const median = sorted[Math.floor(n / 2)];
  const devs = values.map((v) => Math.abs(v - median)).sort((a, b) => a - b);
  const mad = devs[Math.floor(n / 2)] || 0;
  const sd = Math.sqrt(values.reduce((a, v) => a + (v - mean) ** 2, 0) / n);
  const scale = mad ? 1.4826 * mad : sd;
  if (!scale) return [];
  const out = [];
  values.forEach((v, i) => {
    const z = (v - mean) / scale;
    if (Math.abs(z) >= threshold) out.push({ month: months[i], value: v, z });
  });
  return out.sort((a, b) => Math.abs(b.z) - Math.abs(a.z)).slice(0, 12);
}

/** Concentración del tráfico entre peajes (HHI y participación del top N). */
function concentration(ranked) {
  const total = ranked.reduce((a, r) => a + r.trafico, 0);
  if (!total) return { hhi: 0, top10: 0, top5: 0, n: 0, gini: 0 };
  const shares = ranked.map((r) => r.trafico / total).sort((a, b) => a - b);
  const hhi = shares.reduce((a, s) => a + s * s, 0) * 10000;
  const top = (k) => (ranked.slice(0, k).reduce((a, r) => a + r.trafico, 0) / total) * 100;
  let cum = 0;
  let giniNum = 0;
  shares.forEach((s, i) => {
    cum += s;
    giniNum += (i + 1) * s;
  });
  const n = shares.length;
  const gini = n > 1 ? (2 * giniNum) / n - (n + 1) / n : 0;
  return { hhi, top5: top(5), top10: top(10), n, gini: Math.max(0, gini) };
}

/** Estima recaudo con escenarios sobre el pronóstico de tráfico. */
function estimate(forecastResult, options = {}) {
  const {
    tarifaPromedio = 0,
    tarifaGrowthPct = 0,
    trafficAdjustPct = 0,
    tarifaOverride = null,
    tasaEvasion = 0,
  } = options;

  const months = forecastResult.months;
  const traffic = forecastResult.values.map((v) => v * (1 + trafficAdjustPct / 100));
  const tarifaBase = tarifaOverride && tarifaOverride > 0 ? tarifaOverride : tarifaPromedio;
  const rows = months.map((ym, k) => {
    const tarifa = tarifaBase * (1 + tarifaGrowthPct / 100) ** (k + 1);
    const recaudo = traffic[k] * tarifa;
    return {
      month: ym,
      trafico: traffic[k],
      traficoBase: forecastResult.values[k],
      tarifa,
      recaudo,
      recaudoAjustado: recaudo * (1 - tasaEvasion / 100),
    };
  });
  const totalTrafico = rows.reduce((a, r) => a + r.trafico, 0);
  const totalRecaudo = rows.reduce((a, r) => a + r.recaudo, 0);
  return {
    rows,
    totalTrafico,
    totalRecaudo,
    tarifaPromedio: totalTrafico > 0 ? totalRecaudo / totalTrafico : 0,
    tarifaBase,
    months: months.length,
  };
}

/** Construye todos los insumos del tablero para un conjunto de filtros. */
function buildAnalysis(ds, filters = {}) {
  const { desde, hasta, peajes = null, categorias = null } = filters;
  const series = ds.series({ desde, hasta, peajes, categorias });
  const totals = ds.totals({ desde, hasta, peajes, categorias });
  const prev = previousPeriod(series.desde, series.hasta, ds.months);
  const prevTotals = prev ? ds.totals({ desde: prev.desde, hasta: prev.hasta, peajes, categorias }) : null;

  const ranked = ds.rankPeajes({ desde, hasta, categorias });
  const cats = ds.rankCategorias({ peajes, desde, hasta });
  const conc = concentration(ranked);

  const yearly = new Map();
  series.months.forEach((ym, i) => {
    const y = ym.split('-')[0];
    const acc = yearly.get(y) || { year: y, trafico: 0, evasores: 0, exentos: 0, recaudo: 0, meses: 0 };
    acc.trafico += series.trafico[i];
    acc.evasores += series.evasores[i];
    acc.exentos += series.exentos[i];
    acc.recaudo += series.recaudo[i];
    acc.meses += 1;
    yearly.set(y, acc);
  });
  const years = [...yearly.values()].map((y) => ({
    ...y,
    tarifaPromedio: y.trafico > 0 ? y.recaudo / y.trafico : 0,
    tasaEvasion: y.trafico + y.evasores > 0 ? (y.evasores / (y.trafico + y.evasores)) * 100 : 0,
  }));

  const seasonal = seasonality(series.months, series.trafico);
  const anomalyList = anomalies(series.months, series.trafico);

  const cagr = (() => {
    const full = years.filter((y) => y.meses === 12);
    if (full.length < 2) return null;
    const first = full[0];
    const last = full[full.length - 1];
    const nYears = Number(last.year) - Number(first.year);
    if (nYears <= 0 || first.trafico <= 0) return null;
    return { value: ((last.trafico / first.trafico) ** (1 / nYears) - 1) * 100, from: first.year, to: last.year, nYears };
  })();

  return {
    filters: { desde: series.desde, hasta: series.hasta, peajes: peajes || [], categorias: categorias || [] },
    series: {
      months: series.months,
      desde: series.desde,
      hasta: series.hasta,
      trafico: Array.from(series.trafico),
      evasores: Array.from(series.evasores),
      exentos: Array.from(series.exentos),
      recaudo: Array.from(series.recaudo),
    },
    totals,
    prevTotals,
    deltas: prevTotals ? {
      trafico: delta(totals.trafico, prevTotals.trafico),
      recaudo: delta(totals.recaudo, prevTotals.recaudo),
      evasores: delta(totals.evasores, prevTotals.evasores),
      exentos: delta(totals.exentos, prevTotals.exentos),
      tarifaPromedio: delta(totals.tarifaPromedio, prevTotals.tarifaPromedio),
    } : null,
    ranking: ranked,
    categorias: cats,
    concentration: conc,
    yearly: years,
    seasonal,
    anomalies: anomalyList,
    cagr,
    quality: ds.quality,
    rareCategories: ds.rareCategories,
  };
}

/** Hallazgos y recomendaciones redactados a partir de los números. */
function findings(analysis, ds) {
  const out = [];
  const t = analysis.totals;
  const y = analysis.yearly;
  const c = analysis.concentration;

  if (t.trafico > 0) {
    out.push({
      type: 'contexto',
      text: `En el periodo ${monthLabel(analysis.series.months[0])} – ${monthLabel(analysis.series.months[analysis.series.months.length - 1])} se registraron ${n0(t.trafico)} pasos vehiculares, un recaudo de ${fmtMoney(t.recaudo)} y una tarifa promedio de ${fmtMoney(t.tarifaPromedio)} por paso.`,
    });
  }
  if (analysis.deltas && analysis.deltas.trafico.pct !== null) {
    const d = analysis.deltas.trafico.pct;
    out.push({
      type: d >= 0 ? 'positivo' : 'negativo',
      text: `El tráfico ${d >= 0 ? 'creció' : 'cayó'} ${pct(Math.abs(d))} frente al periodo anterior comparable (${monthLabel(analysis.prevTotals.from)} – ${monthLabel(analysis.prevTotals.to)}), con una variación de ${n0(analysis.deltas.trafico.abs)} pasos.`,
    });
  }
  if (analysis.cagr) {
    out.push({
      type: analysis.cagr.value >= 0 ? 'positivo' : 'negativo',
      text: `La tasa de crecimiento anual compuesta (CAGR) del tráfico entre ${analysis.cagr.from} y ${analysis.cagr.to} fue de ${pct(analysis.cagr.value)}.`,
    });
  }
  if (c.n > 1) {
    const nivel = c.hhi > 2500 ? 'alta' : c.hhi > 1500 ? 'moderada' : 'baja';
    out.push({
      type: 'estructura',
      text: `La concentración del tráfico entre peajes es ${nivel}: los 5 primeros explican ${pct(c.top5)} y los 10 primeros ${pct(c.top10)} del total (HHI ${n0(c.hhi)}).`,
    });
  }
  if (analysis.ranking.length) {
    const top = analysis.ranking[0];
    out.push({
      type: 'estructura',
      text: `El peaje con mayor tráfico es ${top.peaje} con ${n0(top.trafico)} pasos (${pct((top.trafico / (t.trafico || 1)) * 100)} del total filtrado).`,
    });
  }
  if (analysis.categorias.length) {
    const light = ['I', 'II', 'IIA', 'IE', 'IE1', 'IE2', 'UE', 'UNICA'];
    const lightShare = analysis.categorias.filter((x) => light.includes(x.categoria)).reduce((a, x) => a + x.trafico, 0) / (t.trafico || 1) * 100;
    if (lightShare > 0) out.push({ type: 'composicion', text: `Los vehículos livianos (categorías I y II con sus variantes) representan ${pct(lightShare)} del tráfico observado.` });
  }
  const quarantined = ds.quality.find((q) => q.code === 'tarifa_cero');
  if (quarantined && quarantined.count) {
    out.push({
      type: 'calidad',
      text: `El ${pct(quarantined.pct)} de los registros reporta tarifa cero, lo que implica que el recaudo calculado (tarifa × tráfico) es una cota inferior del recaudo real.`,
    });
  }
  const evasionPeak = analysis.yearly.reduce((best, cur) => (!best || cur.tasaEvasion > best.tasaEvasion ? cur : best), null);
  if (evasionPeak && evasionPeak.tasaEvasion > 0.05) {
    out.push({
      type: 'alerta',
      text: `La tasa de evasión más alta del periodo se registra en ${evasionPeak.year} (${pct(evasionPeak.tasaEvasion)}, ${n0(evasionPeak.evasores)} eventos). Conviene verificar si corresponde a un cambio de reporte o a un fenómeno operativo real.`,
    });
  }
  if (analysis.anomalies.length) {
    const a = analysis.anomalies[0];
    out.push({
      type: 'alerta',
      text: `Se identificaron ${analysis.anomalies.length} mes(es) atípico(s); el más extremo es ${monthLabel(a.month)} con ${n0(a.value)} pasos (z=${n1(a.z)}).`,
    });
  }
  const bestMonth = analysis.seasonal.indexOf(Math.max(...analysis.seasonal));
  const worstMonth = analysis.seasonal.indexOf(Math.min(...analysis.seasonal));
  if (Number.isFinite(bestMonth)) {
    out.push({
      type: 'patron',
      text: `Estacionalidad: ${MONTH_LABELS[bestMonth]} es el mes con mayor índice de tráfico (${n2(analysis.seasonal[bestMonth] * 100)}% del promedio) y ${MONTH_LABELS[worstMonth]} el de menor (${n2(analysis.seasonal[worstMonth] * 100)}%).`,
    });
  }
  return out;
}

function recommendations(analysis, estimation) {
  const recs = [];
  if (estimation) {
    recs.push(`Programar el recaudo esperado de ${fmtMoney(estimation.totalRecaudo)} para los próximos ${estimation.months} meses y contrastarlo mensualmente contra el recaudo observado.`);
  }
  if (analysis.concentration.top10 > 60) {
    recs.push('Priorizar mantenimiento e interoperabilidad en los peajes del top 10, que concentran la mayor parte del tráfico y del recaudo.');
  }
  recs.push('Depurar los registros con tarifa cero y validar la fuente antes de usar el recaudo como cifra oficial, dado que el indicador se calcula como tarifa reportada × tráfico.');
  recs.push('Incorporar al reporte la comparación año corrido contra el mismo periodo del año anterior para separar efecto estacional de cambios estructurales.');
  if (analysis.anomalies.length) recs.push('Auditar los meses atípicos detectados y documentar sus causas (cierres, cambios de concesión, migraciones de reporte).');
  recs.push('Actualizar el tablero cada vez que la ANI publique un nuevo corte de datos para mantener la serie y el pronóstico al día.');
  return recs;
}

/** Envuelve todo lo necesario para renderizar el PDF. */
function buildReportData(ds, params) {
  const filters = {
    desde: params.desde || null,
    hasta: params.hasta || null,
    peajes: params.peajes || [],
    categorias: params.categorias || [],
  };
  const analysis = buildAnalysis(ds, filters);
  const targetPeaje = params.estimacion?.peaje || (filters.peajes.length === 1 ? filters.peajes[0] : null);
  const horizon = Number(params.estimacion?.horizonte) || 12;
  const window = Number(params.estimacion?.ventana) || 36;

  const baseSeries = targetPeaje
    ? ds.peajeSeries(targetPeaje, { categorias: filters.categorias })
    : ds.series({ desde: filters.desde, hasta: filters.hasta, peajes: filters.peajes.length ? filters.peajes : null, categorias: filters.categorias });

  const histMonths = targetPeaje ? ds.months : baseSeries.months;
  const histValues = targetPeaje ? Array.from(baseSeries.trafico) : Array.from(baseSeries.trafico);

  const fc = forecast(histMonths, histValues, { horizon, window });
  const tarifaPromedio = analysis.totals.tarifaPromedio;
  const est = estimate(fc, {
    tarifaPromedio,
    tarifaGrowthPct: Number(params.estimacion?.tarifaGrowthPct) || 0,
    trafficAdjustPct: Number(params.estimacion?.trafficAdjustPct) || 0,
    tarifaOverride: Number(params.estimacion?.tarifaOverride) || null,
    tasaEvasion: analysis.totals.tasaEvasion,
  });

  return {
    meta: {
      titulo: params.titulo || 'Informe de tráfico vehicular — peajes ANI',
      autor: params.autor || '',
      entidad: params.entidad || '',
      notas: params.notas || '',
      generado: new Date().toISOString(),
      secciones: params.secciones || {},
    },
    filters,
    targetPeaje,
    analysis,
    forecast: fc,
    estimation: est,
    findings: findings(analysis, ds),
    recommendations: recommendations(analysis, est),
    source: ds.source,
  };
}

module.exports = {
  buildAnalysis,
  buildReportData,
  forecast,
  estimate,
  seasonality,
  anomalies,
  concentration,
  findings,
  recommendations,
  previousPeriod,
  monthLabel,
  addMonths,
  MONTH_LABELS,
  n0, n1, n2, pct, fmtMoney, shortMoney,
};
