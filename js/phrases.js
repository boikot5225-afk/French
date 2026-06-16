// ════════════════════════════════════════════════
// phrases.js — раздел фразы
// ════════════════════════════════════════════════

import { BADGE_CLASS, TENSE_NAMES } from './state.js';
import { normalize, showToast, todayStr } from './utils.js';
import { loadStats, saveStats } from './storage.js';
import { sbUser, sb, fetchWithTimeout, LONG_REQUEST_TIMEOUT_MS, SUPABASE_URL, SUPABASE_KEY, ADMIN_USERNAME } from './supabase.js';
import { speak } from './tts.js';

// ── Состояние ──
export let currentPhrase = null;
export let phGood = 0, phBad = 0, phStreak = 0;
export let phSelectedVerbs = new Set();
export let phHintUsed = false;

export function getFilteredPhrases(PHRASES, VERBS) {
  const group = document.getElementById('ph-group')?.value || 'all';
  const tense = document.getElementById('ph-tense')?.value || 'all';
  return PHRASES.filter(p => {
    if (tense !== 'all' && p.tense !== tense) return false;
    if (phSelectedVerbs.size > 0 && !phSelectedVerbs.has(p.verbId)) return false;
    if (group !== 'all') {
      const verb = VERBS.find(v => v.id === p.verbId);
      if (!verb || verb.group !== group) return false;
    }
    return true;
  });
}

export async function renderPhrasesScreen(PHRASES, VERBS, VERBS_LOADED, PHRASES_LOADED, loadVerbsFromCloud, loadPhrasesFromCloud) {
  if (!VERBS_LOADED && sbUser) await loadVerbsFromCloud();
  if (!PHRASES_LOADED && sbUser) {
    const sentence = document.getElementById('ph-sentence');
    if (sentence) sentence.textContent = 'Загружаем фразы…';
    await loadPhrasesFromCloud();
  }
  const pool = getFilteredPhrases(PHRASES, VERBS);
  const cnt = document.getElementById('ph-count');
  if (cnt) cnt.textContent = pool.length + ' фраз';
  phGood = phBad = phStreak = 0;
  document.getElementById('phscore-good').textContent  = '0';
  document.getElementById('phscore-bad').textContent   = '0';
  document.getElementById('phscore-streak').textContent = '0';
  nextPhrase(PHRASES, VERBS);
}

export function nextPhrase(PHRASES, VERBS) {
  const pool = getFilteredPhrases(PHRASES, VERBS);
  if (!pool.length) {
    const sentence = document.getElementById('ph-sentence');
    if (sentence) sentence.textContent = 'Нет фраз для выбранных фильтров';
    ['ph-speak-current-btn','ph-edit-current-btn','ph-delete-current-btn'].forEach(id => { const b = document.getElementById(id); if (b) b.style.display = 'none'; });
    return;
  }

  // Weighted random — worse phrases appear more often
  const stats = loadStats();
  const weights = pool.map(p => {
    const s = stats['ph_item_' + p.id];
    if (!s || s.total === 0) return 3;
    const acc = s.correct / s.total;
    if (acc < 0.5) return 5;
    if (acc < 0.8) return 2;
    return 1;
  });
  const total = weights.reduce((a,b) => a+b, 0);
  let r = Math.random() * total, idx = 0;
  for (let i = 0; i < weights.length; i++) { r -= weights[i]; if (r <= 0) { idx = i; break; } }
  currentPhrase = pool[idx];
  phHintUsed = false;

  const mode = currentPhraseMode();
  const verb = VERBS.find(v => v.id === currentPhrase.verbId);
  const badge = document.getElementById('ph-badge');
  if (badge && verb) {
    badge.className = 'group-badge ' + (BADGE_CLASS[verb.group] || 'badge-irr');
    badge.textContent = (verb?.inf || '') + ' · ' + (TENSE_NAMES[currentPhrase.tense] || currentPhrase.tense || '—');
  }

  const full = fillPhraseText(currentPhrase.fr, currentPhrase.answer);
  const sentenceEl = document.getElementById('ph-sentence');
  if (sentenceEl) {
    sentenceEl.innerHTML = mode === 'construct'
      ? renderConstructorTokens(full)
      : renderPhraseWithBlanks(currentPhrase.fr);
  }

  const ru = document.getElementById('ph-ru');
  if (ru) {
    ru.textContent = currentPhrase.ru || 'перевод не задан';
    ru.style.opacity = currentPhrase.ru ? '0' : '0.65';
    ru.onclick = () => { ru.style.opacity = ru.style.opacity === '0' ? '1' : '0'; };
  }

  const editBtn = document.getElementById('ph-edit-current-btn');
  const delBtn = document.getElementById('ph-delete-current-btn');
  const speakBtn = document.getElementById('ph-speak-current-btn');
  const canEdit = !!(window.isAdmin && window.isAdmin());
  if (editBtn) editBtn.style.display = canEdit ? '' : 'none';
  if (delBtn) delBtn.style.display = canEdit ? '' : 'none';
  if (speakBtn) speakBtn.style.display = currentPhrase ? '' : 'none';

  const inp = document.getElementById('ph-input');
  if (inp) {
    inp.value = '';
    inp.className = 'answer-input';
    inp.dataset.answered = '0';
    inp.placeholder = mode === 'construct'
      ? 'введи предложение полностью...'
      : (phraseBlankCount(normalizePhraseText(currentPhrase.fr)) > 1 ? 'введи ответы через пробел или | ...' : 'введи пропущенную форму...');
    inp.rows = mode === 'construct' ? 3 : 1;
    inp.style.minHeight = mode === 'construct' ? '108px' : '54px';
    inp.style.resize = mode === 'construct' ? 'vertical' : 'none';
    inp.style.fontSize = mode === 'construct' ? '1.02rem' : '';
    inp.style.textAlign = mode === 'construct' ? 'left' : '';
    inp.style.fontFamily = mode === 'construct' ? "'IBM Plex Sans', sans-serif" : "'IBM Plex Mono', monospace";
    inp.focus();
    window.autoResizePhraseInput?.();
  }
  const fb = document.getElementById('ph-feedback');
  if (fb) fb.innerHTML = '';
}


