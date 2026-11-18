/* global Chart */
'use strict';

/* ------------------------------- utilidades ------------------------------- */

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

const nf0 = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 2 });
const compact = new Intl.NumberFormat('es-CO', { notation: 'compact', maximumFractionDigits: 1 });

const n0 = (v) => nf0.format(Math.round(Number(v) || 0));
const n1 = (v) => nf1.format(Number(v) || 0);
const n2 = (v) => nf2.format(Number(v) || 0);
const pct = (v) => `${n2(v)}%`;

function money(v) {
  const n = Number(v) || 0;
  const a = Math.abs(n);
  if (a >= 1e12) return `$${(n / 1e12).toFixed(2).replace('.', ',')} bill.`;
  if (a >= 1e9) return `$${(n / 1e9).toFixed(1).replace('.', ',')} mil M`;
  if (a >= 1e6) return `$${(n / 1e6).toFixed(1).replace('.', ',')} M`;
  return `$${n0(n)}`;
}

const MONTHS_ES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
function monthLabel(ym) {
  if (!ym) return '—';
  const [y, m] = ym.split('-').map(Number);
  return `${MONTHS_ES[m - 1]} ${y}`;
}
function shortMonth(ym) {
  const [y, m] = ym.split('-');
  return `${m}/${y.slice(2)}`;
}

const COLORS = {
  navy: '#1e3a8a', blue: '#2563eb', teal: '#0f766e', orange: '#ea580c',
  red: '#b91c1c', green: '#15803d', slate: '#475569', grid: '#e8eef7',
};
const PALETTE = ['#1e3a8a', '#0e7490', '#ea580c', '#15803d', '#7c3aed', '#b45309', '#0891b2', '#be123c', '#4d7c0f', '#6366f1', '#0f766e', '#9d174d'];

Chart.defaults.font.family = '"Inter", "Segoe UI", system-ui, sans-serif';
Chart.defaults.font.size = 11;
Chart.defaults.color = '#64748b';

const state = {
  meta: null,
  filters: { desde: null, hasta: null, peajes: [], categorias: [] },
  analysis: null,
  charts: {},
  estimate: null,
  view: 'resumen',
  pdfUrl: null,
};

function toast(msg, isError = false) {
  const el = $('#toast');
  el.textContent = msg;
  el.className = `toast${isError ? ' error' : ''}`;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.hidden = true; }, 3600);
}

function debounce(fn, ms = 250) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

function chart(key, canvasId, config) {
  if (state.charts[key]) state.charts[key].destroy();
  const ctx = document.getElementById(canvasId);
  if (!ctx) return null;
  const c = new Chart(ctx, config);
  state.charts[key] = c;
  return c;
}

const moneyAxis = (v) => `$${compact.format(v)}`;
const numAxis = (v) => compact.format(v);

function gridX(maxRotation = 0) {
  return { grid: { display: false }, border: { display: false }, ticks: { maxRotation, autoSkipPadding: 14, font: { size: 10 } } };
}
function gridY(cb = numAxis, title = undefined) {
  return {
    beginAtZero: true,
    grid: { color: COLORS.grid, drawTicks: false },
    border: { display: false },
    title: title ? { display: true, text: title, font: { size: 10 }, color: '#94a3b8' } : undefined,
    ticks: { callback: cb, font: { size: 10 } },
  };
}
const legendBottom = {
  position: 'bottom',
  labels: { usePointStyle: true, boxWidth: 8, boxHeight: 8, padding: 16, font: { size: 10.5 } },
};

/* --------------------------------- API ----------------------------------- */

async function api(path, opts) {
  const res = await fetch(path, opts);
  if (!res.ok) throw new Error(`Error ${res.status} en ${path}`);
  return res.json();
}

function queryFromFilters(extra = {}) {
  const p = new URLSearchParams();
  const f = state.filters;
  if (f.desde) p.set('desde', f.desde);
  if (f.hasta) p.set('hasta', f.hasta);
  if (f.peajes.length) p.set('peajes', f.peajes.join('|'));
  if (f.categorias.length) p.set('categorias', f.categorias.join('|'));
  for (const [k, v] of Object.entries(extra)) {
    if (v !== null && v !== undefined && v !== '') p.set(k, v);
  }
  return p.toString();
}

/* ------------------------------- filtros UI ------------------------------ */

