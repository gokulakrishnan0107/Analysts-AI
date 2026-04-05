/* ═══════════════════════════════════════
   AnalystAI — File Parser (parser.js)
   CSV, Excel, JSON parsing + type detection
   ═══════════════════════════════════════ */

/**
 * Parse uploaded file based on extension
 * @param {File} file - The uploaded file
 * @param {string} ext - File extension
 * @param {Function} callback - Receives array of row objects
 */
function parseFile(file, ext, callback) {
  if (ext === 'csv') {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      dynamicTyping: true,
      complete: (results) => {
        callback(cleanData(results.data));
      },
      error: (err) => {
        showToast('CSV parse error: ' + err.message, 'error');
        callback(null);
      }
    });
  } else if (ext === 'xlsx' || ext === 'xls') {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const workbook = XLSX.read(e.target.result, { type: 'array', cellDates: true });
        const firstSheet = workbook.SheetNames[0];
        const data = XLSX.utils.sheet_to_json(workbook.Sheets[firstSheet], { defval: null });
        callback(cleanData(data));
      } catch (err) {
        showToast('Excel parse error: ' + err.message, 'error');
        callback(null);
      }
    };
    reader.readAsArrayBuffer(file);
  } else if (ext === 'json') {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        let json = JSON.parse(e.target.result);
        if (!Array.isArray(json)) {
          // Try to find an array property
          const keys = Object.keys(json);
          const arrKey = keys.find(k => Array.isArray(json[k]));
          json = arrKey ? json[arrKey] : [json];
        }
        callback(cleanData(json));
      } catch (err) {
        showToast('JSON parse error: ' + err.message, 'error');
        callback(null);
      }
    };
    reader.readAsText(file);
  }
}

/**
 * Clean data: trim strings, normalize null values
 */
function cleanData(data) {
  if (!data || data.length === 0) return data;
  return data.map(row => {
    const cleaned = {};
    for (const [key, val] of Object.entries(row)) {
      if (typeof val === 'string') {
        const trimmed = val.trim();
        cleaned[key] = trimmed === '' ? null : trimmed;
      } else {
        cleaned[key] = val;
      }
    }
    return cleaned;
  }).filter(row => {
    // Remove completely empty rows
    return Object.values(row).some(v => v !== null && v !== undefined && v !== '');
  });
}

/**
 * Detect column types: numeric, categorical, date, text
 * @param {Array} data - Array of row objects
 * @returns {Object} - { columnName: { type, nullCount, uniqueCount, sample } }
 */
function detectColumnTypes(data) {
  if (!data || data.length === 0) return {};
  const cols = Object.keys(data[0]);
  const types = {};

  cols.forEach(col => {
    const values = data.map(r => r[col]).filter(v => v !== null && v !== undefined && v !== '');
    const total = data.length;
    const nullCount = total - values.length;
    const uniqueValues = [...new Set(values)];

    let type = 'text';

    // Check if numeric
    const numericCount = values.filter(v => !isNaN(Number(v)) && v !== '' && v !== true && v !== false).length;
    if (numericCount > values.length * 0.8 && values.length > 0) {
      type = 'numeric';
    }
    // Check if date
    else if (values.length > 0) {
      const dateCount = values.filter(v => {
        if (v instanceof Date) return true;
        if (typeof v !== 'string') return false;
        const d = new Date(v);
        return !isNaN(d.getTime()) && v.length > 4;
      }).length;
      if (dateCount > values.length * 0.8) {
        type = 'date';
      }
      // Check if categorical (few unique values relative to total)
      else if (uniqueValues.length <= Math.max(20, values.length * 0.3)) {
        type = 'categorical';
      }
    }

    types[col] = {
      type,
      nullCount,
      uniqueCount: uniqueValues.length,
      totalCount: total,
      sample: values.slice(0, 5)
    };
  });

  return types;
}

/**
 * Get numeric columns from columnTypes
 */
function getNumericColumns(columnTypes) {
  return Object.entries(columnTypes).filter(([, info]) => info.type === 'numeric').map(([col]) => col);
}

/**
 * Get categorical columns from columnTypes
 */
function getCategoricalColumns(columnTypes) {
  return Object.entries(columnTypes).filter(([, info]) => info.type === 'categorical').map(([col]) => col);
}

/**
 * Get date columns from columnTypes
 */
function getDateColumns(columnTypes) {
  return Object.entries(columnTypes).filter(([, info]) => info.type === 'date').map(([col]) => col);
}

/**
 * Get column values as numbers
 */
function getNumericValues(data, col) {
  return data.map(r => parseFloat(r[col])).filter(v => !isNaN(v));
}