export function phraseHint() {
  if (!currentPhrase) return;
  phHintUsed = true;
  const mode = currentPhraseMode();
  const expected = mode === 'construct'
    ? fillPhraseText(currentPhrase.fr, currentPhrase.answer)
    : String(currentPhrase.answer || '');
  const half = expected.substring(0, Math.ceil(expected.length * 0.5));
  const fb = document.getElementById('ph-feedback');
  if (fb) fb.innerHTML = `<div style="font-family:'IBM Plex Mono',monospace;font-size:0.9rem;color:var(--warn)">💡 ${escapeHtml(half)}...</div>`;
  phStreak = 0;
  const streak = document.getElementById('phscore-streak');
  if (streak) streak.textContent = phStreak;
}


export function checkPhrase(PHRASES, VERBS) {
  const inp = document.getElementById('ph-input');
  if (!inp || inp.dataset.answered === '1' || !currentPhrase) return;
  inp.dataset.answered = '1';

  const mode = currentPhraseMode();
  const correct = String(currentPhrase.answer || '');
  const full = fillPhraseText(currentPhrase.fr, correct);
  const expected = mode === 'construct' ? full : correct;
  const userNorm = normalize(inp.value.trim());
  const isCorrect = mode === 'construct'
    ? normalizeConstructorAnswer(inp.value) === normalizeConstructorAnswer(expected)
    : (userNorm === normalize(expected) || userNorm === normalize(String(expected).replace(/-/g,' ')));

  inp.className = 'answer-input ' + (isCorrect ? 'correct' : 'wrong');
  inp.blur();
  speak(full);

  const sentence = document.getElementById('ph-sentence');
  if (sentence) {
    sentence.innerHTML = mode === 'construct'
      ? `<span style="color:${isCorrect?'var(--score-good)':'var(--score-bad)'};font-weight:600">${escapeHtml(full)}</span>`
      : renderPhraseWithAnswer(currentPhrase.fr, correct, isCorrect);
  }
  const ru = document.getElementById('ph-ru');
  if (ru) ru.style.opacity = currentPhrase.ru ? '1' : '0.65';
  const fb = document.getElementById('ph-feedback');

  if (isCorrect) {
    phGood++; phStreak++;
    if (fb) fb.innerHTML = `<div class="feedback-msg correct">✓ Верно!</div>
      <button class="btn btn-primary" style="padding:8px 20px;font-size:0.85rem" onclick="window._nextPhrase()">Следующая →</button>`;
  } else {
    phBad++; phStreak = 0;
    const phSpeakBtn = document.createElement('button');
    phSpeakBtn.textContent = '🔊';
    phSpeakBtn.style.cssText = 'background:none;border:1px solid var(--border);border-radius:6px;padding:6px 10px;cursor:pointer;color:var(--text-muted);font-size:0.85rem';
    phSpeakBtn.onclick = () => speak(full);
    const phFbDiv = document.createElement('div');
    phFbDiv.style.cssText = 'display:flex;gap:12px;align-items:center;justify-content:center;flex-wrap:wrap';
    phFbDiv.innerHTML = `<div class="feedback-msg wrong">✗ <strong>${escapeHtml(expected)}</strong></div><button class="btn btn-secondary" style="padding:8px 16px;font-size:0.8rem" onclick="window._nextPhrase()">Следующая</button>`;
    phFbDiv.appendChild(phSpeakBtn);
    if (fb) { fb.innerHTML = ''; fb.appendChild(phFbDiv); }
  }

  const goodEl = document.getElementById('phscore-good');
  const badEl = document.getElementById('phscore-bad');
  const streakEl = document.getElementById('phscore-streak');
  if (goodEl) goodEl.textContent = phGood;
  if (badEl) badEl.textContent = phBad;
  if (streakEl) streakEl.textContent = phStreak;

  if (currentPhrase.id) {
    const stats = loadStats();
    const key = 'ph_item_' + currentPhrase.id;
    if (!stats[key]) stats[key] = {total:0,correct:0};
    stats[key].total++;
    if (isCorrect) stats[key].correct++;
    saveStats(stats);
  }
}