function buildMulti(root, items, key, { label, valueLabel, extraLabel } = {}) {
  root.innerHTML = '';
  const trigger = document.createElement('button');
  trigger.className = 'multi-trigger';
  trigger.type = 'button';
  const panel = document.createElement('div');
  panel.className = 'multi-panel';

  const search = document.createElement('input');
  search.type = 'search';
  search.placeholder = `Buscar ${label}…`;
  const actions = document.createElement('div');
  actions.className = 'multi-actions';
  const allBtn = document.createElement('button');
  allBtn.type = 'button';
  allBtn.textContent = 'Todos';
  const noneBtn = document.createElement('button');
  noneBtn.type = 'button';
  noneBtn.textContent = 'Ninguno';
  actions.append(allBtn, noneBtn);
  const list = document.createElement('div');
  list.className = 'multi-list';

  const renderList = (filterText = '') => {
    const q = filterText.trim().toLowerCase();
    list.innerHTML = '';
    const visible = items.filter((it) => !q || valueLabel(it).toLowerCase().includes(q));
    if (!visible.length) {
      list.innerHTML = '<div class="note">Sin resultados</div>';
      return;
    }
    for (const it of visible) {
      const v = valueLabel(it);
      const row = document.createElement('label');
      row.className = 'multi-item';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.value = v;
      cb.checked = state.filters[key].includes(v);
      cb.addEventListener('change', () => {
        const list2 = state.filters[key];
        if (cb.checked) { if (!list2.includes(v)) list2.push(v); } else {
          const i = list2.indexOf(v);
          if (i >= 0) list2.splice(i, 1);
        }
        syncTrigger();
        scheduleRefresh();
      });
      const span = document.createElement('span');
      span.textContent = v;
      row.append(cb, span);
      if (extraLabel) {
        const t = document.createElement('span');
        t.className = 'tr';
        t.textContent = extraLabel(it);
        row.append(t);
      }
      list.append(row);
    }
  };

  const syncTrigger = () => {
    const sel = state.filters[key];
    trigger.textContent = !sel.length ? `Todos (${items.length})` : sel.length === 1 ? sel[0] : `${sel.length} seleccionados`;
    const counter = key === 'peajes' ? $('#peajeCount') : $('#catCount');
    if (counter) counter.textContent = !sel.length ? (key === 'peajes' ? 'todos' : 'todas') : `${sel.length} de ${items.length}`;
  };

  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = root.classList.contains('open');
    $$('.multi.open').forEach((m) => m.classList.remove('open'));
    if (!open) { root.classList.add('open'); search.focus(); }
  });
  panel.addEventListener('click', (e) => e.stopPropagation());
  search.addEventListener('input', () => renderList(search.value));
  allBtn.addEventListener('click', () => {
    state.filters[key] = items.map(valueLabel);
    renderList(search.value); syncTrigger(); scheduleRefresh();
  });
  noneBtn.addEventListener('click', () => {
    state.filters[key] = [];
    renderList(search.value); syncTrigger(); scheduleRefresh();
  });

  panel.append(search, actions, list);
  root.append(trigger, panel);
  root._sync = syncTrigger;
  syncTrigger();
  renderList();
}

document.addEventListener('click', () => $$('.multi.open').forEach((m) => m.classList.remove('open')));

/* --------------------------------- KPIs --------------------------------- */

function deltaMarkup(pctValue, { invert = false, suffix = 'vs periodo anterior' } = {}) {
  if (pctValue === null || pctValue === undefined || !Number.isFinite(pctValue)) {
    return `<span class="kpi-sub">${suffix}</span>`;
  }
  const up = pctValue >= 0;
  const good = invert ? !up : up;
  return `<span class="kpi-sub"><span class="delta ${good ? 'up' : 'down'}">${up ? '▲' : '▼'} ${n1(Math.abs(pctValue))}%</span> ${suffix}</span>`;
}

function renderKpis(an) {
  const d = an.deltas;
  const items = [
    {
      label: 'Tráfico total', value: n0(an.totals.trafico), tone: '',
      sub: d ? deltaMarkup(d.trafico.pct) : 'sin periodo comparable',
    },
    {
      label: 'Recaudo estimado', value: money(an.totals.recaudo), tone: 'teal',
      sub: d ? deltaMarkup(d.recaudo.pct) : 'tarifa × tráfico',
    },
    {
      label: 'Tarifa promedio', value: money(an.totals.tarifaPromedio), tone: 'orange',
      sub: `<span class="kpi-sub">COP por paso vehicular</span>`,
    },
    {
      label: 'Tasa de evasión', value: pct(an.totals.tasaEvasion), tone: 'red',
      sub: `<span class="kpi-sub">${n0(an.totals.evasores)} evasores reportados</span>`,
    },
    {
      label: 'Exentos (787)', value: pct(an.totals.tasaExencion), tone: 'green',
      sub: `<span class="kpi-sub">${n0(an.totals.exentos)} pasos exentos</span>`,
    },
    {
      label: 'Peajes con datos', value: n0(an.ranking.length), tone: '',
      sub: `<span class="kpi-sub">${n0(an.series.months.length)} meses · ${n0(an.categorias.length)} categorías</span>`,
    },
  ];
  $('#kpiGrid').innerHTML = items.map((it) => `
    <div class="kpi ${it.tone}">
      <div class="kpi-label">${it.label}</div>
      <div class="kpi-value">${it.value}</div>
      ${it.sub}
    </div>`).join('');
}

function renderFindings(an) {
  const items = an.findings || [];
  $('#findingsTag').textContent = `${items.length} observaciones`;
  const badge = (type) => {
    if (type === 'alerta') return ['!', 'warn'];
    if (type === 'negativo') return ['↓', 'bad'];
    if (type === 'calidad') return ['i', 'info'];
    return ['✓', ''];
  };
  $('#findingsList').innerHTML = items.map((f) => {
    const [icon, cls] = badge(f.type);
    return `<li><span class="badge ${cls}">${icon}</span><span>${f.text}</span></li>`;
  }).join('') || '<li>Sin observaciones para el filtro seleccionado.</li>';
}

/* ------------------------------- gráficos -------------------------------- */

