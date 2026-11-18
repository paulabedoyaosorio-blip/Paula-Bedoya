# Tablero de tráfico vehicular · Peajes ANI

Aplicación web interactiva para **analizar, calcular y estimar** el tráfico vehicular y el
recaudo de los peajes administrados por la ANI, que además **genera el informe en PDF** con
portada, resumen ejecutivo, gráficos, tablas, hallazgos y metodología.

Los datos provienen del archivo `data/trafico_ani.csv` (corte de la ANI con 149.944 registros,
162 peajes y 149 meses, de enero de 2014 a mayo de 2026).

![flujo](https://img.shields.io/badge/Node.js-18%2B-2563eb) ![pdf](https://img.shields.io/badge/informe-PDF-ea580c)

---

## 1. Cómo ejecutarlo

```bash
npm install
npm start          # http://localhost:3000
```

Variables de entorno opcionales:

| Variable   | Descripción                                                   |
|------------|---------------------------------------------------------------|
| `PORT`     | Puerto HTTP (por defecto `3000`).                             |
| `CSV_PATH` | Ruta a otro archivo CSV para cargarlo al arrancar.            |

Generación del PDF sin levantar el servidor:

```bash
node scripts/report.js --desde 2024-01 --hasta 2026-05 \
  --peajes ANDES,ALVARADO --horizonte 12 --tarifa-growth 5 \
  --titulo "Informe trimestral" --entidad "ANI" --out out/informe.pdf
```

Pruebas (datos, agregaciones, pronóstico, PDF y endpoints):

```bash
npm test
```

---

## 2. Qué hace la aplicación

### Pestaña **Resumen**
- Indicadores del periodo filtrado: tráfico, recaudo estimado, tarifa promedio, tasa de evasión,
  tasa de exención (787), cobertura de peajes, cada uno con la variación frente al periodo
  anterior comparable de igual longitud.
- Serie mensual de tráfico y recaudo, top 12 de peajes y composición por categoría tarifaria.
- **Hallazgos automáticos** redactados a partir de los números (crecimiento, concentración,
  estacionalidad, alertas de calidad de datos).

### Pestaña **Análisis**
- Comparativo anual (tráfico + tarifa promedio) y tabla de resumen anual con variaciones
  calculadas solo entre años completos.
- Índice de estacionalidad por mes calendario (100% = promedio del año).
- Métricas de estructura: HHI, Gini, participación del top 5 / top 10, CAGR.
- Tabla completa de peajes con búsqueda y ordenamientos, tabla de categorías, dispersión
  tarifa vs tráfico y detección de **meses atípicos** (z-score robusto con mediana y MAD).

### Pestaña **Estimación** (cálculo)
- Pronóstico de tráfico con **tendencia lineal sobre la serie desestacionalizada** (ventana
  configurable) multiplicada por los **índices estacionales mensuales**, con banda de
  incertidumbre al ~90%.
- Conversión a **recaudo estimado** = tráfico proyectado × tarifa, con ajustes de tarifa anual,
  ajuste de tráfico, tarifa manual o tarifa promedio del periodo.
- Escenarios rápidos (conservador / base / optimista), elección de alcance (agregado de los
  peajes filtrados o un peaje específico), tabla mensual editable y exportación CSV.
- **Backtesting**: entrena sin los últimos 6 meses y reporta MAPE y acierto a ±10%.

### Pestaña **Datos**
- Ficha de la fuente (archivo, registros, tamaño, periodo, meses, peajes, categorías).
- Reglas de validación ejecutadas sobre el archivo, con conteo, porcentaje y ejemplo:
  fecha inválida, periodo inconsistente, duplicados, tráfico negativo, evasores o exentos
  mayores al tráfico, tarifa en cero, peaje sin id y categorías poco frecuentes.
- Cobertura por peaje (registros, meses, primer y último mes con datos).
- **Carga de un nuevo corte CSV** (arrastrar o seleccionar) sin reiniciar el servidor.

### Pestaña **Informe PDF**
- Configuración de título, entidad, autor, notas y secciones a incluir.
- Generación del documento y **vista previa integrada** (iframe), con opciones de abrir en
  pestaña nueva o descargar.

---

## 3. Estructura del proyecto

```
├── server.js                 API HTTP + estáticos + endpoints de PDF y CSV
├── src/
│   ├── dataset.js            Lectura y normalización del CSV + auditoría de calidad
│   ├── aggregates.js         Cubo (peaje × categoría × mes) y consultas filtradas
│   ├── analysis.js           Comparativos, estacionalidad, concentración, pronóstico,
│   │                         estimación, hallazgos y recomendaciones
│   ├── charts.js             Gráficos con Chart.js renderizados en servidor (PNG)
│   ├── chartjs.js            Carga del build CJS de Chart.js
│   └── pdf.js                Composición del informe PDF con pdfkit
├── public/
│   ├── index.html            Interfaz (5 pestañas)
│   ├── styles.css            Diseño
│   └── app.js                Estado, filtros, gráficos y llamadas a la API
├── scripts/report.js         Generación del PDF por línea de comandos
├── test/tablero.test.js      Pruebas con node:test
├── assets/fonts/             DejaVu Sans (tildes y ñ en el PDF)
└── data/trafico_ani.csv      Archivo de origen
```

### Flujo interno

1. **Ingesta**: `dataset.js` lee el CSV en streaming, interpreta fechas tipo
   `2015 Aug 01 12:00:00 AM` y números con separador de miles (`27,730`), y arma un cubo
   disperso (peaje × categoría × mes) con series mensuales tipadas (`Float64Array`).
2. **Consulta**: cualquier combinación de filtros (peajes, categorías, rango de meses) se
   resuelve sumando series del cubo — sin volver a leer el archivo.
3. **Análisis**: `analysis.js` calcula comparativos, estacionalidad, concentración, anomalías,
   pronóstico y estimación, y redacta hallazgos y recomendaciones.
4. **Informe**: `charts.js` renderiza cada gráfico como PNG (Chart.js sobre
   `@napi-rs/canvas`) y `pdf.js` compone el documento con pdfkit; el navegador lo recibe como
   `application/pdf`.

---

## 4. API

| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET` | `/api/meta` | Fuente, meses, peajes, categorías y auditoría de calidad. |
| `GET` | `/api/analysis?desde&hasta&peajes&categorias` | Series, totales, deltas, ranking, categorías, concentración, estacionalidad, anomalías, hallazgos. |
| `GET` | `/api/series?...` | Serie mensual filtrada (tráfico, evasores, exentos, recaudo). |
| `GET` | `/api/peaje/:nombre` | Serie histórica, categorías y resumen anual de un peaje. |
| `GET` | `/api/forecast?...&horizonte&ventana&tarifaGrowthPct&trafficAdjustPct&tarifaOverride&peaje` | Pronóstico + estimación de recaudo + validación. |
| `GET` | `/api/export.csv?...` | Resumen por peaje en CSV. |
| `POST` | `/api/report` | Genera el informe PDF (JSON con filtros, metadatos y parámetros de estimación). |
| `POST` | `/api/upload` | Reemplaza el dataset en memoria con un nuevo corte CSV (`text/csv`). |
| `GET` | `/health` | Estado del servicio. |

Los filtros de listas se separan con `|` (`peajes=ANDES|ALVARADO`).

---

## 5. Definiciones de los indicadores

| Indicador | Cálculo |
|-----------|---------|
| Tráfico | Suma de `CantidadTrafico` de los registros que cumplen los filtros. |
| Recaudo estimado | `Σ ValorTarifa × CantidadTrafico`. **No** es el recaudo oficial: excluye tarifa cero, evasión no reportada y descuentos operativos. |
| Tarifa promedio | Recaudo estimado / tráfico. |
| Tasa de evasión | `Evasores / (Tráfico + Evasores)`. |
| Tasa de exención (787) | `Exentos / (Tráfico + Exentos)`. |
| CAGR | `((Tráfico final / Tráfico inicial)^(1/años) − 1)` usando solo años con 12 meses. |
| Estacionalidad | Promedio del cociente mes/promedio de su año, normalizado a 12 índices. |
| HHI / Gini | Concentración de las participaciones de tráfico por peaje. |
| Pronóstico | Regresión lineal sobre la serie desestacionalizada × índice estacional del mes. |
| Banda | ±1,645 errores estándar de la regresión, escalados con el horizonte (~90%). |
| Validación | Entrena sin los últimos 6 meses y compara (MAPE y acierto ±10%). |

---

## 6. Notas sobre los datos

- El archivo no trae departamento ni vía; el análisis se hace por peaje, categoría y mes.
- **Tarifa cero**: 6.279 registros (4,19%) reportan `ValorTarifa = 0` (por ejemplo marzo de 2020),
  por lo que el recaudo calculado es una **cota inferior**.
- La serie cubre 149 meses (ene 2014 – may 2026) con 132 peajes activos en 2025-2026; los peajes
  sin datos en un mes simplemente no aparecen en ese mes.
- Los peajes sin recaudo o con tráfico cero en el periodo filtrado no se listan en el ranking.

## 7. Créditos

Datos: Agencia Nacional de Infraestructura (ANI) — tráfico vehicular en peajes.
Aplicación: tablero analítico construido con Node.js, Express, Chart.js, pdfkit y
`@napi-rs/canvas`. Todas las cifras del informe son estimaciones analíticas.
