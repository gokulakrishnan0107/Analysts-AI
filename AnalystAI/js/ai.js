/* ═══════════════════════════════════════
   AnalystAI — AI Query Engine (ai.js)
   Claude API integration + fallback engine
   ═══════════════════════════════════════ */

/**
 * Generate AI response — uses Claude API if key provided, else rule-based fallback
 */
async function generateAIResponse(data, colTypes, results, query, apiKey, role) {
  const responseBody = document.getElementById('aiResponseBody');
  responseBody.innerHTML = '<span class="typing-cursor"></span>';

  if (apiKey && apiKey.startsWith('sk-')) {
    await callClaudeAPI(data, colTypes, results, query, apiKey, role, responseBody);
  } else {
    const response = generateFallbackResponse(data, colTypes, results, query, role);
    await typewriterEffect(responseBody, response);
  }
}

/* ─────────────────────────────────────
   CLAUDE API CALL (Streaming)
   ───────────────────────────────────── */
async function callClaudeAPI(data, colTypes, results, query, apiKey, role, container) {
  const sampleData = data.slice(0, 15);
  const columns = Object.entries(colTypes).map(([col, info]) =>
    `${col} (${info.type}, ${info.nullCount} nulls, ${info.uniqueCount} unique)`
  ).join('\n');

  let statsText = '';
  if (results.descriptive) {
    const s = results.descriptive.stats;
    statsText = Object.entries(s).map(([col, st]) =>
      `${col}: mean=${formatNumber(st.mean)}, median=${formatNumber(st.median)}, std=${formatNumber(st.stdDev)}, min=${formatNumber(st.min)}, max=${formatNumber(st.max)}`
    ).join('\n');
  }

  const roleDesc = role === 'ba'
    ? 'You are an expert Business Analyst. Provide strategic insights, SWOT perspectives, process analysis, and business recommendations.'
    : 'You are an expert Data Analyst. Provide statistical insights, trend analysis, data quality observations, and actionable findings.';

  const systemPrompt = `${roleDesc}
Analyze the provided dataset and respond with clear, structured insights.
Format your response with these sections using h4 tags:
<h4>📊 Summary</h4> - Brief overview
<h4>🔍 Key Findings</h4> - Top discoveries as a bullet list
<h4>📈 Next Steps</h4> - Recommended actions
Keep responses concise but insightful. Use actual numbers from the data.`;

  const userMessage = `Dataset: ${data.length} rows, ${Object.keys(colTypes).length} columns.

Columns:
${columns}

Statistics:
${statsText}

Sample rows (JSON):
${JSON.stringify(sampleData, null, 2).substring(0, 2000)}

${query ? `User question: "${query}"` : 'Provide a comprehensive analysis of this dataset.'}`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1500,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
        stream: true
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`API error (${response.status}): ${errText.substring(0, 200)}`);
    }

    // Stream reading
    container.innerHTML = '';
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullText = '';
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const jsonStr = line.slice(6).trim();
          if (jsonStr === '[DONE]') continue;
          try {
            const parsed = JSON.parse(jsonStr);
            if (parsed.type === 'content_block_delta' && parsed.delta && parsed.delta.text) {
              fullText += parsed.delta.text;
              container.innerHTML = fullText + '<span class="typing-cursor"></span>';
              container.scrollTop = container.scrollHeight;
            }
          } catch (e) { /* skip parse errors for non-JSON lines */ }
        }
      }
    }

    container.innerHTML = fullText;
    showToast('AI response complete', 'success');
  } catch (err) {
    console.error('Claude API error:', err);
    showToast('API error — using fallback engine', 'warning');
    const fallback = generateFallbackResponse(data, colTypes, results, query, role);
    await typewriterEffect(container, fallback);
  }
}

/* ─────────────────────────────────────
   FALLBACK RULE-BASED ENGINE
   ───────────────────────────────────── */
