'use strict';
/**
 * Pre-agregación de los datos en un cubo disperso
 * (peaje × categoría × mes) con series mensuales tipadas.
 *
 * Con esto cualquier combinación de filtros (conjunto de peajes, categorías y
 * rango de meses) se resuelve sumando series, sin volver a recorrer el CSV.
 */

const METRICS = ['trafico', 'evasores', 'exentos', 'recaudo'];

function aggregateBuffer() {
  /** @type {Map<string, Map<string, number[]>>} clave = peaje\u0001categoria -> ym -> [t,e,x,r] */
  const cube = new Map();
  /** @type {Map<string, {id:number, meses:Set<string>}>} */
  const peajeMeta = new Map();
  const catSet = new Set();
  const monthSet = new Set();

  function add(row) {
    const { peaje, categoria, year, month, tarifa, trafico, evasores, exentos } = row;
    catSet.add(categoria);
    const meta = peajeMeta.get(peaje) || { id: row.idPeaje, meses: new Set(), registros: 0 };
    peajeMeta.set(peaje, meta);
    meta.registros += 1;
    if (!year || !month) return;
    const ym = `${year}-${String(month).padStart(2, '0')}`;
    monthSet.add(ym);
    meta.meses.add(ym);

    const key = `${peaje}\u0001${categoria}`;
    let months = cube.get(key);
    if (!months) { months = new Map(); cube.set(key, months); }
    let acc = months.get(ym);
    if (!acc) { acc = [0, 0, 0, 0]; months.set(ym, acc); }
    acc[0] += trafico;
    acc[1] += evasores;
    acc[2] += exentos;
    acc[3] += tarifa * Math.max(trafico, 0);
  }

  function finish(extra = {}) {
    const months = [...monthSet].sort();
    const monthIndex = new Map(months.map((m, i) => [m, i]));
    const n = months.length;

    /** Cubo final: peaje -> categoria -> Float64Array[n] por métrica */
    const cubeSeries = new Map();
    const byPeaje = new Map();
    const byCategoria = new Map();
    const byPeajeCategoria = [];

    const newSeries = () => Object.fromEntries(METRICS.map((m) => [m, new Float64Array(n)]));
    const addSeries = (target, source) => { for (const m of METRICS) for (let i = 0; i < n; i++) target[m][i] += source[m][i]; };

    for (const [key, monthsMap] of cube) {
      const [peaje, categoria] = key.split('\u0001');
      const series = newSeries();
      for (const [ym, acc] of monthsMap) {
        const i = monthIndex.get(ym);
        if (i === undefined) continue;
        for (let k = 0; k < 4; k++) series[METRICS[k]][i] += acc[k];
      }
      if (!cubeSeries.has(peaje)) cubeSeries.set(peaje, new Map());
      cubeSeries.get(peaje).set(categoria, series);

      if (!byPeaje.has(peaje)) byPeaje.set(peaje, newSeries());
      addSeries(byPeaje.get(peaje), series);

      if (!byCategoria.has(categoria)) byCategoria.set(categoria, newSeries());
      addSeries(byCategoria.get(categoria), series);

      const totals = { peaje, categoria };
      for (const m of METRICS) totals[m] = series[m].reduce((a, b) => a + b, 0);
      byPeajeCategoria.push(totals);
    }

    const national = newSeries();
    for (const s of byPeaje.values()) addSeries(national, s);

    const peajes = [...peajeMeta.entries()]
      .map(([nombre, meta]) => {
        const s = byPeaje.get(nombre);
        const totals = { peaje: nombre, id: meta.id, registros: meta.registros, meses: meta.meses.size, first: [...meta.meses].sort()[0], last: [...meta.meses].sort().slice(-1)[0] };
        for (const m of METRICS) totals[m] = s ? s[m].reduce((a, b) => a + b, 0) : 0;
        const serie = s ? s.trafico : new Float64Array(n);
        // primer y último mes con tráfico > 0
        let firstActive = null;
        let lastActive = null;
        for (let i = 0; i < n; i++) if (serie[i] > 0) { if (firstActive === null) firstActive = i; lastActive = i; }
        totals.primerMesActivo = firstActive === null ? null : months[firstActive];
        totals.ultimoMesActivo = lastActive === null ? null : months[lastActive];
        return totals;
      })
      .sort((a, b) => a.peaje.localeCompare(b.peaje, 'es'));

    const categorias = [...catSet].sort((a, b) => a.localeCompare(b, 'es')).map((categoria) => {
      const s = byCategoria.get(categoria);
      const totals = { categoria };
      for (const m of METRICS) totals[m] = s[m].reduce((a, b) => a + b, 0);
      totals.tarifaPromedio = totals.trafico > 0 ? totals.recaudo / totals.trafico : 0;
      return totals;
    });

    return {
      ...extra,
      months,
      monthIndex,
      national,
      cubeSeries,
      byPeaje,
      byCategoria,
      byPeajeCategoria,
      peajes,
      categorias,
      /** @type {number} */
      n,
      /* -------- consultas -------- */

      /** Suma las series del cubo para los filtros dados. */
      series({ peajes = null, categorias = null, desde = null, hasta = null } = {}) {
        const i0 = desde && monthIndex.has(desde) ? monthIndex.get(desde) : 0;
        const i1 = hasta && monthIndex.has(hasta) ? monthIndex.get(hasta) : n - 1;
        const lo = Math.min(i0, i1);
        const hi = Math.max(i0, i1);
        const out = newSeries();
        const pSet = peajes && peajes.length ? new Set(peajes) : null;
        const cSet = categorias && categorias.length ? new Set(categorias) : null;
        for (const [peaje, cats] of cubeSeries) {
          if (pSet && !pSet.has(peaje)) continue;
          for (const [cat, s] of cats) {
            if (cSet && !cSet.has(cat)) continue;
            for (const m of METRICS) {
              const target = out[m];
              const src = s[m];
              for (let i = lo; i <= hi; i++) target[i] += src[i];
            }
          }
        }
        const labels = months.slice(lo, hi + 1);
        const sliced = {};
        for (const m of METRICS) sliced[m] = out[m].slice(lo, hi + 1);
        return {
          months: labels,
          desde: labels[0] || null,
          hasta: labels[labels.length - 1] || null,
          ...sliced,
        };
      },

      /** Totales del periodo + indicadores derivados. */
      totals(filters) {
        const s = this.series(filters);
        return {
          ...summarize(s),
          from: s.desde,
          to: s.hasta,
          meses: s.months.length,
        };
      },

      /** Ranking de peajes dentro del filtro. */
      rankPeajes({ categorias = null, desde = null, hasta = null, limit = null } = {}) {
        const i0 = desde && monthIndex.has(desde) ? monthIndex.get(desde) : 0;
        const i1 = hasta && monthIndex.has(hasta) ? monthIndex.get(hasta) : n - 1;
        const cSet = categorias && categorias.length ? new Set(categorias) : null;
        const rows = [];
        for (const p of peajes) {
          const totals = { peaje: p.peaje, id: p.id, trafico: 0, evasores: 0, exentos: 0, recaudo: 0 };
          const cats = cubeSeries.get(p.peaje);
          if (cats) {
            for (const [cat, s] of cats) {
              if (cSet && !cSet.has(cat)) continue;
              for (let i = i0; i <= i1; i++) {
                totals.trafico += s.trafico[i];
                totals.evasores += s.evasores[i];
                totals.exentos += s.exentos[i];
                totals.recaudo += s.recaudo[i];
              }
            }
          }
          if (totals.trafico > 0 || totals.recaudo > 0) {
            rows.push({ ...totals, ...ratios(totals) });
          }
        }
        rows.sort((a, b) => b.trafico - a.trafico);
        return limit ? rows.slice(0, limit) : rows;
      },

      /** Ranking de categorías dentro del filtro. */
      rankCategorias({ peajes = null, desde = null, hasta = null } = {}) {
        const i0 = desde && monthIndex.has(desde) ? monthIndex.get(desde) : 0;
        const i1 = hasta && monthIndex.has(hasta) ? monthIndex.get(hasta) : n - 1;
        const pSet = peajes && peajes.length ? new Set(peajes) : null;
        const map = new Map();
        for (const [peaje, cats] of cubeSeries) {
          if (pSet && !pSet.has(peaje)) continue;
          for (const [cat, s] of cats) {
            let acc = map.get(cat);
            if (!acc) { acc = { categoria: cat, trafico: 0, evasores: 0, exentos: 0, recaudo: 0 }; map.set(cat, acc); }
            for (let i = i0; i <= i1; i++) {
              acc.trafico += s.trafico[i];
              acc.evasores += s.evasores[i];
              acc.exentos += s.exentos[i];
              acc.recaudo += s.recaudo[i];
            }
          }
        }
        return [...map.values()]
          .filter((r) => r.trafico > 0 || r.recaudo > 0)
          .map((r) => ({ ...r, ...ratios(r) }))
          .sort((a, b) => b.trafico - a.trafico);
      },

      /** Matriz peaje × categoría (totales) para el filtro de periodo. */
      matrix({ desde = null, hasta = null } = {}) {
        const i0 = desde && monthIndex.has(desde) ? monthIndex.get(desde) : 0;
        const i1 = hasta && monthIndex.has(hasta) ? monthIndex.get(hasta) : n - 1;
        const rows = [];
        for (const [peaje, cats] of cubeSeries) {
          for (const [cat, s] of cats) {
            let t = 0, e = 0, x = 0, r = 0;
            for (let i = i0; i <= i1; i++) { t += s.trafico[i]; e += s.evasores[i]; x += s.exentos[i]; r += s.recaudo[i]; }
            if (t > 0 || r > 0) rows.push({ peaje, categoria: cat, trafico: t, evasores: e, exentos: x, recaudo: r });
          }
        }
        return rows;
      },

      /** Serie de un peaje (todas las categorías) para pronóstico. */
      peajeSeries(nombre, { categorias = null } = {}) {
        const cats = cubeSeries.get(nombre);
        const out = newSeries();
        if (cats) {
          const cSet = categorias && categorias.length ? new Set(categorias) : null;
          for (const [cat, s] of cats) {
            if (cSet && !cSet.has(cat)) continue;
            for (const m of METRICS) for (let i = 0; i < n; i++) out[m][i] += s[m][i];
          }
        }
        return out;
      },
    };
  }

  return { add, finish };
}

function ratios(t) {
  const baseE = t.trafico + t.evasores;
  const baseX = t.trafico + t.exentos;
  return {
    tasaEvasion: baseE > 0 ? (t.evasores / baseE) * 100 : 0,
    tasaExencion: baseX > 0 ? (t.exentos / baseX) * 100 : 0,
    tarifaPromedio: t.trafico > 0 ? t.recaudo / t.trafico : 0,
    recaudoPotencial: t.recaudo + (t.trafico > 0 ? (t.evasores * t.recaudo) / t.trafico : 0),
  };
}

function summarize(series) {
  const sum = (arr) => arr.reduce((a, b) => a + b, 0);
  const t = {
    trafico: sum(series.trafico),
    evasores: sum(series.evasores),
    exentos: sum(series.exentos),
    recaudo: sum(series.recaudo),
  };
  return { ...t, ...ratios(t), meses: series.months.length };
}

module.exports = { aggregateBuffer, summarize, ratios, METRICS };
