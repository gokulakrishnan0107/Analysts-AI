/* ═══════════════════════════════════════
   AnalystAI — Analysis Engines (analysis.js)
   Descriptive, Diagnostic, Predictive, Prescriptive
   + Business Analyst extensions
   ═══════════════════════════════════════ */

/**
 * Run all selected analyses
 */
function runAllAnalyses(data, colTypes, checks, role) {
  const results = { kpis: [], narrative: '', recommendations: [], swot: null, risks: null };
  const numCols = getNumericColumns(colTypes);
  const catCols = getCategoricalColumns(colTypes);
  const dateCols = getDateColumns(colTypes);

  if (checks.descriptive) {
    results.descriptive = descriptiveAnalysis(data, numCols, catCols, colTypes);
    results.kpis.push(...results.descriptive.kpis);
  }
  if (checks.diagnostic) {
    results.diagnostic = diagnosticAnalysis(data, numCols, colTypes);
  }
  if (checks.predictive) {
    results.predictive = predictiveAnalysis(data, numCols, dateCols);
  }
  if (checks.prescriptive) {
    results.recommendations = prescriptiveAnalysis(data, numCols, catCols, colTypes, results);
  }
  if (role === 'ba') {
    results.swot = generateSWOT(data, numCols, catCols, colTypes, results);
    results.risks = generateRiskMatrix(data, numCols, colTypes, results);
  }
  return results;
}

/* ─────────────────────────────────────
   DESCRIPTIVE ANALYSIS
   ───────────────────────────────────── */
function descriptiveAnalysis(data, numCols, catCols, colTypes) {
  const stats = {};
  const kpis = [];

  numCols.forEach(col => {
    const vals = getNumericValues(data, col);
    if (vals.length === 0) return;
    const sorted = [...vals].sort((a, b) => a - b);
    const sum = vals.reduce((a, b) => a + b, 0);
    const mean = sum / vals.length;
    const median = sorted.length % 2 === 0
      ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
      : sorted[Math.floor(sorted.length / 2)];
    const variance = vals.reduce((acc, v) => acc + (v - mean) ** 2, 0) / vals.length;
    const stdDev = Math.sqrt(variance);
    const mode = calcMode(vals);

    stats[col] = {
      count: vals.length, sum, mean, median, mode,
      stdDev, variance,
      min: sorted[0], max: sorted[sorted.length - 1],
      range: sorted[sorted.length - 1] - sorted[0],
      nullCount: colTypes[col].nullCount
    };
  });

  // Build KPIs from first few numeric cols
  const topCols = numCols.slice(0, 4);
  topCols.forEach(col => {
    if (stats[col]) {
      kpis.push({
        label: col,
        value: formatNumber(stats[col].mean),
        change: `Range: ${formatNumber(stats[col].min)} – ${formatNumber(stats[col].max)}`
      });
    }
  });

  // Add total rows as KPI
  kpis.unshift({ label: 'Total Records', value: data.length.toLocaleString() });

  // Category summaries
  const categorySummaries = {};
  catCols.forEach(col => {
    const counts = {};
    data.forEach(r => { const v = r[col]; if (v) counts[v] = (counts[v] || 0) + 1; });
    categorySummaries[col] = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([label, count]) => ({ label, count }));
  });

  return { stats, kpis, categorySummaries };
}

function calcMode(arr) {
  const freq = {};
  arr.forEach(v => freq[v] = (freq[v] || 0) + 1);
  let maxFreq = 0, mode = arr[0];
  for (const [val, count] of Object.entries(freq)) {
    if (count > maxFreq) { maxFreq = count; mode = Number(val); }
  }
  return mode;
}

/* ─────────────────────────────────────
   DIAGNOSTIC ANALYSIS
   ───────────────────────────────────── */