function chartMonthly(an, withRecaudo = true) {
  const labels = an.series.months.map(shortMonth);
  const datasets = [{
    type: 'line',
    label: 'Tráfico (pasos)',
    data: an.series.trafico,
    borderColor: COLORS.blue,
    backgroundColor: 'rgba(37,99,235,0.10)',
    borderWidth: 2.4,
    pointRadius: an.series.months.length > 36 ? 0 : 2.5,
    pointHoverRadius: 5,
    tension: 0.28,
    fill: true,
    yAxisID: 'y',
  }];
  const scales = { x: gridX(), y: gridY(numAxis, 'Pasos') };
  if (withRecaudo && an.series.recaudo.some((v) => v > 0)) {
    datasets.push({
      type: 'line',
      label: 'Recaudo (COP)',
      data: an.series.recaudo,
      borderColor: COLORS.orange,
      borderWidth: 2,
      borderDash: [5, 3],
      pointRadius: 0,
      tension: 0.28,
      yAxisID: 'y1',
    });
    scales.y1 = {
      position: 'right', beginAtZero: true, grid: { display: false }, border: { display: false },
      ticks: { callback: moneyAxis, font: { size: 10 } },
    };
  }
  chart('monthly', 'chartMonthly', {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
      plugins: { legend: { ...legendBottom, display: datasets.length > 1 }, tooltip: tooltipConfig() },
      scales,
    },
  });
  const meses = an.series.months.length;
  const prom = an.totals.trafico / (meses || 1);
  $('#monthlyNote').textContent = `${monthLabel(an.series.months[0])} a ${monthLabel(an.series.months[meses - 1])} · promedio ${n0(prom)} pasos/mes · ${meses} meses.`;
}

function chartTopPeajes(an) {
  const rows = an.ranking.slice(0, 12).reverse();
  chart('topPeajes', 'chartTopPeajes', {
    type: 'bar',
    data: {
      labels: rows.map((r) => r.peaje),
      datasets: [{
        label: 'Tráfico',
        data: rows.map((r) => r.trafico),
        backgroundColor: rows.map((r, i) => (i === rows.length - 1 ? COLORS.blue : 'rgba(37,99,235,0.72)')),
        borderRadius: 4,
        barPercentage: 0.82,
      }],
    },
    options: {
      indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: tooltipConfig() },
      scales: {
        x: gridY(numAxis),
        y: { grid: { display: false }, border: { display: false }, ticks: { font: { size: 10.5, weight: '600' } } },
      },
    },
  });
}

function chartCategorias(an) {
  const sorted = [...an.categorias].sort((a, b) => b.trafico - a.trafico);
  const top = sorted.slice(0, 8);
  const rest = sorted.slice(8).reduce((a, c) => a + c.trafico, 0);
  const labels = top.map((c) => c.categoria);
  const values = top.map((c) => c.trafico);
  if (rest > 0) { labels.push('Otras'); values.push(rest); }
  chart('categorias', 'chartCategorias', {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{ data: values, backgroundColor: labels.map((_, i) => PALETTE[i % PALETTE.length]), borderColor: '#fff', borderWidth: 2 }],
    },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: '58%',
      plugins: {
        legend: { position: 'right', labels: { usePointStyle: true, boxWidth: 8, boxHeight: 8, padding: 10, font: { size: 10.5 } } },
        tooltip: tooltipConfig(),
      },
    },
  });
}

function chartYearly(an) {
  chart('yearly', 'chartYearly', {
    type: 'bar',
    data: {
      labels: an.yearly.map((y) => y.year),
      datasets: [
        { type: 'bar', label: 'Tráfico', data: an.yearly.map((y) => y.trafico), backgroundColor: 'rgba(37,99,235,0.85)', borderRadius: 4, yAxisID: 'y', order: 2 },
        { type: 'line', label: 'Tarifa promedio', data: an.yearly.map((y) => y.tarifaPromedio), borderColor: COLORS.orange, borderWidth: 2.4, pointRadius: 3.5, tension: 0.3, yAxisID: 'y1', order: 1 },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: legendBottom, tooltip: tooltipConfig() },
      scales: {
        x: gridX(),
        y: gridY(numAxis, 'Pasos'),
        y1: { position: 'right', beginAtZero: true, grid: { display: false }, border: { display: false }, ticks: { callback: moneyAxis, font: { size: 10 } } },
      },
    },
  });

  const rows = an.yearly.map((y, i) => {
    const prev = an.yearly[i - 1];
    const parcial = y.meses < 12;
    const v = prev && prev.trafico > 0 && !parcial && prev.meses === 12
      ? ((y.trafico - prev.trafico) / prev.trafico) * 100
      : null;
    return `<tr>
      <td><b>${y.year}</b>${parcial ? ` <span class="muted">(${y.meses} m)</span>` : ''}</td>
      <td class="num">${n0(y.trafico)}</td>
      <td class="num ${v === null ? 'muted' : ''}">${v === null ? (parcial ? 'parcial' : '—') : `${v >= 0 ? '+' : ''}${n2(v)}%`}</td>
      <td class="num">${n0(y.evasores)}</td>
      <td class="num">${n0(y.exentos)}</td>
      <td class="num">${money(y.recaudo)}</td>
      <td class="num">${money(y.tarifaPromedio)}</td>
    </tr>`;
  }).join('');
  const el = document.getElementById('yearlyTable');
  if (el) {
    el.innerHTML = `
      <thead><tr><th>Año</th><th class="num">Tráfico</th><th class="num">Var. %</th><th class="num">Evasores</th><th class="num">Exentos 787</th><th class="num">Recaudo est.</th><th class="num">Tarifa prom.</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="7" class="muted">Sin datos anuales.</td></tr>'}</tbody>`;
  }
}