function generateFallbackResponse(data, colTypes, results, query, role) {
  const numCols = getNumericColumns(colTypes);
  const catCols = getCategoricalColumns(colTypes);
  const totalRows = data.length;
  const totalCols = Object.keys(colTypes).length;

  // Calculate overall missing data
  const totalCells = totalRows * totalCols;
  const missingCells = Object.values(colTypes).reduce((sum, info) => sum + info.nullCount, 0);
  const qualityScore = ((1 - missingCells / totalCells) * 100).toFixed(1);

  let html = '';

  // ── Summary Section ──
  html += '<h4>📊 Summary</h4>';
  html += `<p>Your dataset contains <strong>${totalRows.toLocaleString()} records</strong> across <strong>${totalCols} columns</strong> `;
  html += `(${numCols.length} numeric, ${catCols.length} categorical). `;
  html += `Data quality score: <strong>${qualityScore}%</strong>`;
  if (missingCells > 0) html += ` with ${missingCells} missing values detected`;
  html += '.</p>';

  // Add descriptive insights
  if (results.descriptive && results.descriptive.stats) {
    const stats = results.descriptive.stats;
    const topCol = numCols[0];
    if (topCol && stats[topCol]) {
      const s = stats[topCol];
      html += `<p>The primary metric "<strong>${topCol}</strong>" has a mean of <strong>${formatNumber(s.mean)}</strong> `;
      html += `(median: ${formatNumber(s.median)}) with values ranging from ${formatNumber(s.min)} to ${formatNumber(s.max)}. `;
      const cv = s.mean !== 0 ? ((s.stdDev / Math.abs(s.mean)) * 100).toFixed(1) : '0';
      html += `Coefficient of variation is ${cv}%, indicating ${cv < 20 ? 'low' : cv < 50 ? 'moderate' : 'high'} variability.</p>`;
    }
  }

  // ── Key Findings ──
  html += '<h4>🔍 Key Findings</h4><ul>';

  // Correlation findings
  if (results.diagnostic && results.diagnostic.correlations) {
    const corrs = Object.entries(results.diagnostic.correlations)
      .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
    if (corrs.length > 0) {
      const [pair, val] = corrs[0];
      const strength = Math.abs(val) > 0.7 ? 'strong' : Math.abs(val) > 0.4 ? 'moderate' : 'weak';
      html += `<li><strong>Correlation:</strong> ${pair} shows a ${strength} ${val > 0 ? 'positive' : 'negative'} correlation (r = ${val.toFixed(3)}).</li>`;
    }
  }

  // Outlier findings
  if (results.diagnostic && results.diagnostic.outliers) {
    const outCols = Object.entries(results.diagnostic.outliers);
    if (outCols.length > 0) {
      const [col, info] = outCols[0];
      html += `<li><strong>Outliers:</strong> ${info.count} outlier values detected in "${col}" outside the range [${formatNumber(info.lower)}, ${formatNumber(info.upper)}].</li>`;
    }
  }

  // Predictive findings
  if (results.predictive && results.predictive.forecasts) {
    const firstKey = Object.keys(results.predictive.forecasts)[0];
    if (firstKey) {
      const fc = results.predictive.forecasts[firstKey];
      html += `<li><strong>Trend:</strong> "${firstKey}" shows an <strong>${fc.trend.toLowerCase()}</strong> trend `;
      html += `(slope: ${formatNumber(fc.slope)}/period, R² = ${fc.r2.toFixed(3)}). `;
      const lastForecast = fc.forecast[fc.forecast.length - 1];
      html += `Projected value in 5 periods: <strong>${formatNumber(lastForecast.value)}</strong>.</li>`;
    }
  }

  // Category finding
  if (catCols.length > 0 && results.descriptive && results.descriptive.categorySummaries) {
    const catCol = catCols[0];
    const summary = results.descriptive.categorySummaries[catCol];
    if (summary && summary.length > 0) {
      html += `<li><strong>Top category:</strong> In "${catCol}", "${summary[0].label}" is the most frequent value (${summary[0].count} occurrences, ${((summary[0].count / totalRows) * 100).toFixed(1)}% of records).</li>`;
    }
  }

  // Data quality finding
  if (missingCells > 0) {
    const worstCol = Object.entries(colTypes).sort((a, b) => b[1].nullCount - a[1].nullCount)[0];
    html += `<li><strong>Data quality:</strong> "${worstCol[0]}" has the most missing values (${worstCol[1].nullCount} nulls, ${((worstCol[1].nullCount / totalRows) * 100).toFixed(1)}%).</li>`;
  } else {
    html += '<li><strong>Data quality:</strong> No missing values detected — dataset is fully complete.</li>';
  }

  html += '</ul>';

  // ── Handle user query ──
  if (query) {
    html += '<h4>💬 Answer to Your Question</h4>';
    html += `<p>${answerUserQuery(query, data, colTypes, results)}</p>`;
  }

  // ── Next Steps ──
  html += '<h4>📈 Next Steps</h4><ul>';

  if (role === 'ba') {
    html += '<li>Review the SWOT analysis below for strategic positioning insights.</li>';
    html += '<li>Examine the risk matrix to prioritize mitigation strategies.</li>';
    html += '<li>Use the recommendations to build a prioritized action roadmap.</li>';
    html += '<li>Share KPI dashboard with stakeholders for alignment.</li>';
  } else {
    html += '<li>Review the charts below for visual patterns and anomalies.</li>';
    if (results.diagnostic && Object.keys(results.diagnostic.outliers).length > 0) {
      html += '<li>Investigate flagged outliers — they may represent data errors or significant events.</li>';
    }
    html += '<li>If forecast accuracy needs improvement, consider adding more historical data points.</li>';
    html += '<li>Examine correlations to understand variable relationships and potential causation.</li>';
  }

  html += '</ul>';

  return html;
}

