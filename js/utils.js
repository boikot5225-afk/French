// ════════════════════════════════════════════════
// utils.js — вспомогательные функции
// ════════════════════════════════════════════════

// ── Date normalization — single source of truth ──
// ALL dates in the app use the format YYYY-MM-DD (10 chars).
// Any date entering from outside (Supabase, Date objects, timestamps)
// MUST pass through toDateStr() so comparisons never break.
export function toDateStr(value) {
  if (!value) return '';
  // Already a YYYY-MM-DD string (possibly with time suffix)
  if (typeof value === 'string') {
    // Take first 10 chars if it looks like an ISO date/timestamp
    const m = value.match(/^(\d{4}-\d{2}-\d{2})/);
    if (m) return m[1];
    // Fallback: try to parse
    const d = new Date(value);
    return isNaN(d) ? '' : d.toISOString().slice(0, 10);
  }
  // Date object or timestamp number
  const d = new Date(value);
  return isNaN(d) ? '' : d.toISOString().slice(0, 10);
}

export function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

export function addDays(dateStr, days) {
  // Normalize input first so 'YYYY-MM-DDT...' timestamps work too
  const base = toDateStr(dateStr) || todayStr();
  const d = new Date(base + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function isVowel(s) {
  return /^[aeéèêëàâiîïoôuùûœh]/i.test(s);
}

export function elide(sentence) {
  return sentence
    .replace(/\bje\s+([aeéèêëàâiîïoôuùûœh])/gi, (m, v) => "j'" + v)
    .replace(/\bme\s+([aeéèêëàâiîïoôuùûœh])/gi, (m, v) => "m'" + v)
    .replace(/\bse\s+([aeéèêëàâiîïoôuùûœh])/gi, (m, v) => "s'" + v)
    .replace(/\ble\s+([aeéèêëàâiîïoôuùûœh])/gi, (m, v) => "l'" + v)
    .replace(/\bde\s+([aeéèêëàâiîïoôuùûœh])/gi, (m, v) => "d'" + v)
    .replace(/\bque\s+([aeéèêëàâiîïoôuùûœh])/gi, (m, v) => "qu'" + v)
    .replace(/\bne\s+([aeéèêëàâiîïoôuùûœh])/gi, (m, v) => "n'" + v);
}

export function normalize(s) {
  return s.trim().toLowerCase()
    .replace(/\u2019/g, "'")
    .replace(/[àâä]/g,'a').replace(/[éèêë]/g,'e').replace(/[îï]/g,'i')
    .replace(/[ôö]/g,'o').replace(/[ùûü]/g,'u').replace(/ç/g,'c').replace(/œ/g,'oe')
    .replace(/'/g,"'").replace(/\s+/g,' ');
}

export function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({length: m+1}, (_, i) =>
    Array.from({length: n+1}, (_, j) => i === 0 ? j : j === 0 ? i : 0));
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1] : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
  return dp[m][n];
}

export function showToast(msg, duration = 3000) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.style.display = 'block';
  setTimeout(() => { el.style.display = 'none'; }, duration);
}

export function showLoading(text = 'Загружаем данные...') {
  const el = document.getElementById('loading-overlay');
  const txt = document.getElementById('loading-text');
  if (el) el.style.display = 'flex';
  if (txt) txt.textContent = text;
}

export function hideLoading() {
  const el = document.getElementById('loading-overlay');
  if (el) el.style.display = 'none';
}

export function profileKey(suffix, currentProfile) {
  return 'conj_' + (currentProfile || '').toLowerCase() + '_' + suffix;
}