function chartSeasonal(an) {
  chart('seasonal', 'chartSeasonal', {
    type: 'bar',
    data: {
      labels: MONTHS_ES,
      datasets: [{
        label: 'Índice estacional',
        data: an.seasonal.map((v) => v * 100),
        backgroundColor: an.seasonal.map((v) => (v >= 1 ? COLORS.teal : COLORS.orange)),
        borderRadius: 4,
        barPercentage: 0.8,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { ...tooltipConfig(), callbacks: { label: (c) => `${n2(c.parsed.y)}% del promedio mensual` } },
      },
      scales: {
        x: gridX(),
        y: {
          beginAtZero: false, suggestedMin: 80, grid: { color: COLORS.grid },
          border: { display: false }, ticks: { callback: (v) => `${v}%`, font: { size: 10 } },
        },
      },
    },
  });
}

function chartScatter(an) {
  const rows = an.ranking.slice(0, 45);
  chart('scatter', 'chartScatter', {
    type: 'scatter',
    data: {
      datasets: [{
        label: 'Peajes',
        data: rows.map((r) => ({ x: r.tarifaPromedio, y: r.trafico, peaje: r.peaje })),
        backgroundColor: 'rgba(30,58,138,0.62)',
        pointRadius: 6,
        pointHoverRadius: 8,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          ...tooltipConfig(),
          callbacks: {
            title: (items) => items[0].raw.peaje,
            label: (c) => [`Tráfico: ${n0(c.parsed.y)} pasos`, `Tarifa promedio: ${money(c.parsed.x)}`],
          },
        },
      },
      scales: {
        x: { ...gridY(moneyAxis, 'Tarifa promedio (COP)'), beginAtZero: true, title: { display: true, text: 'Tarifa promedio (COP)', font: { size: 10 }, color: '#94a3b8' } },
        y: gridY(numAxis, 'Tráfico (pasos)'),
      },
    },
  });
}

function tooltipConfig() {
  return {
    backgroundColor: 'rgba(15,23,42,0.92)',
    padding: 10,
    cornerRadius: 8,
    titleFont: { size: 11.5, weight: '700' },
    bodyFont: { size: 11 },
    displayColors: true,
    callbacks: {
      label: (c) => {
        const label = c.dataset.label ? `${c.dataset.label}: ` : '';
        const v = c.parsed.y ?? c.parsed;
        if (c.dataset.yAxisID === 'y1' && c.chart.options.scales.y1?.ticks?.callback === moneyAxis) return `${label}${money(v)}`;
        return `${label}${n0(v)}`;
      },
    },
  };
}

function renderMiniStats(an) {
  const c = an.concentration;
  const best = an.seasonal.indexOf(Math.max(...an.seasonal));
  const worst = an.seasonal.indexOf(Math.min(...an.seasonal));
  const items = [
    { h: 'Concentración (HHI)', v: n0(c.hhi), p: `Top 5: ${pct(c.top5)} · Top 10: ${pct(c.top10)} del tráfico.` },
    { h: 'CAGR del tráfico', v: an.cagr ? pct(an.cagr.value) : '—', p: an.cagr ? `Entre ${an.cagr.from} y ${an.cagr.to} con años completos.` : 'Se requieren al menos dos años completos.' },
    { h: 'Mes más alto / más bajo', v: `${MONTHS_ES[best]} / ${MONTHS_ES[worst]}`, p: `Índices ${n2(an.seasonal[best] * 100)}% y ${n2(an.seasonal[worst] * 100)}% del promedio.` },
  ];
  $('#miniStats').innerHTML = items.map((i) => `<div class="mini"><h4>${i.h}</h4><div class="value">${i.v}</div><p>${i.p}</p></div>`).join('');
}

function renderRankingTable(an) {
  const q = ($('#rankingSearch').value || '').toLowerCase().trim();
  const sortKey = $('#rankingSort').value;
  let rows = an.ranking.filter((r) => !q || r.peaje.toLowerCase().includes(q));
  rows = [...rows].sort((a, b) => b[sortKey] - a[sortKey]);
  const max = Math.max(...rows.map((r) => r.trafico), 1);
  const total = an.totals.trafico || 1;
  const body = rows.slice(0, 300).map((r) => {
    const ev = r.tasaEvasion;
    return `<tr>
      <td>${r.peaje}</td>
      <td class="num bar-cell"><i style="width:${Math.max(2, (r.trafico / max) * 100)}%"></i><span>${n0(r.trafico)}</span></td>
      <td class="num">${pct((r.trafico / total) * 100)}</td>
      <td class="num">${money(r.recaudo)}</td>
      <td class="num">${money(r.tarifaPromedio)}</td>
      <td class="num"><span class="pill-ev ${ev > 0.5 ? 'hot' : ''}">${pct(ev)}</span></td>
      <td class="num">${n0(r.exentos)}</td>
    </tr>`;
  }).join('');
  $('#rankingTable').innerHTML = `
    <thead><tr>
      <th>Peaje</th><th class="num">Tráfico</th><th class="num">Part.</th>
      <th class="num">Recaudo est.</th><th class="num">Tarifa prom.</th><th class="num">Evasión</th><th class="num">Exentos</th>
    </tr></thead>
    <tbody>${body || '<tr><td colspan="7" class="muted">Sin peajes para el filtro seleccionado.</td></tr>'}</tbody>`;
}

function renderCatsTable(an) {
  const total = an.totals.trafico || 1;
  const rows = an.categorias.map((c) => `<tr>
    <td><b>${c.categoria}</b></td>
    <td class="num">${n0(c.trafico)}</td>
    <td class="num">${pct((c.trafico / total) * 100)}</td>
    <td class="num">${money(c.tarifaPromedio)}</td>
    <td class="num">${money(c.recaudo)}</td>
  </tr>`).join('');
  $('#catsTable').innerHTML = `
    <thead><tr><th>Categoría</th><th class="num">Tráfico</th><th class="num">Part.</th><th class="num">Tarifa prom.</th><th class="num">Recaudo</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="5" class="muted">Sin categorías en el filtro.</td></tr>'}</tbody>`;
}

function renderAnomalies(an) {
  const rows = (an.anomalies || []).map((a) => `<tr>
    <td>${monthLabel(a.month)}</td>
    <td class="num">${n0(a.value)}</td>
    <td class="num"><span class="pill-ev ${Math.abs(a.z) > 4 ? 'hot' : ''}">${a.z >= 0 ? '+' : ''}${n1(a.z)}</span></td>
  </tr>`).join('');
  $('#anomalyTable').innerHTML = `
    <thead><tr><th>Mes</th><th class="num">Tráfico</th><th class="num">Desviación (z)</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="3" class="muted">No se detectaron meses atípicos.</td></tr>'}</tbody>`;
}

/* -------------------------------- resumen -------------------------------- */

async function refreshAnalysis() {
  const q = queryFromFilters();
  const an = await api(`/api/analysis?${q}`);
  state.analysis = an;
  renderKpis(an);
  renderFindings(an);
  chartMonthly(an, $('#showRecaudo').checked);
  chartTopPeajes(an);
  chartCategorias(an);
  chartYearly(an);
  chartSeasonal(an);
  chartScatter(an);
  renderMiniStats(an);
  renderRankingTable(an);
  renderCatsTable(an);
  renderAnomalies(an);
  renderReportSummary();
  updateFooter();
}

const scheduleRefresh = debounce(() => {
  refreshAnalysis().catch((e) => toast(e.message, true));
}, 320);

function updateFooter() {
  const an = state.analysis;
  if (!an || !state.meta) return;
  $('#footerMeta').textContent = `${monthLabel(an.series.months[0])} – ${monthLabel(an.series.months[an.series.months.length - 1])} · ${n0(an.ranking.length)} peajes · ${n0(state.meta.source.rows)} registros`;
}

/* ------------------------------- estimación ------------------------------ */

function estParams() {
  const tarifa = Number($('#estTarifa').value);
  return {
    peaje: $('#estPeaje').value || '',
    horizonte: Number($('#estHorizonte').value) || 12,
    ventana: Number($('#estVentana').value) || 36,
    tarifaGrowthPct: Number($('#estTarifaGrowth').value) || 0,
    trafficAdjustPct: Number($('#estTrafficAdj').value) || 0,
    tarifaOverride: Number.isFinite(tarifa) && tarifa > 0 ? tarifa : '',
  };
}

function syncEstimatorInputs() {
  const an = state.analysis;
  if (an) {
    $('#tarifaHint').textContent = money(an.totals.tarifaPromedio);
    if (!$('#estTarifa').value) $('#estTarifa').placeholder = Math.round(an.totals.tarifaPromedio);
  }
  $('#estTarifaGrowthOut').textContent = `${n1($('#estTarifaGrowth').value)}%`;
  $('#estTrafficAdjOut').textContent = `${n1($('#estTrafficAdj').value)}%`;
}

async function runEstimate() {
  const btn = $('#runEstimate');
  btn.disabled = true;
  btn.textContent = 'Calculando…';
  try {
    const data = await api(`/api/forecast?${queryFromFilters(estParams())}`);
    state.estimate = data;
    renderEstimate(data);
  } catch (e) {
    toast(e.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Calcular estimación';
  }
}

function renderEstimate(data) {
  const { pronostico: fc, estimacion: est } = data;
  const acc = fc.accuracy;
  const kpis = [
    { label: 'Tráfico proyectado', value: n0(est.totalTrafico), tone: '', sub: `<span class="kpi-sub">${est.months} meses · ${monthLabel(fc.months[0])} a ${monthLabel(fc.months[fc.months.length - 1])}</span>` },
    { label: 'Recaudo proyectado', value: money(est.totalRecaudo), tone: 'teal', sub: '<span class="kpi-sub">tarifa proyectada × tráfico</span>' },
    { label: 'Promedio mensual', value: money(est.totalRecaudo / (est.months || 1)), tone: 'orange', sub: `<span class="kpi-sub">${n0(est.totalTrafico / (est.months || 1))} pasos/mes</span>` },
    { label: 'Precisión del modelo', value: acc ? `${n0(acc.precision)}%` : '—', tone: 'green', sub: `<span class="kpi-sub">${acc ? `MAPE ${n2(acc.mape)}% en backtesting` : 'sin validación'}</span>` },
  ];
  $('#estKpis').innerHTML = kpis.map((k) => `<div class="kpi ${k.tone}"><div class="kpi-label">${k.label}</div><div class="kpi-value">${k.value}</div>${k.sub}</div>`).join('');

  $('#estMethod').textContent = `ventana ${fc.window || fc.months.length} m · pendiente ${n0(fc.trendSlope)}/mes`;
  $('#estAccuracy').textContent = acc
    ? `Validación: se entrenó sin los últimos 6 meses observados; MAPE ${n2(acc.mape)}% y ${n0(acc.precision)}% de los meses dentro de ±10%. ${fc.method}.`
    : fc.method;

  const histM = data.historico.months.slice(-48);
  const histV = data.historico.trafico.slice(-histM.length);
  const labels = [...histM, ...fc.months].map(shortMonth);
  const bridge = (arr) => [...new Array(histV.length - 1).fill(null), histV[histV.length - 1], ...arr];
  chart('forecast', 'chartForecast', {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Banda 90% (superior)', data: bridge(fc.high), borderWidth: 0, pointRadius: 0, fill: false, backgroundColor: 'transparent' },
        { label: 'Banda 90%', data: bridge(fc.low), borderWidth: 0, pointRadius: 0, fill: '-1', backgroundColor: 'rgba(234,88,12,0.13)' },
        { label: 'Histórico', data: [...histV, ...new Array(fc.months.length).fill(null)], borderColor: COLORS.blue, backgroundColor: 'rgba(37,99,235,0.08)', borderWidth: 2.4, pointRadius: 0, tension: 0.25, fill: true },
        { label: 'Pronóstico', data: [...new Array(histV.length - 1).fill(null), histV[histV.length - 1], ...fc.values], borderColor: COLORS.orange, borderWidth: 2.2, borderDash: [6, 3], pointRadius: 0, tension: 0.25 },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { ...legendBottom, labels: { ...legendBottom.labels, filter: (it) => it.text !== 'Banda 90%' } },
        tooltip: tooltipConfig(),
      },
      scales: { x: gridX(), y: gridY(numAxis, 'Pasos') },
    },
  });

  chart('estimation', 'chartEstimation', {
    type: 'bar',
    data: {
      labels: est.rows.map((r) => shortMonth(r.month)),
      datasets: [{ label: 'Recaudo estimado', data: est.rows.map((r) => r.recaudo), backgroundColor: 'rgba(15,118,110,0.85)', borderRadius: 4 }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: tooltipConfig() },
      scales: { x: gridX(), y: gridY(moneyAxis, 'COP') },
    },
  });

  const rows = est.rows.map((r) => `<tr>
    <td>${monthLabel(r.month)}</td>
    <td class="num">${n0(r.traficoBase)}</td>
    <td class="num">${n0(r.trafico)}</td>
    <td class="num">${money(r.tarifa)}</td>
    <td class="num">${money(r.recaudo)}</td>
  </tr>`).join('');
  $('#estTable').innerHTML = `
    <thead><tr><th>Mes</th><th class="num">Tráfico pronosticado</th><th class="num">Tráfico ajustado</th><th class="num">Tarifa proyectada</th><th class="num">Recaudo estimado</th></tr></thead>
    <tbody>${rows}</tbody>
    <tfoot><tr class="total"><td>Total</td><td class="num">${n0(fc.values.reduce((a, b) => a + b, 0))}</td><td class="num">${n0(est.totalTrafico)}</td><td class="num">—</td><td class="num">${money(est.totalRecaudo)}</td></tr></tfoot>`;
}

