'use strict';
/**
 * Punto único de carga de Chart.js para el servidor.
 * Se resuelve la ruta absoluta del build CJS (que incluye todos los
 * controladores: bar, line, doughnut, scatter) para evitar las restricciones
 * del campo "exports" del paquete.
 */
const path = require('path');

module.exports = require(path.join(__dirname, '..', 'node_modules', 'chart.js', 'dist', 'chart.cjs'));