/**
 * Answer a specific user query using dataset stats
 */
function answerUserQuery(query, data, colTypes, results) {
  const q = query.toLowerCase();
  const numCols = getNumericColumns(colTypes);
  const catCols = getCategoricalColumns(colTypes);

  // Check for column mentions
  const mentionedCol = Object.keys(colTypes).find(col => q.includes(col.toLowerCase()));

  if (q.includes('why') && q.includes('drop') || q.includes('decline') || q.includes('decrease')) {
    if (results.diagnostic && results.diagnostic.correlations) {
      const corrs = Object.entries(results.diagnostic.correlations).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
      if (corrs.length > 0) {
        return `Based on diagnostic analysis, the strongest correlation found is ${corrs[0][0]} (r = ${corrs[0][1].toFixed(3)}). This relationship suggests that changes in one variable are ${Math.abs(corrs[0][1]) > 0.5 ? 'strongly' : 'moderately'} associated with changes in the other. Investigate this relationship for potential root causes of the decline.`;
      }
    }
    return 'The diagnostic analysis shows multiple factors at play. Review the correlation chart and outlier analysis for clues about what may be driving the decline.';
  }

  if (q.includes('average') || q.includes('mean')) {
    if (mentionedCol && results.descriptive && results.descriptive.stats[mentionedCol]) {
      const s = results.descriptive.stats[mentionedCol];
      return `The average (mean) of "${mentionedCol}" is ${formatNumber(s.mean)}, with a median of ${formatNumber(s.median)} and standard deviation of ${formatNumber(s.stdDev)}.`;
    }
    if (numCols.length > 0 && results.descriptive) {
      const summaries = numCols.map(c => results.descriptive.stats[c] ? `${c}: ${formatNumber(results.descriptive.stats[c].mean)}` : null).filter(Boolean);
      return `Here are the averages for numeric columns: ${summaries.join(', ')}.`;
    }
  }

  if (q.includes('forecast') || q.includes('predict') || q.includes('future') || q.includes('project')) {
    if (results.predictive && results.predictive.forecasts) {
      const key = Object.keys(results.predictive.forecasts)[0];
      if (key) {
        const fc = results.predictive.forecasts[key];
        const vals = fc.forecast.map(f => formatNumber(f.value)).join(', ');
        return `Based on linear regression (R² = ${fc.r2.toFixed(3)}), the ${fc.trend.toLowerCase()} trend in "${key}" projects the following values for the next 5 periods: ${vals}. The model explains ${(fc.r2 * 100).toFixed(1)}% of the variance.`;
      }
    }
    return 'Enable Predictive Analysis to generate forecasts based on your data trends.';
  }

  if (q.includes('best') || q.includes('top') || q.includes('highest') || q.includes('most')) {
    if (catCols.length > 0 && results.descriptive && results.descriptive.categorySummaries) {
      const cat = catCols[0];
      const top = results.descriptive.categorySummaries[cat];
      if (top && top.length > 0) {
        return `The top values in "${cat}" are: ${top.slice(0, 5).map(t => `${t.label} (${t.count})`).join(', ')}.`;
      }
    }
    if (numCols.length > 0 && results.descriptive && results.descriptive.stats[numCols[0]]) {
      const s = results.descriptive.stats[numCols[0]];
      return `The highest value in "${numCols[0]}" is ${formatNumber(s.max)}, while the lowest is ${formatNumber(s.min)}.`;
    }
  }

  if (q.includes('outlier') || q.includes('anomal')) {
    if (results.diagnostic && results.diagnostic.outliers) {
      const outs = Object.entries(results.diagnostic.outliers);
      if (outs.length > 0) {
        return outs.map(([col, info]) => `"${col}" has ${info.count} outliers outside [${formatNumber(info.lower)}, ${formatNumber(info.upper)}]`).join('. ') + '. These values may represent data entry errors or genuinely unusual observations worth investigating.';
      }
    }
    return 'No significant outliers were detected using the IQR method. Your data appears relatively clean.';
  }

  if (q.includes('correlat') || q.includes('relationship') || q.includes('related')) {
    if (results.diagnostic && results.diagnostic.correlations) {
      const corrs = Object.entries(results.diagnostic.correlations).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 3);
      if (corrs.length > 0) {
        return 'Top correlations found: ' + corrs.map(([pair, val]) => `${pair}: r = ${val.toFixed(3)} (${Math.abs(val) > 0.7 ? 'strong' : Math.abs(val) > 0.4 ? 'moderate' : 'weak'})`).join('; ') + '.';
      }
    }
    return 'Enable Diagnostic Analysis to discover correlations between your numeric variables.';
  }

  // Generic response
  return `Based on the analysis of your ${data.length}-row dataset, the key patterns and insights are displayed in the charts and metrics above. The data contains ${numCols.length} numeric columns and ${catCols.length} categorical columns. For more specific insights, try asking about averages, trends, outliers, correlations, or forecasts.`;
}

/**
 * Typewriter effect for displaying fallback responses
 */
async function typewriterEffect(container, html) {
  container.innerHTML = '';
  const tempDiv = document.createElement('div');
  tempDiv.innerHTML = html;
  const text = tempDiv.innerHTML;
  let i = 0;
  const speed = 3; // chars per frame
  const cursor = '<span class="typing-cursor"></span>';

  return new Promise(resolve => {
    function type() {
      if (i < text.length) {
        // Skip through HTML tags instantly
        if (text[i] === '<') {
          const closeIdx = text.indexOf('>', i);
          if (closeIdx !== -1) {
            i = closeIdx + 1;
          }
        }
        i += speed;
        container.innerHTML = text.substring(0, Math.min(i, text.length)) + cursor;
        requestAnimationFrame(type);
      } else {
        container.innerHTML = text;
        resolve();
      }
    }
    type();
  });
}
