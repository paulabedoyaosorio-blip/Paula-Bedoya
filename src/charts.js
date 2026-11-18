'use strict';
/**
 * Gráficos del informe. Chart.js se ejecuta en servidor sobre @napi-rs/canvas y
 * cada gráfico se entrega como PNG (alta resolución) listo para incrustarse en
 * el PDF.
 */

const { createCanvas, GlobalFonts } = require('@napi-rs/canvas');
const { Chart, registerables } = require('./chartjs');

Chart.register(...registerables);

const FONT = 'DejaVu Sans';
Chart.defaults.font.family = FONT;
Chart.defaults.font.size = 16;
Chart.defaults.color = '#334155';
Chart.defaults.borderWidth = 1.5;
Chart.defaults.animation = false;

const COLORS = {
  navy: '#1e3a8a',
  blue: '#2563eb',
  cyan: '#0e7490',
  teal: '#0f766e',
  orange: '#ea580c',
  amber: '#d97706',
  green: '#15803d',
  red: '#b91c1c',
  slate: '#475569',
  grid: '#e2e8f0',
};

const PALETTE = ['#1e3a8a', '#0e7490', '#ea580c', '#15803d', '#7c3aed', '#b45309', '#0891b2', '#be123c', '#4d7c0f', '#6366f1'];

const nf = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 });
const compact = new Intl.NumberFormat('es-CO', { notation: 'compact', maximumFractionDigits: 1 });

function render(config, { width = 900, height = 360, scale = 2 } = {}) {
  const canvas = createCanvas(Math.round(width * scale), Math.round(height * scale));
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  const chart = new Chart(ctx, {
    ...config,
    options: {
      responsive: false,
      animation: false,
      ...config.options,
    },
  });
  const buf = canvas.toBuffer('image/png');
  chart.destroy();
  return { buffer: buf, width, height };
}

const basePlugins = {
  legend: {
    display: true,
    position: 'bottom',
    labels: { boxWidth: 16, boxHeight: 16, padding: 20, font: { size: 15 }, usePointStyle: true },
  },
  tooltip: { enabled: false },
};

function gridOptions(yTitle) {
  return {
    x: {
      grid: { display: false },
      ticks: { font: { size: 14 }, maxRotation: 0, autoSkipPadding: 16 },
    },
    y: {
      beginAtZero: true,
      grid: { color: COLORS.grid, drawTicks: false },
      border: { display: false },
      title: yTitle ? { display: true, text: yTitle, font: { size: 14 }, color: '#64748b' } : undefined,
      ticks: { font: { size: 14 }, callback: (v) => compact.format(v) },
    },
  };
}

/** Serie mensual de tráfico (y opcionalmente recaudo) */
function monthlyTraffic(months, trafico, recaudo) {
  const labels = months.map((m) => {
    const [y, mm] = m.split('-');
    return `${mm}/${y.slice(2)}`;
  });
  const datasets = [{
    type: 'line',
    label: 'Tráfico (pasos)',
    data: trafico,
    borderColor: COLORS.blue,
    backgroundColor: 'rgba(37,99,235,0.12)',
    borderWidth: 3.5,
    pointRadius: months.length > 40 ? 0 : 4,
    tension: 0.28,
    fill: true,
    yAxisID: 'y',
  }];
  const scales = gridOptions('Pasos vehiculares');
  if (recaudo && recaudo.some((v) => v > 0)) {
    datasets.push({
      type: 'line',
      label: 'Recaudo estimado (COP)',
      data: recaudo,
      borderColor: COLORS.orange,
      borderWidth: 4,
      borderDash: [5, 3],
      pointRadius: 0,
      tension: 0.28,
      yAxisID: 'y1',
    });
    scales.y1 = {
      position: 'right',
      beginAtZero: true,
      grid: { display: false },
      border: { display: false },
      ticks: { font: { size: 14 }, callback: (v) => `$${compact.format(v)}` },
    };
  }
  return render({
    type: 'line',
    data: { labels, datasets },
    options: { plugins: { ...basePlugins, legend: { ...basePlugins.legend, display: datasets.length > 1 } }, scales },
  }, { width: 900, height: 330 });
}