/* --------------------------------- datos --------------------------------- */

function renderQuality(meta) {
  const src = meta.source;
  $('#sourceCard').innerHTML = [
    ['Archivo', src.file],
    ['Registros', n0(src.rows)],
    ['Tamaño', `${n1(src.bytes / 1e6)} MB`],
    ['Periodo cubierto', `${monthLabel(meta.months[0])} – ${monthLabel(meta.months[meta.months.length - 1])}`],
    ['Meses', n0(meta.months.length)],
    ['Peajes', n0(meta.peajes.length)],
    ['Categorías', n0(meta.categorias.length)],
    ['Cargado', new Date(src.loadedAt).toLocaleString('es-CO')],
  ].map(([k, v]) => `<div><span>${k}</span><span>${v}</span></div>`).join('');

  const issues = [...meta.quality].sort((a, b) => b.count - a.count);
  const total = src.rows || 1;
  $('#qualityTable').innerHTML = `
    <thead><tr><th>Regla</th><th class="num">Registros</th><th class="num">%</th><th>Muestra</th></tr></thead>
    <tbody>${issues.map((q) => `<tr>
      <td>${q.label}</td>
      <td class="num">${n0(q.count)}</td>
      <td class="num"><span class="pill-ev ${q.pct > 1 ? 'hot' : ''}">${pct(q.pct)}</span></td>
      <td class="muted">${q.samples && q.samples.length ? q.samples[0] : '—'}</td>
    </tr>`).join('')}</tbody>`;

  const rows = meta.peajes.map((p) => `<tr>
    <td>${p.peaje}</td>
    <td class="num">${p.id}</td>
    <td class="num">${n0(p.registros)}</td>
    <td class="num">${p.meses}</td>
    <td>${monthLabel(p.primerMesActivo)}</td>
    <td>${monthLabel(p.ultimoMesActivo)}</td>
    <td class="num">${n0(p.trafico)}</td>
  </tr>`).join('');
  $('#coverageTable').innerHTML = `
    <thead><tr><th>Peaje</th><th class="num">Id</th><th class="num">Registros</th><th class="num">Meses</th><th>Primer mes con datos</th><th>Último mes con datos</th><th class="num">Tráfico total</th></tr></thead>
    <tbody>${rows}</tbody>`;
}