function diagnosticAnalysis(data, numCols, colTypes) {
  const correlations = {};
  const outliers = {};

  // Pearson correlations
  for (let i = 0; i < numCols.length; i++) {
    for (let j = i + 1; j < numCols.length; j++) {
      const r = pearsonCorrelation(data, numCols[i], numCols[j]);
      if (r !== null) {
        const key = `${numCols[i]} × ${numCols[j]}`;
        correlations[key] = r;
      }
    }
  }

  // Outlier detection (IQR method)
  numCols.forEach(col => {
    const vals = getNumericValues(data, col);
    if (vals.length < 4) return;
    const sorted = [...vals].sort((a, b) => a - b);
    const q1 = sorted[Math.floor(sorted.length * 0.25)];
    const q3 = sorted[Math.floor(sorted.length * 0.75)];
    const iqr = q3 - q1;
    const lower = q1 - 1.5 * iqr;
    const upper = q3 + 1.5 * iqr;
    const outVals = vals.filter(v => v < lower || v > upper);
    if (outVals.length > 0) {
      outliers[col] = { count: outVals.length, lower, upper, values: outVals.slice(0, 5) };
    }
  });

  return { correlations, outliers };
}

function pearsonCorrelation(data, col1, col2) {
  const pairs = data
    .map(r => [parseFloat(r[col1]), parseFloat(r[col2])])
    .filter(([a, b]) => !isNaN(a) && !isNaN(b));
  if (pairs.length < 3) return null;

  const n = pairs.length;
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;
  pairs.forEach(([x, y]) => { sumX += x; sumY += y; sumXY += x * y; sumX2 += x * x; sumY2 += y * y; });
  const denom = Math.sqrt((n * sumX2 - sumX ** 2) * (n * sumY2 - sumY ** 2));
  if (denom === 0) return 0;
  return (n * sumXY - sumX * sumY) / denom;
}

/* ─────────────────────────────────────
   PREDICTIVE ANALYSIS
   ───────────────────────────────────── */
function predictiveAnalysis(data, numCols, dateCols) {
  const forecasts = {};

  // Use first numeric column as target
  const target = numCols[0];
  if (!target) return forecasts;

  const values = getNumericValues(data, target);
  if (values.length < 3) return forecasts;

  // Simple linear regression on index
  const n = values.length;
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  values.forEach((y, x) => { sumX += x; sumY += y; sumXY += x * y; sumX2 += x * x; });
  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX ** 2);
  const intercept = (sumY - slope * sumX) / n;

  // R² score
  const yMean = sumY / n;
  let ssRes = 0, ssTot = 0;
  values.forEach((y, x) => { const yHat = slope * x + intercept; ssRes += (y - yHat) ** 2; ssTot += (y - yMean) ** 2; });
  const r2 = ssTot === 0 ? 0 : 1 - ssRes / ssTot;

  // Forecast next 5 periods
  const forecastValues = [];
  for (let i = 0; i < 5; i++) {
    forecastValues.push({
      period: n + i,
      value: slope * (n + i) + intercept
    });
  }

  // Confidence band (simple ±1 std error)
  const stdError = Math.sqrt(ssRes / (n - 2)) || 0;

  forecasts[target] = {
    slope, intercept, r2, stdError,
    trend: slope > 0 ? 'Upward' : slope < 0 ? 'Downward' : 'Flat',
    actual: values,
    forecast: forecastValues
  };

  // Also do for second numeric column if available
  if (numCols[1]) {
    const vals2 = getNumericValues(data, numCols[1]);
    if (vals2.length >= 3) {
      const n2 = vals2.length;
      let sX = 0, sY = 0, sXY = 0, sX2 = 0;
      vals2.forEach((y, x) => { sX += x; sY += y; sXY += x * y; sX2 += x * x; });
      const sl2 = (n2 * sXY - sX * sY) / (n2 * sX2 - sX ** 2);
      const int2 = (sY - sl2 * sX) / n2;
      const yM2 = sY / n2;
      let ssR2 = 0, ssT2 = 0;
      vals2.forEach((y, x) => { const yH = sl2 * x + int2; ssR2 += (y - yH) ** 2; ssT2 += (y - yM2) ** 2; });
      const r22 = ssT2 === 0 ? 0 : 1 - ssR2 / ssT2;
      const fc2 = [];
      for (let i = 0; i < 5; i++) fc2.push({ period: n2 + i, value: sl2 * (n2 + i) + int2 });
      forecasts[numCols[1]] = {
        slope: sl2, intercept: int2, r2: r22,
        stdError: Math.sqrt(ssR2 / (n2 - 2)) || 0,
        trend: sl2 > 0 ? 'Upward' : sl2 < 0 ? 'Downward' : 'Flat',
        actual: vals2, forecast: fc2
      };
    }
  }

  return { forecasts };
}