// ── Ручное добавление фраз в Firebase ──
const PHRASE_LEVELS = [
  ['A1', 'A1 — совсем база'],
  ['A2', 'A2 — базовые фразы'],
  ['B1', 'B1 — сложнее'],
  ['B2', 'B2 — плотнее'],
];

const PHRASE_TENSES = [
  ['present', 'Présent'],
  ['passe', 'Passé composé'],
  ['imparfait', 'Imparfait'],
  ['futur', 'Futur simple'],
  ['plus_que_parfait', 'Plus-que-parfait'],
  ['conditionnel', 'Conditionnel présent'],
  ['subjonctif', 'Subjonctif présent'],
  ['imperatif', 'Impératif'],
  ['passe_simple', 'Passé simple'],
];

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizePhraseId(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFC')
    .replace(/\s+/g, '_')
    .replace(/[.#$\[\]\/]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '') || ('phrase_' + Date.now());
}

// Phrase blanks: support ___, -- and — as placeholders.
// Multiple blanks are allowed: "J'___ ___ ici." answer: "ne suis pas" or "ne|suis pas".
const PHRASE_BLANK_RE = /_{2,}|-{2,}|—{1,}/g;

function normalizePhraseText(fr) {
  return String(fr || '')
    .replace(PHRASE_BLANK_RE, '___')
    .replace(/\s+/g, ' ')
    .trim();
}

function phraseBlankCount(fr) {
  return (String(fr || '').match(/___/g) || []).length;
}

function splitPhraseAnswers(answer, count) {
  const raw = String(answer || '').trim();
  if (!raw) return [];
  if (count <= 1) return [raw];

  // Explicit separators are safest for multi-gap phrases:
  // answer: "ai|eu" or "ne;pas" or "ai, eu"
  if (/[|;,]/.test(raw)) {
    const parts = raw.split(/[|;,]/).map(s => s.trim()).filter(Boolean);
    while (parts.length < count) parts.push('');
    return parts.slice(0, count);
  }

  // Fallback: split by spaces. Last part receives the rest, so two blanks can
  // be "ne suis pas" -> ["ne", "suis pas"]. If you need exact control, use |.
  const bits = raw.split(/\s+/).filter(Boolean);
  if (bits.length >= count) {
    const parts = bits.slice(0, count - 1);
    parts.push(bits.slice(count - 1).join(' '));
    return parts;
  }

  const parts = [raw];
  while (parts.length < count) parts.push('');
  return parts;
}

function fillPhraseText(fr, answer) {
  const normFr = normalizePhraseText(fr);
  const count = phraseBlankCount(normFr);
  if (!count) return normFr;
  const parts = splitPhraseAnswers(answer, count);
  let i = 0;
  return normFr.replace(/___/g, () => parts[i++] || '');
}

function renderPhraseWithBlanks(fr) {
  return escapeHtml(normalizePhraseText(fr)).replace(/___/g,
    '<span style="display:inline-block;min-width:60px;border-bottom:2px solid var(--accent);color:var(--accent)">___</span>');
}

function renderPhraseWithAnswer(fr, answer, isCorrect) {
  const normFr = normalizePhraseText(fr);
  const parts = splitPhraseAnswers(answer, phraseBlankCount(normFr));
  let i = 0;
  const color = isCorrect ? 'var(--score-good)' : 'var(--score-bad)';
  return escapeHtml(normFr).replace(/___/g, () => {
    const part = escapeHtml(parts[i++] || answer || '—');
    return `<span style="color:${color};font-weight:600">${part}</span>`;
  });
}

function tokenizeConstructorText(text) {
  return String(text || '')
    // punctuation is not the point of constructor mode; checking ignores it too
    .replace(/[!?.,;:«»"“”()]/g, ' ')
    .split(/\s+/)
    .map(s => s.trim())
    .filter(Boolean);
}

function constructorScrambleTokens(text) {
  const original = tokenizeConstructorText(text);
  if (original.length <= 1) return original;

  // No random here. Random can accidentally output the original phrase.
  // We deliberately split the sentence and reverse chunks so the displayed
  // order cannot be the original order.
  let tokens;
  if (original.length === 2) {
    tokens = [original[1], original[0]];
  } else if (original.length === 3) {
    tokens = [original[2], original[0], original[1]];
  } else {
    const mid = Math.ceil(original.length / 2);
    const left = original.slice(0, mid);
    const right = original.slice(mid);
    tokens = [...right.reverse(), ...left.reverse()];
  }

  if (tokens.join('\u0001') === original.join('\u0001')) {
    tokens = [...original].reverse();
  }
  return tokens;
}

function renderConstructorTokens(text) {
  const tokens = constructorScrambleTokens(text);
  if (!tokens.length) return '<span style="color:var(--text-dim)">Нет слов для конструктора</span>';
  return `<div style="display:flex;flex-direction:column;align-items:center;gap:10px">
    <div style="font-size:0.7rem;letter-spacing:0.08em;text-transform:uppercase;color:var(--text-dim);font-family:'IBM Plex Sans',sans-serif">слова вразнобой</div>
    <div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap;line-height:1.5">
      ${tokens.map(t => `<span style="font-family:'IBM Plex Mono',monospace;font-size:.95rem;background:var(--surface2);border:1px solid var(--border);border-radius:999px;padding:5px 10px;box-shadow:0 1px 0 rgba(0,0,0,.04)">${escapeHtml(t)}</span>`).join('')}
    </div>
  </div>`;
}

function currentPhraseMode() {
  return window.phMode || document.documentElement?.dataset?.phMode || localStorage.getItem('an2_phrase_mode') || 'fill';
}


function normalizeConstructorAnswer(value) {
  return normalize(String(value || ''))
    // ignore punctuation for full-sentence constructor mode
    .replace(/[.!?…,:;«»"“”()]/g, ' ')
    // tolerate apostrophe variants and missing apostrophes: j'ai / j ai / jai
    .replace(/[’`´]/g, "'")
    .replace(/\s*'\s*/g, '')
    // tolerate hyphen spacing in forms like est-ce / est ce
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}


function getManualPhraseVerbId() {
  const sel = document.getElementById('manual-ph-verb');
  return sel?.value || '';
}

function ensureAddPhraseModal() {
  let modal = document.getElementById('add-phrase-modal');
  if (modal) return modal;

  modal = document.createElement('div');
  modal.id = 'add-phrase-modal';
  modal.style.cssText = 'display:none;position:fixed;inset:0;z-index:999;background:rgba(0,0,0,0.7);align-items:center;justify-content:center;padding:20px;';
  modal.innerHTML = `
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:24px;width:100%;max-width:620px;max-height:90vh;overflow-y:auto;">
      <div id="manual-ph-title" style="font-size:1rem;font-weight:600;color:var(--text);margin-bottom:4px">➕ Добавить фразу вручную</div>
      <div style="font-size:0.78rem;color:var(--text-muted);margin-bottom:16px">Без DeepSeek. Фраза сохраняется сразу в Firebase <code>/phrases</code>. Для режима «Заполнить пропуск» нужен пропуск <b>___</b>. Можно несколько пропусков.</div>

      <div style="margin-bottom:12px;">
        <label style="font-size:0.75rem;color:var(--text-muted);display:block;margin-bottom:6px">Глагол</label>
        <input id="manual-ph-verb-search" placeholder="Поиск глагола..." oninput="populateAddPhraseVerbList()"
          style="width:100%;box-sizing:border-box;padding:8px 12px;background:var(--surface2);border:1px solid var(--border);border-radius:8px;color:var(--text);font-family:'IBM Plex Sans',sans-serif;font-size:0.88rem;outline:none;margin-bottom:6px"
          onfocus="this.style.borderColor='var(--accent)'" onblur="this.style.borderColor='var(--border)'">
        <select id="manual-ph-verb" class="select-control" style="width:100%;max-height:150px" size="6"></select>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px;">
        <div>
          <label style="font-size:0.75rem;color:var(--text-muted);display:block;margin-bottom:6px">Время</label>
          <select id="manual-ph-tense" class="select-control" style="width:100%">
            ${PHRASE_TENSES.map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}
          </select>
        </div>
        <div>
          <label style="font-size:0.75rem;color:var(--text-muted);display:block;margin-bottom:6px">Уровень</label>
          <select id="manual-ph-level" class="select-control" style="width:100%">
            ${PHRASE_LEVELS.map(([value, label]) => `<option value="${value}" ${value === 'A2' ? 'selected' : ''}>${label}</option>`).join('')}
          </select>
        </div>
      </div>

      <div style="margin-bottom:12px;">
        <label style="font-size:0.75rem;color:var(--text-muted);display:block;margin-bottom:6px">Фраза с пропуском</label>
        <textarea id="manual-ph-fr" rows="2" placeholder="J'___ un livre."
          style="width:100%;box-sizing:border-box;padding:10px 12px;background:var(--surface2);border:1px solid var(--border);border-radius:8px;color:var(--text);font-family:'IBM Plex Sans',sans-serif;font-size:0.9rem;outline:none;resize:vertical"
          onfocus="this.style.borderColor='var(--accent)'" onblur="this.style.borderColor='var(--border)'"></textarea>
        <div style="font-size:0.72rem;color:var(--text-dim);margin-top:5px">Пропуск — <code>___</code>, <code>--</code> или <code>—</code>. Можно два пропуска: <code>J'___ ___ ici.</code></div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px;">
        <div>
          <label style="font-size:0.75rem;color:var(--text-muted);display:block;margin-bottom:6px">Ответ / ответы</label>
          <input id="manual-ph-answer" placeholder="as или ai|eu" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"
            style="width:100%;box-sizing:border-box;padding:10px 12px;background:var(--surface2);border:1px solid var(--border);border-radius:8px;color:var(--text);font-family:'IBM Plex Mono',monospace;font-size:0.9rem;outline:none"
            onfocus="this.style.borderColor='var(--accent)'" onblur="this.style.borderColor='var(--border)'">
        </div>
        <div>
          <label style="font-size:0.75rem;color:var(--text-muted);display:block;margin-bottom:6px">Перевод <span style="opacity:.65">(необязательно)</span></label>
          <input id="manual-ph-ru" placeholder="Ты прав. Можно оставить пустым" autocomplete="off"
            style="width:100%;box-sizing:border-box;padding:10px 12px;background:var(--surface2);border:1px solid var(--border);border-radius:8px;color:var(--text);font-family:'IBM Plex Sans',sans-serif;font-size:0.9rem;outline:none"
            onfocus="this.style.borderColor='var(--accent)'" onblur="this.style.borderColor='var(--border)'">
        </div>
      </div>

      <details style="margin-bottom:14px;">
        <summary style="cursor:pointer;color:var(--text-muted);font-size:0.8rem;margin-bottom:8px">Подсказка по формату</summary>
        <div style="font-size:0.8rem;line-height:1.55;color:var(--text-muted);margin-top:8px;background:var(--surface2);border:1px solid var(--border);border-radius:10px;padding:10px 12px">
          <div><b>avoir:</b> <code>J'___ un chat.</code> → ответ <code>ai</code></div>
          <div><b>être:</b> <code>Nous ___ fatigués.</code> → ответ <code>sommes</code></div>
          <div><b>aller:</b> <code>Ils ___ au cinéma.</code> → ответ <code>vont</code></div>
          <div><b>2 пропуска:</b> <code>J'___ ___ ici.</code> → ответ <code>ne|suis pas</code> или <code>ne suis pas</code></div>
        </div>
      </details>

      <div id="manual-ph-status" style="display:none;font-size:0.82rem;margin-bottom:12px;text-align:center;padding:8px;border-radius:8px;background:var(--surface2)"></div>
      <div style="display:flex;gap:8px;">
        <button onclick="closeAddPhraseModal()" class="btn btn-secondary" style="flex:1">Отмена</button>
        <button onclick="saveManualPhrase()" id="manual-ph-confirm" class="btn btn-primary" style="flex:1">Сохранить</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  return modal;
}

export function populateAddPhraseVerbList(VERBS, selectedId = null) {
  const modal = ensureAddPhraseModal();
  const sel = modal.querySelector('#manual-ph-verb');
  const search = modal.querySelector('#manual-ph-verb-search')?.value.trim().toLowerCase() || '';
  if (!sel) return;
  const current = selectedId || sel.value || '';
  const filtered = (VERBS || []).filter(v => !search ||
    String(v.inf || '').toLowerCase().includes(search) ||
    String(v.meaning || '').toLowerCase().includes(search));
  sel.innerHTML = filtered.length
    ? filtered.map(v => `<option value="${escapeHtml(v.id)}" ${String(v.id) === String(current) ? 'selected' : ''}>${escapeHtml(v.inf)} — ${escapeHtml(v.meaning || '')}</option>`).join('')
    : '<option value="">Глаголы не найдены</option>';
  if (current && [...sel.options].some(o => o.value === current)) sel.value = current;
}

export function showAddPhraseModal(currentProfile, VERBS) {
  if (window.guardGuest && window.guardGuest('Добавление фразы')) return;
  if (!window.isAdmin || !window.isAdmin()) {
    showToast('🔒 Добавление фраз доступно только администратору');
    return;
  }
  const modal = ensureAddPhraseModal();
  modal.dataset.editId = '';
  const title = modal.querySelector('#manual-ph-title');
  const confirm = modal.querySelector('#manual-ph-confirm');
  if (title) title.textContent = '➕ Добавить фразу вручную';
  if (confirm) confirm.textContent = 'Сохранить';
  ['manual-ph-fr','manual-ph-answer','manual-ph-ru','manual-ph-verb-search'].forEach(id => { const el = modal.querySelector('#' + id); if (el) el.value = ''; });
  const tenseEl = modal.querySelector('#manual-ph-tense'); if (tenseEl) tenseEl.value = 'present';
  const levelEl = modal.querySelector('#manual-ph-level'); if (levelEl) levelEl.value = 'A2';
  modal.style.display = 'flex';
  const status = modal.querySelector('#manual-ph-status');
  if (status) { status.style.display = 'none'; status.textContent = ''; }
  populateAddPhraseVerbList(VERBS || []);
}

export function showAddPhraseModalForVerb(verbId, currentProfile, VERBS) {
  showAddPhraseModal(currentProfile, VERBS);
  if (!verbId) return;
  const modal = ensureAddPhraseModal();
  const search = modal.querySelector('#manual-ph-verb-search');
  if (search) search.value = '';
  populateAddPhraseVerbList(VERBS || [], verbId);
}

export function closeAddPhraseModal() {
  const modal = document.getElementById('add-phrase-modal');
  if (modal) modal.style.display = 'none';
}

export function showEditPhraseModal(phrase, currentProfile, VERBS) {
  if (!phrase) { showToast('Фраза не выбрана'); return; }
  if (window.guardGuest && window.guardGuest('Редактирование фразы')) return;
  if (!window.isAdmin || !window.isAdmin()) {
    showToast('🔒 Редактирование фраз доступно только администратору');
    return;
  }
  const modal = ensureAddPhraseModal();
  modal.dataset.editId = phrase.id || '';
  const title = modal.querySelector('#manual-ph-title');
  const confirm = modal.querySelector('#manual-ph-confirm');
  if (title) title.textContent = '✏️ Редактировать фразу';
  if (confirm) confirm.textContent = 'Сохранить изменения';
  const status = modal.querySelector('#manual-ph-status');
  if (status) { status.style.display = 'none'; status.textContent = ''; }
  const search = modal.querySelector('#manual-ph-verb-search');
  if (search) search.value = '';
  populateAddPhraseVerbList(VERBS || [], phrase.verbId || phrase.verb_id || '');
  const tense = modal.querySelector('#manual-ph-tense'); if (tense) tense.value = phrase.tense || 'present';
  const level = modal.querySelector('#manual-ph-level'); if (level) level.value = phrase.level || 'A2';
  const fr = modal.querySelector('#manual-ph-fr'); if (fr) fr.value = phrase.fr || '';
  const answer = modal.querySelector('#manual-ph-answer'); if (answer) answer.value = phrase.answer || '';
  const ru = modal.querySelector('#manual-ph-ru'); if (ru) ru.value = phrase.ru || '';
  modal.style.display = 'flex';
}

export function speakCurrentPhrase() {
  if (!currentPhrase) return;
  const full = fillPhraseText(currentPhrase.fr, currentPhrase.answer);
  if (full.trim()) speak(full.trim());
}

export async function deleteCurrentPhrase(PHRASES, renderPhrasesScreenFn) {
  if (!currentPhrase?.id) return;
  if (window.guardGuest && window.guardGuest('Удаление фразы')) return;
  if (!window.isAdmin || !window.isAdmin()) { showToast('🔒 Удаление фраз доступно только администратору'); return; }
  if (!confirm(`Удалить фразу?\n${fillPhraseText(currentPhrase.fr, currentPhrase.answer || '___')}`)) return;
  const { error } = await sb.from('phrases').delete().eq('id', currentPhrase.id);
  if (error) { showToast('⚠️ ' + error.message); return; }
  const idx = (PHRASES || []).findIndex(p => p.id === currentPhrase.id);
  if (idx >= 0) PHRASES.splice(idx, 1);
  currentPhrase = null;
  showToast('🗑 Фраза удалена');
  await renderPhrasesScreenFn?.();
}

export async function saveManualPhrase(PHRASES, VERBS, renderPhrasesScreenFn) {
  if (window.guardGuest && window.guardGuest('Добавление фразы')) return;
  if (!window.isAdmin || !window.isAdmin()) {
    showToast('🔒 Добавление фраз доступно только администратору');
    return;
  }
  const modal = ensureAddPhraseModal();
  const btn = modal.querySelector('#manual-ph-confirm');
  const status = modal.querySelector('#manual-ph-status');
  const verbId = getManualPhraseVerbId();
  const tense = modal.querySelector('#manual-ph-tense')?.value || 'present';
  const level = modal.querySelector('#manual-ph-level')?.value || 'A2';
  let fr = modal.querySelector('#manual-ph-fr')?.value.trim() || '';
  const answer = modal.querySelector('#manual-ph-answer')?.value.trim() || '';
  const ru = modal.querySelector('#manual-ph-ru')?.value.trim() || '';

  try {
    if (!verbId) throw new Error('Выбери глагол.');
    if (!fr) throw new Error('Введи французскую фразу.');
    if (!answer) throw new Error('Введи ответ — форму глагола для пропуска.');
    if (!fr.includes('___')) throw new Error('Во фразе должен быть пропуск: ___, -- или —');

    fr = normalizePhraseText(fr);
    const verb = (VERBS || []).find(v => String(v.id) === String(verbId));
    const now = new Date().toISOString();
    const editId = modal.dataset.editId || '';
    const baseId = editId || `${verbId}_${tense}_${Date.now()}`;
    const phrase = {
      id: normalizePhraseId(baseId),
      verb_id: verbId,
      tense,
      fr,
      answer,
      ru,
      level,
      custom: true,
      source: 'manual',
      created_at: editId ? undefined : now,
      updated_at: now,
    };

    if (phrase.created_at === undefined) delete phrase.created_at;

    if (btn) { btn.disabled = true; btn.textContent = '⏳ Сохраняю...'; }
    if (status) {
      status.style.display = 'block';
      status.style.color = 'var(--accent)';
      status.textContent = (modal.dataset.editId ? '⏳ Обновляю фразу в Firebase...' : '⏳ Сохраняю фразу в Firebase...');
    }

    const { error } = await sb.from('phrases').upsert(phrase);
    if (error) throw error;

    const localPhrase = { id: phrase.id, verbId: phrase.verb_id, tense: phrase.tense, fr: phrase.fr, answer: phrase.answer, ru: phrase.ru, level: phrase.level, custom: true };
    const idx = (PHRASES || []).findIndex(p => p.id === localPhrase.id);
    if (idx >= 0) PHRASES[idx] = localPhrase;
    else PHRASES.push(localPhrase);

    if (status) {
      status.style.color = 'var(--good)';
      status.textContent = modal.dataset.editId ? '✅ Фраза обновлена.' : `✅ Фраза сохранена${verb?.inf ? ' для ' + verb.inf : ''}.`;
    }

    try {
      Object.keys(localStorage).forEach((k) => { if (k.startsWith('an2_cache_phrases')) localStorage.removeItem(k); });
    } catch {}

    if (typeof renderPhrasesScreenFn === 'function') await renderPhrasesScreenFn();

    setTimeout(() => {
      const frEl = modal.querySelector('#manual-ph-fr');
      const ansEl = modal.querySelector('#manual-ph-answer');
      const ruEl = modal.querySelector('#manual-ph-ru');
      if (frEl) frEl.value = '';
      if (ansEl) ansEl.value = '';
      if (ruEl) ruEl.value = '';
      modal.dataset.editId = '';
      closeAddPhraseModal();
    }, 700);
  } catch(e) {
    if (status) {
      status.style.display = 'block';
      status.style.color = 'var(--bad)';
      status.textContent = '❌ ' + (e?.message || e);
    } else {
      alert(e?.message || e);
    }
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Сохранить'; }
  }
}

// ── Генерация фраз ──
export function showGenerateModal(currentProfile, VERBS) {
  if (currentProfile?.toLowerCase() !== ADMIN_USERNAME) {
    showToast('Генерация доступна только администратору');
    return;
  }
  document.getElementById('generate-modal').style.display = 'flex';
  populateGenVerbList('', VERBS);
}

export function showGenerateModalForVerb(verbId, currentProfile, VERBS) {
  if (currentProfile?.toLowerCase() !== ADMIN_USERNAME) { alert('Не админ: ' + currentProfile); return; }
  const modal = document.getElementById('generate-modal');
  if (!modal) { alert('Модалка generate-modal не найдена'); return; }
  modal.style.display = 'flex';
  try { populateGenVerbList('', VERBS); } catch(e) { alert('populateGenVerbList упал: ' + e.message); }
  const sel = document.getElementById('gen-verb');
  if (sel && verbId) {
    for (let i = 0; i < sel.options.length; i++) {
      if (sel.options[i].value === verbId) { sel.selectedIndex = i; break; }
    }
  }
}

export function populateGenVerbList(filter, VERBS) {
  const sel = document.getElementById('gen-verb');
  if (!sel) return;
  const filtered = VERBS.filter(v => !filter ||
    v.inf.toLowerCase().includes(filter.toLowerCase()) ||
    (v.meaning||'').toLowerCase().includes(filter.toLowerCase()));
  sel.innerHTML = filtered.map(v => `<option value="${v.id}">${v.inf} — ${v.meaning||''}</option>`).join('');
}

export function closeGenerateModal() {
  document.getElementById('generate-modal').style.display = 'none';
  const status = document.getElementById('gen-status');
  if (status) { status.style.display = 'none'; status.style.color = 'var(--accent)'; }
}

export async function generatePhrases(PHRASES, VERBS, renderPhrasesScreenFn) {
  if (window.guardGuest && window.guardGuest('Генерация фраз')) return;
  if (!window.isAdmin || !window.isAdmin()) {
    if (window.showToast) window.showToast('🔒 Генерация доступна только администратору');
    return;
  }
  const sel   = document.getElementById('gen-verb');
  const verb  = sel?.value;
  const tense = document.getElementById('gen-tense').value;
  const count = parseInt(document.getElementById('gen-count').value);
  if (!verb) { alert('Выбери глагол'); return; }

  const btn    = document.getElementById('gen-btn');
  const status = document.getElementById('gen-status');
  btn.disabled = true;
  btn.textContent = '⏳ Генерируем...';
  status.style.display = 'block';
  status.style.color = 'var(--accent)';
  status.textContent = 'Запрос к DeepSeek...';

  try {
    const { data: { session } } = await sb.auth.getSession();
    const res = await fetchWithTimeout(`${SUPABASE_URL}/functions/v1/add-phrases`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session?.access_token || SUPABASE_KEY}`,
        'apikey': SUPABASE_KEY,
      },
      body: JSON.stringify({ verb, tense, count })
    }, LONG_REQUEST_TIMEOUT_MS);
    if (!res.ok) throw new Error(await res.text());
    const { count: added } = await res.json();
    status.textContent = `✅ Добавлено ${added} фраз!`;
    setTimeout(() => {
      closeGenerateModal();
      renderPhrasesScreenFn();
    }, 1500);
  } catch(e) {
    status.style.color = 'var(--bad)';
    status.textContent = '❌ Ошибка: ' + e.message;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Генерировать';
  }
}

// ── Поиск и выбор глаголов во фразах ──
let phVerbSelectOpen = false;

export function renderPhrasesVerbList(VERBS) {
  const search = document.getElementById('ph-search')?.value.trim().toLowerCase() || '';
  const list = document.getElementById('ph-verb-list');
  if (!list) return;

  const filtered = VERBS.filter(v =>
    !search || v.inf.includes(search) || v.meaning.toLowerCase().includes(search)
  );

  list.innerHTML = filtered.length === 0
    ? '<div style="padding:12px;color:var(--text-muted);font-size:0.85rem">Не найдено</div>'
    : filtered.map(v => {
        const selected = phSelectedVerbs.has(v.id);
        return `<div onclick="window._phToggleVerb('${v.id}')"
          style="display:flex;align-items:center;gap:10px;padding:8px 12px;cursor:pointer;border-bottom:1px solid var(--border);background:${selected ? 'var(--surface2)' : 'none'}">
          <div style="width:16px;height:16px;border:2px solid ${selected ? 'var(--accent)' : 'var(--border)'};border-radius:3px;background:${selected ? 'var(--accent)' : 'none'};flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:0.7rem;color:#f5ecd8">${selected ? '✓' : ''}</div>
          <span style="font-family:'Playfair Display',serif;font-style:italic">${v.inf}</span>
          <span style="font-size:0.78rem;color:var(--text-muted)">${v.meaning}</span>
        </div>`;
      }).join('');
}

export function togglePhVerbSelect(VERBS) {
  phVerbSelectOpen = !phVerbSelectOpen;
  const list = document.getElementById('ph-verb-list');
  const search = document.getElementById('ph-search');
  if (!list) return;
  if (phVerbSelectOpen) {
    list.style.display = 'block';
    if (search) search.value = '';
    renderPhrasesVerbList(VERBS);
    if (search) search.focus();
  } else {
    list.style.display = 'none';
  }
}