/** Barras horizontales de ranking (top N) */
function rankingBars(rows, { label = 'Tráfico (pasos)', limit = 15, color = COLORS.navy } = {}) {
  const data = rows.slice(0, limit).reverse();
  return render({
    type: 'bar',
    data: {
      labels: data.map((r) => r.label),
      datasets: [{ label, data: data.map((r) => r.value), backgroundColor: color, borderRadius: 5, barPercentage: 0.8 }],
    },
    options: {
      indexAxis: 'y',
      plugins: { ...basePlugins, legend: { display: false } },
      scales: {
        x: { beginAtZero: true, grid: { color: COLORS.grid }, border: { display: false }, ticks: { font: { size: 14 }, callback: (v) => compact.format(v) } },
        y: { grid: { display: false }, border: { display: false }, ticks: { font: { size: 15, weight: '600' } } },
      },
    },
  }, { width: 900, height: Math.max(260, data.length * 24 + 60) });
}

/** Dona de composición por categoría */
function compositionDoughnut(rows, { limit = 10 } = {}) {
  const sorted = [...rows].sort((a, b) => b.value - a.value);
  const top = sorted.slice(0, limit);
  const rest = sorted.slice(limit).reduce((a, r) => a + r.value, 0);
  const labels = top.map((r) => r.label);
  const values = top.map((r) => r.value);
  if (rest > 0) { labels.push('Otras'); values.push(rest); }
  return render({
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data: values,
        backgroundColor: labels.map((_, i) => PALETTE[i % PALETTE.length]),
        borderColor: '#ffffff',
        borderWidth: 4,
      }],
    },
    options: {
      cutout: '55%',
      plugins: {
        legend: { position: 'right', labels: { boxWidth: 16, boxHeight: 16, padding: 14, font: { size: 15 }, usePointStyle: true } },
        tooltip: { enabled: false },
      },
    },
  }, { width: 520, height: 320 });
}

/** Barras comparativas por año (tráfico y tarifa promedio) */
function yearlyBars(years) {
  return render({
    type: 'bar',
    data: {
      labels: years.map((y) => y.year),
      datasets: [
        { type: 'bar', label: 'Tráfico (pasos)', data: years.map((y) => y.trafico), backgroundColor: COLORS.blue, borderRadius: 5, yAxisID: 'y', order: 2 },
        { type: 'line', label: 'Tarifa promedio (COP)', data: years.map((y) => y.tarifaPromedio), borderColor: COLORS.orange, backgroundColor: COLORS.orange, borderWidth: 4, pointRadius: 6, tension: 0.3, yAxisID: 'y1', order: 1 },
      ],
    },
    options: {
      plugins: basePlugins,
      scales: {
        ...gridOptions('Pasos'),
        y1: {
          position: 'right',
          beginAtZero: true,
          grid: { display: false },
          border: { display: false },
          ticks: { font: { size: 14 }, callback: (v) => `$${compact.format(v)}` },
        },
      },
    },
  }, { width: 900, height: 300 });
}

/** Estacionalidad: índice por mes calendario */
function seasonalBars(index, labelsMonth) {
  return render({
    type: 'bar',
    data: {
      labels: labelsMonth,
      datasets: [{
        label: 'Índice estacional (% del promedio mensual)',
        data: index.map((v) => v * 100),
        backgroundColor: index.map((v) => (v >= 1 ? COLORS.teal : COLORS.amber)),
        borderRadius: 5,
      }],
    },
    options: {
      plugins: { ...basePlugins, legend: { display: false } },
      scales: {
        x: { grid: { display: false }, border: { display: false }, ticks: { font: { size: 15 } } },
        y: {
          beginAtZero: false,
          grid: { color: COLORS.grid },
          border: { display: false },
          suggestedMin: 80,
          ticks: { font: { size: 14 }, callback: (v) => `${v}%` },
        },
      },
    },
  }, { width: 900, height: 260 });
}