/* ─────────────────────────────────────
   PRESCRIPTIVE ANALYSIS
   ───────────────────────────────────── */
function prescriptiveAnalysis(data, numCols, catCols, colTypes, results) {
  const recs = [];

  // Generate data-driven recommendations
  numCols.forEach(col => {
    const vals = getNumericValues(data, col);
    if (vals.length === 0) return;
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const sorted = [...vals].sort((a, b) => a - b);
    const min = sorted[0];
    const max = sorted[sorted.length - 1];
    const stdDev = Math.sqrt(vals.reduce((acc, v) => acc + (v - mean) ** 2, 0) / vals.length);
    const cv = mean !== 0 ? (stdDev / Math.abs(mean)) * 100 : 0;

    if (cv > 50) {
      recs.push({
        action: `Reduce variability in "${col}"`,
        outcome: `Current coefficient of variation is ${cv.toFixed(1)}%. Standardizing processes could improve consistency by 30-40%.`,
        priority: 'High',
        timeline: '2-4 weeks'
      });
    }

    // Check for outliers
    if (results.diagnostic && results.diagnostic.outliers[col]) {
      const out = results.diagnostic.outliers[col];
      recs.push({
        action: `Investigate ${out.count} outliers in "${col}"`,
        outcome: `Values outside ${formatNumber(out.lower)} – ${formatNumber(out.upper)} may indicate errors or special cases.`,
        priority: 'Medium',
        timeline: '1-2 weeks'
      });
    }
  });

  // Trend-based recommendation
  if (results.predictive && results.predictive.forecasts) {
    Object.entries(results.predictive.forecasts).forEach(([col, fc]) => {
      if (fc.trend === 'Downward') {
        recs.push({
          action: `Address declining trend in "${col}"`,
          outcome: `Current trend shows a decrease of ${formatNumber(Math.abs(fc.slope))} per period. Immediate intervention could reverse the trend.`,
          priority: 'High',
          timeline: '1-3 weeks'
        });
      } else if (fc.trend === 'Upward' && fc.r2 > 0.5) {
        recs.push({
          action: `Capitalize on growth in "${col}"`,
          outcome: `Strong upward trend (R²=${fc.r2.toFixed(2)}). Investing further could accelerate growth.`,
          priority: 'Medium',
          timeline: '2-6 weeks'
        });
      }
    });
  }

  // Missing data recommendation
  const colsWithMissing = Object.entries(colTypes).filter(([, info]) => info.nullCount > 0);
  if (colsWithMissing.length > 0) {
    const totalMissing = colsWithMissing.reduce((sum, [, info]) => sum + info.nullCount, 0);
    recs.push({
      action: `Clean missing data across ${colsWithMissing.length} columns`,
      outcome: `${totalMissing} missing values found. Data completeness improvement will increase analysis accuracy.`,
      priority: 'Low',
      timeline: '1 week'
    });
  }

  // Ensure at least 3 recommendations
  while (recs.length < 3) {
    recs.push({
      action: 'Establish regular data review cycles',
      outcome: 'Regular monitoring prevents data quality degradation and enables proactive decision-making.',
      priority: 'Low',
      timeline: 'Ongoing'
    });
    if (recs.length < 3) {
      recs.push({
        action: 'Expand data collection to cover additional metrics',
        outcome: 'Broader datasets enable more comprehensive analysis and better predictive models.',
        priority: 'Medium',
        timeline: '4-8 weeks'
      });
    }
  }

  return recs.slice(0, 5);
}

