/* ═══════════════════════════════════════
   AnalystAI — Chart Rendering (charts.js)
   All Chart.js implementations
   ═══════════════════════════════════════ */

const CHART_COLORS = ['#3B82F6','#8B5CF6','#10B981','#F59E0B','#EF4444','#06B6D4','#EC4899','#14B8A6','#F97316','#6366F1'];
let activeCharts = [];

/**
 * Destroy all existing charts to prevent canvas reuse errors
 */
function destroyAllCharts() {
  activeCharts.forEach(c => { try { c.destroy(); } catch(e) {} });
  activeCharts = [];
}

/**
 * Common Chart.js defaults
 */
function getChartDefaults() {
  return {
    responsive: true,
    maintainAspectRatio: true,
    animation: { duration: 800, easing: 'easeOutQuart' },
    plugins: {
      legend: { labels: { color: '#94A3B8', font: { family: 'Inter', size: 12 } } },
      tooltip: {
        backgroundColor: '#1E293B', titleColor: '#F1F5F9', bodyColor: '#94A3B8',
        borderColor: '#334155', borderWidth: 1, cornerRadius: 8, padding: 12,
        titleFont: { family: 'Inter', weight: '600' }, bodyFont: { family: 'Inter' }
      }
    },
    scales: {
      x: { ticks: { color: '#64748B', font: { family: 'Inter', size: 11 } }, grid: { color: 'rgba(51,65,85,0.5)' } },
      y: { ticks: { color: '#64748B', font: { family: 'Inter', size: 11 } }, grid: { color: 'rgba(51,65,85,0.5)' } }
    }
  };
}

/**
 * Render all appropriate charts based on data and analysis results
 */