/** Histórico + pronóstico con banda de incertidumbre */
function forecastChart(historyMonths, historyValues, fc) {
  const labels = [...historyMonths, ...fc.months].map((m) => {
    const [y, mm] = m.split('-');
    return `${mm}/${y.slice(2)}`;
  });
  const pad = new Array(historyValues.length).fill(null);
  const bridge = (arr) => [...new Array(Math.max(0, historyValues.length - 1)).fill(null), historyValues[historyValues.length - 1] ?? null, ...arr];

  return render({
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Banda de incertidumbre (90%)',
          data: bridge(fc.high),
          borderWidth: 0,
          pointRadius: 0,
          fill: false,
          backgroundColor: 'transparent',
        },
        {
          label: 'Límite inferior',
          data: bridge(fc.low),
          borderWidth: 0,
          pointRadius: 0,
          fill: '-1',
          backgroundColor: 'rgba(234,88,12,0.14)',
        },
        {
          label: 'Histórico',
          data: [...historyValues, ...new Array(fc.months.length).fill(null)],
          borderColor: COLORS.blue,
          backgroundColor: 'rgba(37,99,235,0.10)',
          borderWidth: 4,
          pointRadius: 0,
          tension: 0.25,
        },
        {
          label: 'Pronóstico',
          data: [...new Array(Math.max(0, historyValues.length - 1)).fill(null), historyValues[historyValues.length - 1] ?? null, ...fc.values],
          borderColor: COLORS.orange,
          borderWidth: 4,
          borderDash: [6, 3],
          pointRadius: 0,
          tension: 0.25,
        },
      ],
    },
    options: {
      plugins: {
        ...basePlugins,
        legend: {
          ...basePlugins.legend,
          labels: { ...basePlugins.legend.labels, filter: (item) => item.text !== 'Límite inferior' },
        },
      },
      scales: gridOptions('Pasos vehiculares'),
    },
  }, { width: 900, height: 340 });
}

/** Recaudo estimado por mes (barras) */
function estimationBars(rows) {
  const labels = rows.map((r) => {
    const [y, m] = r.month.split('-');
    return `${m}/${y.slice(2)}`;
  });
  return render({
    type: 'bar',
    data: {
      labels,
      datasets: [{ label: 'Recaudo estimado (COP)', data: rows.map((r) => r.recaudo), backgroundColor: COLORS.teal, borderRadius: 3 }],
    },
    options: {
      plugins: { ...basePlugins, legend: { display: false } },
      scales: {
        x: { grid: { display: false }, border: { display: false }, ticks: { font: { size: 14 } } },
        y: { beginAtZero: true, grid: { color: COLORS.grid }, border: { display: false }, ticks: { font: { size: 14 }, callback: (v) => `$${compact.format(v)}` } },
      },
    },
  }, { width: 900, height: 260 });
}

/** Dispersión tráfico vs tarifa promedio por peaje */
function scatterRanking(rows, { limit = 40 } = {}) {
  const data = rows.slice(0, limit).map((r) => ({ x: r.tarifaPromedio, y: r.trafico, label: r.peaje }));
  return render({
    type: 'scatter',
    data: {
      datasets: [{
        label: 'Peajes (tarifa promedio vs tráfico)',
        data,
        backgroundColor: 'rgba(30,58,138,0.65)',
        pointRadius: 9,
        pointHoverRadius: 6,
      }],
    },
    options: {
      plugins: { ...basePlugins, legend: { display: false } },
      scales: {
        x: {
          title: { display: true, text: 'Tarifa promedio por paso (COP)', font: { size: 14 }, color: '#64748b' },
          grid: { color: COLORS.grid },
          border: { display: false },
          ticks: { font: { size: 14 }, callback: (v) => `$${compact.format(v)}` },
        },
        y: {
          beginAtZero: true,
          title: { display: true, text: 'Tráfico (pasos)', font: { size: 14 }, color: '#64748b' },
          grid: { color: COLORS.grid },
          border: { display: false },
          ticks: { font: { size: 14 }, callback: (v) => compact.format(v) },
        },
      },
    },
  }, { width: 900, height: 330 });
}

module.exports = {
  COLORS,
  PALETTE,
  FONT,
  monthlyTraffic,
  rankingBars,
  compositionDoughnut,
  yearlyBars,
  seasonalBars,
  forecastChart,
  estimationBars,
  scatterRanking,
  render,
  GlobalFonts,
  nf,
  compact,
};