/* ─────────────────────────────────────
   BUSINESS ANALYST EXTENSIONS
   ───────────────────────────────────── */
function generateSWOT(data, numCols, catCols, colTypes, results) {
  const strengths = [], weaknesses = [], opportunities = [], threats = [];

  numCols.forEach(col => {
    const vals = getNumericValues(data, col);
    if (vals.length === 0) return;
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const sorted = [...vals].sort((a, b) => a - b);
    const stdDev = Math.sqrt(vals.reduce((acc, v) => acc + (v - mean) ** 2, 0) / vals.length);
    const cv = mean !== 0 ? (stdDev / Math.abs(mean)) * 100 : 0;

    if (cv < 20) strengths.push(`Consistent performance in "${col}" (CV: ${cv.toFixed(1)}%)`);
    else if (cv > 50) weaknesses.push(`High variability in "${col}" (CV: ${cv.toFixed(1)}%)`);

    if (results.predictive && results.predictive.forecasts && results.predictive.forecasts[col]) {
      const trend = results.predictive.forecasts[col].trend;
      if (trend === 'Upward') opportunities.push(`Rising trend in "${col}" indicates growth potential`);
      if (trend === 'Downward') threats.push(`Declining trend in "${col}" requires attention`);
    }
  });

  // Ensure at least 2 items per category
  if (strengths.length < 2) { strengths.push('Comprehensive dataset available for analysis'); strengths.push(`${data.length} data points provide statistical significance`); }
  if (weaknesses.length < 2) { weaknesses.push('Data gaps may limit predictive accuracy'); weaknesses.push('Limited time-series depth for long-term forecasting'); }
  if (opportunities.length < 2) { opportunities.push('Cross-column correlations reveal optimization potential'); opportunities.push('Data-driven decisions can improve outcomes by 15-25%'); }
  if (threats.length < 2) { threats.push('Outlier values may distort strategic conclusions'); threats.push('External factors not captured in current dataset'); }

  return {
    strengths: strengths.slice(0, 4),
    weaknesses: weaknesses.slice(0, 4),
    opportunities: opportunities.slice(0, 4),
    threats: threats.slice(0, 4)
  };
}

function generateRiskMatrix(data, numCols, colTypes, results) {
  const risks = [];

  // Data quality risk
  const totalCells = data.length * Object.keys(colTypes).length;
  const missingCells = Object.values(colTypes).reduce((sum, info) => sum + info.nullCount, 0);
  const missingPct = (missingCells / totalCells * 100).toFixed(1);

  risks.push({
    risk: 'Data Quality Degradation',
    likelihood: missingPct > 10 ? 'High' : missingPct > 5 ? 'Medium' : 'Low',
    impact: 'High',
    mitigation: `Address ${missingPct}% missing values through data validation protocols`
  });

  // Variability risk
  numCols.slice(0, 2).forEach(col => {
    const vals = getNumericValues(data, col);
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const stdDev = Math.sqrt(vals.reduce((acc, v) => acc + (v - mean) ** 2, 0) / vals.length);
    const cv = mean !== 0 ? (stdDev / Math.abs(mean)) * 100 : 0;
    risks.push({
      risk: `Volatility in ${col}`,
      likelihood: cv > 40 ? 'High' : cv > 20 ? 'Medium' : 'Low',
      impact: 'Medium',
      mitigation: `Implement monitoring thresholds at ±${formatNumber(stdDev)} from mean`
    });
  });

  risks.push({
    risk: 'Prediction Model Drift',
    likelihood: 'Medium',
    impact: 'Medium',
    mitigation: 'Schedule quarterly model revalidation and recalibration'
  });

  return risks.slice(0, 5);
}