/* -------------------------------- informe -------------------------------- */

function reportSummaryText() {
  const an = state.analysis;
  if (!an) return '';
  const est = state.estimate;
  return `
    <b>Periodo:</b> ${monthLabel(an.series.months[0])} – ${monthLabel(an.series.months[an.series.months.length - 1])} (${an.series.months.length} meses)<br>
    <b>Alcance:</b> ${state.filters.peajes.length ? `${state.filters.peajes.length} peaje(s) seleccionado(s)` : 'todos los peajes'} · ${state.filters.categorias.length ? `${state.filters.categorias.length} categoría(s)` : 'todas las categorías'}<br>
    <b>Tráfico:</b> ${n0(an.totals.trafico)} pasos · <b>Recaudo est.:</b> ${money(an.totals.recaudo)}<br>
    <b>Estimación:</b> ${est ? `${monthLabel(est.pronostico.months[0])} – ${monthLabel(est.pronostico.months[est.pronostico.months.length - 1])} · ${money(est.estimacion.totalRecaudo)}` : 'se calculará con la configuración de la pestaña Estimación'}`;
}

function renderReportSummary() {
  const el = $('#reportSummary');
  if (el && state.analysis) el.innerHTML = reportSummaryText();
}

async function generatePdf() {
  const btn = $('#generatePdf');
  btn.disabled = true;
  $('#pdfLoading').hidden = false;
  $('#previewEmpty').hidden = true;
  const secciones = {};
  $$('[data-section]').forEach((cb) => { secciones[cb.dataset.section] = cb.checked; });
  const body = {
    ...state.filters,
    peajes: state.filters.peajes,
    categorias: state.filters.categorias,
    titulo: $('#repTitulo').value.trim(),
    entidad: $('#repEntidad').value.trim(),
    autor: $('#repAutor').value.trim(),
    notas: $('#repNotas').value.trim(),
    secciones,
    estimacion: estParams(),
  };
  try {
    const res = await fetch('/api/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'No fue posible generar el informe');
    }
    const blob = await res.blob();
    if (state.pdfUrl) URL.revokeObjectURL(state.pdfUrl);
    state.pdfUrl = URL.createObjectURL(blob);
    const frame = $('#pdfFrame');
    frame.src = state.pdfUrl;
    frame.hidden = false;
    $('#pdfActions').hidden = false;
    $('#openPdf').href = state.pdfUrl;
    $('#downloadPdf').href = state.pdfUrl;
    $('#downloadPdf').setAttribute('download', 'Informe_Trafico_ANI.pdf');
    toast('Informe generado correctamente');
  } catch (e) {
    toast(e.message, true);
    $('#previewEmpty').hidden = !!state.pdfUrl;
  } finally {
    btn.disabled = false;
    $('#pdfLoading').hidden = true;
  }
}