function renderAllCharts(data, colTypes, checks, results) {
  destroyAllCharts();
  const grid = document.getElementById('chartsGrid');
  grid.innerHTML = '';

  const numCols = getNumericColumns(colTypes);
  const catCols = getCategoricalColumns(colTypes);

  // 1. Bar Chart — top categories (if categorical data exists)
  if (catCols.length > 0 && results.descriptive) {
    const catCol = catCols[0];
    const summary = results.descriptive.categorySummaries[catCol];
    if (summary && summary.length > 0) {
      const canvas = addChartContainer(grid, `${catCol} — Top Categories`);
      const chart = new Chart(canvas, {
        type: 'bar',
        data: {
          labels: summary.map(s => truncateLabel(s.label)),
          datasets: [{
            label: 'Count',
            data: summary.map(s => s.count),
            backgroundColor: CHART_COLORS.slice(0, summary.length).map(c => c + '99'),
            borderColor: CHART_COLORS.slice(0, summary.length),
            borderWidth: 1, borderRadius: 6, maxBarThickness: 50
          }]
        },
        options: { ...getChartDefaults(), plugins: { ...getChartDefaults().plugins, legend: { display: false } } }
      });
      activeCharts.push(chart);
    }
  }

  // 2. Line Chart — first numeric column trend
  if (numCols.length > 0) {
    const col = numCols[0];
    const vals = getNumericValues(data, col).slice(0, 50);
    if (vals.length > 2) {
      const canvas = addChartContainer(grid, `${col} — Trend`);
      const chart = new Chart(canvas, {
        type: 'line',
        data: {
          labels: vals.map((_, i) => i + 1),
          datasets: [{
            label: col, data: vals,
            borderColor: '#3B82F6', backgroundColor: 'rgba(59,130,246,0.1)',
            tension: 0.4, fill: true, pointRadius: 2, pointHoverRadius: 5, borderWidth: 2
          }]
        },
        options: getChartDefaults()
      });
      activeCharts.push(chart);
    }
  }

  // 3. Pie/Donut Chart — category proportions
  if (catCols.length > 0 && results.descriptive) {
    const catCol = catCols.length > 1 ? catCols[1] : catCols[0];
    const summary = results.descriptive.categorySummaries[catCol];
    if (summary && summary.length > 1) {
      const canvas = addChartContainer(grid, `${catCol} — Distribution`);
      const chart = new Chart(canvas, {
        type: 'doughnut',
        data: {
          labels: summary.slice(0, 8).map(s => truncateLabel(s.label)),
          datasets: [{
            data: summary.slice(0, 8).map(s => s.count),
            backgroundColor: CHART_COLORS.slice(0, 8).map(c => c + 'CC'),
            borderColor: '#1E293B', borderWidth: 2, hoverOffset: 8
          }]
        },
        options: {
          responsive: true, maintainAspectRatio: true,
          animation: { duration: 800 },
          plugins: {
            legend: { position: 'right', labels: { color: '#94A3B8', font: { family: 'Inter', size: 11 }, padding: 12 } },
            tooltip: getChartDefaults().plugins.tooltip
          }
        }
      });
      activeCharts.push(chart);
    }
  }

  // 4. Histogram — distribution of first numeric column
  if (numCols.length > 0) {
    const col = numCols.length > 1 ? numCols[1] : numCols[0];
    const vals = getNumericValues(data, col);
    if (vals.length > 5) {
      const bins = createHistogramBins(vals, 12);
      const canvas = addChartContainer(grid, `${col} — Distribution`);
      const chart = new Chart(canvas, {
        type: 'bar',
        data: {
          labels: bins.map(b => formatNumber(b.min) + '–' + formatNumber(b.max)),
          datasets: [{
            label: 'Frequency', data: bins.map(b => b.count),
            backgroundColor: 'rgba(139,92,246,0.5)', borderColor: '#8B5CF6',
            borderWidth: 1, borderRadius: 4
          }]
        },
        options: { ...getChartDefaults(), plugins: { ...getChartDefaults().plugins, legend: { display: false } } }
      });
      activeCharts.push(chart);
    }
  }

  // 5. Scatter Plot — correlation between first two numeric cols
  if (numCols.length >= 2 && checks.diagnostic) {
    const colX = numCols[0], colY = numCols[1];
    const points = data.map(r => ({ x: parseFloat(r[colX]), y: parseFloat(r[colY]) }))
      .filter(p => !isNaN(p.x) && !isNaN(p.y)).slice(0, 200);
    if (points.length > 3) {
      const canvas = addChartContainer(grid, `${colX} vs ${colY} — Scatter`);
      const chart = new Chart(canvas, {
        type: 'scatter',
        data: {
          datasets: [{
            label: `${colX} vs ${colY}`, data: points,
            backgroundColor: 'rgba(16,185,129,0.5)', borderColor: '#10B981',
            pointRadius: 4, pointHoverRadius: 7
          }]
        },
        options: {
          ...getChartDefaults(),
          scales: {
            x: { ...getChartDefaults().scales.x, title: { display: true, text: colX, color: '#94A3B8' } },
            y: { ...getChartDefaults().scales.y, title: { display: true, text: colY, color: '#94A3B8' } }
          }
        }
      });
      activeCharts.push(chart);
    }
  }

  // 6. Correlation Heatmap (as colored bar chart of correlation values)
  if (checks.diagnostic && results.diagnostic && Object.keys(results.diagnostic.correlations).length > 0) {
    const corrs = results.diagnostic.correlations;
    const entries = Object.entries(corrs).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 10);
    const canvas = addChartContainer(grid, 'Correlation Strengths');
    const chart = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: entries.map(([k]) => truncateLabel(k, 25)),
        datasets: [{
          label: 'Pearson r',
          data: entries.map(([, v]) => v),
          backgroundColor: entries.map(([, v]) => v > 0 ? 'rgba(16,185,129,0.6)' : 'rgba(239,68,68,0.6)'),
          borderColor: entries.map(([, v]) => v > 0 ? '#10B981' : '#EF4444'),
          borderWidth: 1, borderRadius: 4
        }]
      },
      options: {
        ...getChartDefaults(), indexAxis: 'y',
        scales: {
          x: { ...getChartDefaults().scales.x, min: -1, max: 1 },
          y: { ...getChartDefaults().scales.y, ticks: { ...getChartDefaults().scales.y.ticks, font: { size: 10, family: 'Inter' } } }
        }
      }
    });
    activeCharts.push(chart);
  }

  // 7. Forecast Chart
  if (checks.predictive && results.predictive && results.predictive.forecasts) {
    const firstKey = Object.keys(results.predictive.forecasts)[0];
    if (firstKey) {
      const fc = results.predictive.forecasts[firstKey];
      const actualLabels = fc.actual.map((_, i) => i + 1);
      const allLabels = [...actualLabels, ...fc.forecast.map(f => f.period + 1)];
      const actualData = [...fc.actual, ...fc.forecast.map(() => null)];
      const forecastData = [...fc.actual.map(() => null)];
      forecastData[forecastData.length - 1] = fc.actual[fc.actual.length - 1]; // connect
      fc.forecast.forEach(f => forecastData.push(f.value));

      // Confidence band
      const upperBand = forecastData.map(v => v !== null ? v + fc.stdError : null);
      const lowerBand = forecastData.map(v => v !== null ? v - fc.stdError : null);

      const canvas = addChartContainer(grid, `${firstKey} — Forecast (R²: ${fc.r2.toFixed(3)})`);
      const chart = new Chart(canvas, {
        type: 'line',
        data: {
          labels: allLabels,
          datasets: [
            {
              label: 'Actual', data: actualData,
              borderColor: '#3B82F6', backgroundColor: 'rgba(59,130,246,0.1)',
              tension: 0.3, fill: false, pointRadius: 2, borderWidth: 2
            },
            {
              label: 'Forecast', data: forecastData,
              borderColor: '#F59E0B', backgroundColor: 'rgba(245,158,11,0.1)',
              tension: 0.3, fill: false, borderDash: [6, 3], pointRadius: 3, borderWidth: 2
            },
            {
              label: 'Upper Bound', data: upperBand,
              borderColor: 'transparent', backgroundColor: 'rgba(245,158,11,0.08)',
              tension: 0.3, fill: '+1', pointRadius: 0, borderWidth: 0
            },
            {
              label: 'Lower Bound', data: lowerBand,
              borderColor: 'transparent', backgroundColor: 'rgba(245,158,11,0.08)',
              tension: 0.3, fill: '-1', pointRadius: 0, borderWidth: 0
            }
          ]
        },
        options: {
          ...getChartDefaults(),
          plugins: {
            ...getChartDefaults().plugins,
            legend: { labels: { color: '#94A3B8', font: { family: 'Inter', size: 11 }, filter: item => item.text !== 'Upper Bound' && item.text !== 'Lower Bound' } }
          }
        }
      });
      activeCharts.push(chart);
    }
  }
}

/* ── Helpers ── */
function addChartContainer(grid, title) {
  const div = document.createElement('div');
  div.className = 'chart-container';
  div.innerHTML = `<h4>${title}</h4><canvas></canvas>`;
  grid.appendChild(div);
  return div.querySelector('canvas');
}

function truncateLabel(str, maxLen = 18) {
  if (!str) return '';
  str = String(str);
  return str.length > maxLen ? str.substring(0, maxLen) + '…' : str;
}

function createHistogramBins(values, numBins) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const binWidth = (max - min) / numBins || 1;
  const bins = [];
  for (let i = 0; i < numBins; i++) {
    bins.push({ min: min + i * binWidth, max: min + (i + 1) * binWidth, count: 0 });
  }
  values.forEach(v => {
    let idx = Math.floor((v - min) / binWidth);
    if (idx >= numBins) idx = numBins - 1;
    if (idx < 0) idx = 0;
    bins[idx].count++;
  });
  return bins;
}