/* --------------------------------- init ---------------------------------- */

function switchView(name) {
  state.view = name;
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === name));
  $$('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${name}`));
  if (name === 'estimacion' && !state.estimate) runEstimate();
  if (name === 'informe') renderReportSummary();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function init() {
  try {
    const meta = await api('/api/meta');
    state.meta = meta;
    $('#sourceText').textContent = `${meta.source.file} · ${n0(meta.source.rows)} registros`;

    // periodo por defecto: últimos 24 meses con datos
    const months = meta.months;
    state.filters.desde = months[Math.max(0, months.length - 24)];
    state.filters.hasta = months[months.length - 1];
    $('#desde').innerHTML = months.map((m) => `<option value="${m}" ${m === state.filters.desde ? 'selected' : ''}>${monthLabel(m)}</option>`).join('');
    $('#hasta').innerHTML = months.map((m) => `<option value="${m}" ${m === state.filters.hasta ? 'selected' : ''}>${monthLabel(m)}</option>`).join('');
    $('#desde').addEventListener('change', (e) => {
      state.filters.desde = e.target.value;
      if (state.filters.desde > state.filters.hasta) {
        state.filters.hasta = state.filters.desde;
        $('#hasta').value = state.filters.hasta;
      }
      scheduleRefresh();
    });
    $('#hasta').addEventListener('change', (e) => {
      state.filters.hasta = e.target.value;
      if (state.filters.hasta < state.filters.desde) {
        state.filters.desde = state.filters.hasta;
        $('#desde').value = state.filters.desde;
      }
      scheduleRefresh();
    });

    buildMulti($('#peajeMulti'), meta.peajes, 'peajes', {
      label: 'peajes',
      valueLabel: (p) => p.peaje,
      extraLabel: (p) => `${(p.trafico / 1e6).toFixed(1)} M`,
    });
    buildMulti($('#catMulti'), meta.categorias, 'categorias', {
      label: 'categorías',
      valueLabel: (c) => c.categoria,
      extraLabel: (c) => `${(c.trafico / 1e6).toFixed(1)} M`,
    });

    $('#estPeaje').innerHTML = '<option value="">Peajes filtrados (agregado)</option>' +
      meta.peajes.map((p) => `<option value="${p.peaje}">${p.peaje}</option>`).join('');

    renderQuality(meta);
    await refreshAnalysis();

    $$('.tab').forEach((t) => t.addEventListener('click', () => switchView(t.dataset.view)));

    $('#showRecaudo').addEventListener('change', (e) => {
      if (state.analysis) chartMonthly(state.analysis, e.target.checked);
    });
    $('#rankingSearch').addEventListener('input', debounce(() => state.analysis && renderRankingTable(state.analysis), 200));
    $('#rankingSort').addEventListener('change', () => state.analysis && renderRankingTable(state.analysis));

    $('#resetFilters').addEventListener('click', () => {
      state.filters.peajes = [];
      state.filters.categorias = [];
      state.filters.desde = months[Math.max(0, months.length - 24)];
      state.filters.hasta = months[months.length - 1];
      $('#desde').value = state.filters.desde;
      $('#hasta').value = state.filters.hasta;
      $('#peajeMulti')._sync();
      $('#catMulti')._sync();
      $$('#peajeMulti input[type=checkbox], #catMulti input[type=checkbox]').forEach((cb) => { cb.checked = false; });
      refreshAnalysis();
    });

    $('#exportCsv').addEventListener('click', () => {
      window.location.href = `/api/export.csv?${queryFromFilters()}`;
    });

    ['#estPeaje', '#estHorizonte', '#estVentana', '#estTarifa'].forEach((sel) => {
      $(sel).addEventListener('change', runEstimate);
    });
    ['#estTarifaGrowth', '#estTrafficAdj'].forEach((sel) => {
      $(sel).addEventListener('input', syncEstimatorInputs);
      $(sel).addEventListener('change', runEstimate);
    });
    $('#runEstimate').addEventListener('click', runEstimate);
    $$('.chip').forEach((chip) => chip.addEventListener('click', () => {
      $$('.chip').forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
      const mode = chip.dataset.scenario;
      const map = {
        conservador: { tarifa: -2, trafico: -8 },
        base: { tarifa: 0, trafico: 0 },
        optimista: { tarifa: 6, trafico: 8 },
      }[mode];
      $('#estTarifaGrowth').value = map.tarifa;
      $('#estTrafficAdj').value = map.trafico;
      syncEstimatorInputs();
      runEstimate();
    }));
    $('#downloadEstCsv').addEventListener('click', () => {
      if (!state.estimate) return;
      const rows = [['Mes', 'TraficoPronosticado', 'TraficoAjustado', 'TarifaProyectada', 'RecaudoEstimado']];
      state.estimate.estimacion.rows.forEach((r) => rows.push([r.month, Math.round(r.traficoBase), Math.round(r.trafico), Math.round(r.tarifa), Math.round(r.recaudo)]));
      const csv = rows.map((r) => r.join(',')).join('\n');
      const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = 'estimacion_trafico.csv';
      a.click();
      URL.revokeObjectURL(url);
    });

    /* ---- carga de un nuevo corte de datos ---- */
    const reloadMeta = async () => {
      state.meta = await api('/api/meta');
      const m = state.meta;
      $('#sourceText').textContent = `${m.source.file} · ${n0(m.source.rows)} registros`;
      $('#peajeMulti').innerHTML = '';
      buildMulti($('#peajeMulti'), m.peajes, 'peajes', { label: 'peajes', valueLabel: (p) => p.peaje, extraLabel: (p) => `${(p.trafico / 1e6).toFixed(1)} M` });
      $('#catMulti').innerHTML = '';
      buildMulti($('#catMulti'), m.categorias, 'categorias', { label: 'categorías', valueLabel: (c) => c.categoria, extraLabel: (c) => `${(c.trafico / 1e6).toFixed(1)} M` });
      state.filters.peajes = [];
      state.filters.categorias = [];
      const months2 = m.months;
      state.filters.desde = months2[Math.max(0, months2.length - 24)];
      state.filters.hasta = months2[months2.length - 1];
      $('#desde').innerHTML = months2.map((x) => `<option value="${x}" ${x === state.filters.desde ? 'selected' : ''}>${monthLabel(x)}</option>`).join('');
      $('#hasta').innerHTML = months2.map((x) => `<option value="${x}" ${x === state.filters.hasta ? 'selected' : ''}>${monthLabel(x)}</option>`).join('');
      $('#estPeaje').innerHTML = '<option value="">Peajes filtrados (agregado)</option>' + m.peajes.map((p) => `<option value="${p.peaje}">${p.peaje}</option>`).join('');
      renderQuality(m);
      state.estimate = null;
      await refreshAnalysis();
    };

    const uploadCsv = async (file) => {
      if (!file) return;
      if (!/csv$/i.test(file.name) && file.type !== 'text/csv') {
        toast('Seleccione un archivo CSV', true);
        return;
      }
      toast(`Cargando ${file.name}…`);
      try {
        const text = await file.text();
        const res = await fetch('/api/upload', { method: 'POST', headers: { 'Content-Type': 'text/csv' }, body: text });
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || data.error || 'No se pudo cargar el archivo');
        await reloadMeta();
        toast(`Datos actualizados: ${n0(data.source.rows)} registros · ${n0(data.peajes)} peajes`);
      } catch (e) {
        toast(e.message, true);
      }
    };

    const dropZone = $('#dropZone');
    if (dropZone) {
      const input = $('#csvInput');
      $('#pickCsv').addEventListener('click', () => input.click());
      dropZone.addEventListener('click', (e) => { if (e.target === dropZone) input.click(); });
      input.addEventListener('change', (e) => uploadCsv(e.target.files[0]));
      ['dragenter', 'dragover'].forEach((ev) => dropZone.addEventListener(ev, (e) => { e.preventDefault(); dropZone.classList.add('drag'); }));
      ['dragleave', 'drop'].forEach((ev) => dropZone.addEventListener(ev, (e) => { e.preventDefault(); dropZone.classList.remove('drag'); }));
      dropZone.addEventListener('drop', (e) => uploadCsv(e.dataTransfer.files && e.dataTransfer.files[0]));
    }

    $('#generatePdf').addEventListener('click', generatePdf);
    syncEstimatorInputs();

    window.addEventListener('resize', debounce(() => {
      Object.values(state.charts).forEach((c) => c && c.resize());
    }, 150));
  } catch (e) {
    console.error(e);
    $('#sourceText').textContent = 'error al cargar datos';
    toast(`No se pudo inicializar el tablero: ${e.message}`, true);
  }
}

document.addEventListener('DOMContentLoaded', init);
