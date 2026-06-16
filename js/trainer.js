// ════════════════════════════════════════════════
// trainer.js — тренажёр глаголов
// ════════════════════════════════════════════════

import { PRONOUNS, TENSE_NAMES, BADGE_CLASS, AUX_AVOIR, AUX_ETRE } from './state.js';
import { elide, isVowel, normalize, levenshtein, todayStr, addDays, profileKey, showToast, toDateStr } from './utils.js';
import { sm2Update, loadSRS, saveSRS, srsKey, getCard, verbHasAnyCard, verbDueTenses, SRS_TENSES } from './srs.js';
import { loadStats, saveStats } from './storage.js';
import { sbUser, sb } from './supabase.js';
import { speak } from './tts.js';
import { updateStreak } from './app.js';

// ── Константы ──
export const REFLEXIVE_PRONOUNS = ['me','te','se','nous','vous','se'];
export const GROUP_LABELS = {er:'-ER',ir:'-IR',re:'-RE',irr:'Irrégulier',ref:'Réfléchi'};

// ── Состояние тренажёра ──
export let currentVerb = null;
export let currentPronounIdx = null;
export let currentTense = null;
export function getCurrentVerb() { return currentVerb; }
export function getCurrentTense() { return currentTense; }
export let ruleVisible = false;
export let currentCardHinted = false;
export let hintLevel = 0; // how many letters revealed
export let reviewMode = false;
export function setReviewMode(v) { reviewMode = v; }
export let sessionCount = 0;
export let sessionGood = 0, sessionBad = 0, sessionStreak = 0;
export let selectedVerbIds = new Set();

// ── SRS review session: a finite queue that ends when all due verbs are cleared ──
export let srsSessionActive = false;
export let srsSessionQueue = [];   // keys "verbId|tense" remaining to clear
export let srsSessionDone = 0;      // cards cleared this session
export let srsSessionTotal = 0;

// Form progress within the session for the CURRENT card (verb+tense).
// All 6 persons of that tense must be answered correctly to clear the card.
let srsCurrentKey = null;        // which "verbId|tense" the progress belongs to
let srsFormTense = 'present';    // tense of the current card
let srsFormRemaining = [];       // pronoun indices (0-5) still to answer correctly

export function startSrsSession(dueKeys) {
  srsSessionActive = true;
  srsSessionQueue = [...dueKeys];
  srsSessionTotal = dueKeys.length;
  srsSessionDone = 0;
  srsCurrentKey = null;
  srsFormRemaining = [];
}

export function endSrsSession() {
  srsSessionActive = false;
  srsSessionQueue = [];
  srsSessionDone = 0;
  srsSessionTotal = 0;
  srsCurrentKey = null;
  srsFormRemaining = [];
}

// Returns true if session still has cards to review
export function isSrsSessionActive() { return srsSessionActive; }

export function srsSessionHasNext() {
  return srsSessionActive && srsSessionQueue.length > 0;
}

// How many forms remain for the current card (for progress display)
export function srsFormsRemaining() { return srsFormRemaining.length; }
export function srsFormsTotal() { return 6; }

// Mark current card result in the session.
// Returns 'cleared' if the card's last form was just completed (all 6 done),
// 'continue' if more forms remain, or null if not applicable.
// `key` is the "verbId|tense" of the current card.
export function srsSessionMark(key, correct) {
  if (!srsSessionActive) return null;
  const idx = srsSessionQueue.indexOf(key);
  if (idx === -1) return null;

  if (correct) {
    if (srsCurrentKey === key && srsFormRemaining.length > 0) {
      srsFormRemaining.shift();
    }
    if (srsFormRemaining.length === 0) {
      srsSessionQueue.splice(idx, 1);
      srsSessionDone++;
      srsCurrentKey = null;
      return 'cleared';
    }
    return 'continue';
  } else {
    if (srsCurrentKey === key && srsFormRemaining.length > 1) {
      const f = srsFormRemaining.shift();
      srsFormRemaining.push(f);
    }
    return 'continue';
  }
}

// "Понял паттерн" — clear the current card immediately (counts as reviewed).
export function srsSessionSkipVerb(key) {
  if (!srsSessionActive) return;
  const idx = srsSessionQueue.indexOf(key);
  if (idx !== -1) {
    srsSessionQueue.splice(idx, 1);
    srsSessionDone++;
  }
  srsCurrentKey = null;
  srsFormRemaining = [];
}

// The current card's key (verbId|tense), or null
export function srsCurrentCardKey() {
  return srsSessionActive && srsSessionQueue.length ? srsSessionQueue[0] : null;
}

// ── Вспомогательные ──
export function getReflexivePronoun(pronounIdx, form) {
  const base = REFLEXIVE_PRONOUNS[pronounIdx];
  if ((base === 'me' || base === 'te' || base === 'se') && isVowel(form)) {
    return base[0] + "'";
  }
  return base + ' ';
}

export function getAgreedPP(pp, pronounIdx) {
  const pronoun = PRONOUNS[pronounIdx];
  if (pronoun === 'elle') return pp.endsWith('e') ? pp : pp + 'e';
  if (pronoun === 'ils/elles' || pronoun === 'ils') return pp.endsWith('s') ? pp : pp + 's';
  if (pronoun === 'elles') return pp.endsWith('es') ? pp : (pp.endsWith('e') ? pp + 's' : pp + 'es');
  return pp;
}

export function getCorrectAnswer() {
  if (!currentVerb || !currentTense) return '';
  if (currentVerb.reflexive) {
    const pronoun = PRONOUNS[currentPronounIdx];
    if (currentTense === 'passe') {
      const auxForms = ['suis','es','est','sommes','êtes','sont'];
      const refPron = getReflexivePronoun(currentPronounIdx, auxForms[currentPronounIdx]);
      const pp = getAgreedPP(currentVerb.pp, currentPronounIdx);
      return elide(pronoun + ' ' + refPron + auxForms[currentPronounIdx] + ' ' + pp);
    }
    const form = currentVerb.conj[currentTense]?.[currentPronounIdx] || '';
    const refPron = getReflexivePronoun(currentPronounIdx, form);
    return elide(pronoun + ' ' + refPron + form);
  }
  if (currentTense === 'passe') {
    const pronoun = PRONOUNS[currentPronounIdx];
    const aux = currentVerb.aux;
    let auxForm, pp = currentVerb.pp;
    if (aux === 'avoir') {
      auxForm = AUX_AVOIR[currentPronounIdx];
    } else {
      auxForm = AUX_ETRE[currentPronounIdx];
      pp = getAgreedPP(pp, currentPronounIdx);
    }
    return elide(pronoun + ' ' + auxForm + ' ' + pp);
  }
  const form = currentVerb.conj[currentTense][currentPronounIdx];
  return elide(PRONOUNS[currentPronounIdx] + ' ' + form);
}

export function buildExample(verb, tense, pronounIdx) {
  if (!verb || !tense) return '';
  const pronoun = PRONOUNS[pronounIdx];
  let form;
  if (tense === 'passe') {
    const auxForm = verb.aux === 'avoir' ? AUX_AVOIR[pronounIdx] : AUX_ETRE[pronounIdx];
    form = auxForm + ' ' + verb.pp;
  } else {
    form = verb.conj[tense]?.[pronounIdx];
    if (!form) return '';
  }
  const stored = verb.ex?.[tense] || '';
  if (verb.reflexive) {
    if (stored) return stored;
    const refPron = getReflexivePronoun(pronounIdx, form);
    return elide(pronoun + ' ' + refPron + form + '.');
  }
  if (!stored) return elide(pronoun + ' ' + form + '.');
  const storedNorm = stored.trim();
  const storedPronoun = PRONOUNS.find(p =>
    storedNorm.toLowerCase().startsWith(p + ' ') || storedNorm.toLowerCase().startsWith(p + "'")
  );
  if (storedPronoun) {
    const afterStoredPronoun = storedNorm.slice(storedPronoun.length + 1);
    if (!afterStoredPronoun) return elide(pronoun + ' ' + form + '.');
    const formWordCount = tense === 'passe' ? 2 : 1;
    const parts = afterStoredPronoun.split(' ');
    const tail = parts.slice(formWordCount).join(' ');
    if (tail) return elide(pronoun + ' ' + form + ' ' + tail);
  }
  return elide(pronoun + ' ' + form + '.');
}

// ── Выбор карточки ──
export function getFilteredVerbs(VERBS) {
  const group = document.getElementById('filter-group').value;
  const tense = document.getElementById('filter-tense').value;
  let verbs = VERBS.filter(v => v.conj);
  if (selectedVerbIds.size > 0) {
    verbs = verbs.filter(v => selectedVerbIds.has(v.id));
  } else {
    if (group !== 'all') verbs = verbs.filter(v => v.group === group);
  }
  if (tense !== 'all' && tense !== 'passe') verbs = verbs.filter(v => v.conj[tense]);
  if (reviewMode) {
    const stats = loadStats();
    const weak = verbs.filter(v => {
      const s = stats[v.id];
      return s && s.total >= 2 && (s.correct / s.total) < 0.6;
    });
    if (weak.length > 0) return weak;
    return null;
  }
  return verbs;
}

export function pickCard(VERBS) {
  // SRS session: each queue item is a "verbId|tense" card; check all 6 forms.
  if (srsSessionActive) {
    if (srsSessionQueue.length === 0) return false; // signals completion
    const key = srsSessionQueue[0];
    const sep = key.indexOf('|');
    const verbId = sep === -1 ? key : key.slice(0, sep);
    const tense  = sep === -1 ? 'present' : key.slice(sep + 1);
    currentVerb = VERBS.find(v => v.id === verbId);
    if (!currentVerb) { srsSessionQueue.shift(); return pickCard(VERBS); }

    // Start a new card's form sequence if needed
    if (srsCurrentKey !== key || srsFormRemaining.length === 0) {
      srsCurrentKey = key;
      srsFormTense = tense;
      srsFormRemaining = [0, 1, 2, 3, 4, 5]; // all 6 persons, in order
    }

    currentTense = srsFormTense;
    currentPronounIdx = srsFormRemaining[0];
    return true;
  }

  const verbs = getFilteredVerbs(VERBS);
  if (!verbs || !verbs.length) return false;
  const tenseFilter = document.getElementById('filter-tense').value;
  const stats = loadStats();
  const srs = loadSRS();
  const today = todayStr();

  const weights = verbs.map(v => {
    // Use the présent card as representative for weighting (or any existing one)
    const card = getCard(srs, v.id, 'present') || srs[v.id];
    const s = stats[v.id];
    const anyDue = verbDueTenses(srs, v.id, today, toDateStr).length > 0;
    if (!card && !verbHasAnyCard(srs, v.id)) return s && s.total >= 1 ? 3 : 3;
    if (anyDue) return 8;
    if (card && card.interval >= 21) return 0.1;
    if (card && card.interval >= 7) return 0.3;
    return 1;
  });

  const totalW = weights.reduce((a,b) => a+b, 0);
  let r = Math.random() * totalW, idx = 0;
  for (let i = 0; i < weights.length; i++) { r -= weights[i]; if (r <= 0) { idx = i; break; } }
  currentVerb = verbs[idx];

  const availTenses = tenseFilter === 'all'
    ? ['present','passe','imparfait','futur'].filter(t => t === 'passe' || currentVerb.conj[t])
    : [tenseFilter];
  currentTense = availTenses[Math.floor(Math.random() * availTenses.length)];
  currentPronounIdx = Math.floor(Math.random() * 6);
  return true;
}

// ── Рендер карточки ──
export function renderCard(frKbEnabled, showFrKb) {
  if (!currentVerb) return;
  ruleVisible = false;
  if (frKbEnabled) setTimeout(() => showFrKb('main'), 50);

  // SRS session form-progress bar (всё спряжение за повторение)
  const formBar = document.getElementById('srs-form-bar');
  if (formBar) {
    if (srsSessionActive) {
      formBar.style.display = 'flex';
      const done = srsFormsTotal() - srsFormsRemaining();
      const prog = document.getElementById('srs-form-progress');
      if (prog) prog.textContent = `Формы: ${done}/${srsFormsTotal()}`;
    } else {
      formBar.style.display = 'none';
    }
  }

  const ruleBox = document.getElementById('rule-box');
  if (ruleBox) ruleBox.style.display = 'none';
  const ruleBtn = document.getElementById('rule-toggle-btn');
  if (ruleBtn) {
    ruleBtn.style.borderColor = '';
    ruleBtn.style.color = '';
    ruleBtn.textContent = '💡 Правило';
    ruleBtn.dataset.penaltyApplied = '';
  }
  currentCardHinted = false;

  const fbEl = document.getElementById('feedback-row');
  if (fbEl) fbEl.style.display = '';

  const badge = document.getElementById('card-badge');
  badge.className = 'group-badge ' + BADGE_CLASS[currentVerb.group];
  badge.textContent = GROUP_LABELS[currentVerb.group] + ' · ' + TENSE_NAMES[currentTense];

  document.getElementById('card-verb').textContent = currentVerb.inf;
  document.getElementById('card-meaning').textContent = currentVerb.meaning;

  if (currentTense === 'passe') {
    document.getElementById('card-meta').textContent = 'auxiliaire: ' + currentVerb.aux + ' · pp: ' + currentVerb.pp;
  } else {
    document.getElementById('card-meta').textContent = '';
  }

  const pronounRaw = PRONOUNS[currentPronounIdx];
  const nextForm = currentTense === 'passe'
    ? (currentVerb.aux === 'avoir' ? AUX_AVOIR[currentPronounIdx] : AUX_ETRE[currentPronounIdx])
    : (currentVerb.conj[currentTense]?.[currentPronounIdx] || '');

  let pronounDisplay;
  if (currentVerb.reflexive) {
    const refPron = getReflexivePronoun(currentPronounIdx, nextForm);
    const full = elide(pronounRaw + ' ' + refPron + 'X');
    pronounDisplay = full.replace(/X$/, '...');
  } else {
    if (pronounRaw === 'je' && isVowel(nextForm)) {
      pronounDisplay = "j' ...";
    } else {
      pronounDisplay = pronounRaw + ' ...';
    }
  }
  document.getElementById('card-pronoun').textContent = pronounDisplay;

  const ex = buildExample(currentVerb, currentTense, currentPronounIdx);
  const ctxEl = document.getElementById('card-context');
  ctxEl.textContent = ex;
  ctxEl.style.visibility = 'hidden';

  const mode = document.getElementById('filter-mode').value;
  document.getElementById('type-area').style.display = mode === 'type' ? 'flex' : 'none';
  document.getElementById('recall-area').style.display = mode === 'recall' ? 'block' : 'none';

  if (mode === 'recall') {
    document.getElementById('recall-step1').style.display = 'block';
    document.getElementById('recall-step2').style.display = 'none';
    document.getElementById('recall-answer').textContent = getCorrectAnswer();
    document.getElementById('recall-example').textContent = buildExample(currentVerb, currentTense, currentPronounIdx);
  }

  const input = document.getElementById('answer-input');
  input.value = '';
  input.className = 'answer-input';
  input.dataset.answered = '0';
  input.focus();
}

export function clearFeedback() {
  document.getElementById('feedback-row').innerHTML = `
    <button class="hint-btn" id="hint-btn" onclick="showHint()">💡 Подсказка</button>
    <button class="hint-btn" onclick="markAsKnown()" style="color:var(--good);border-color:var(--good)">✓ Уже знаю</button>
    <div id="hint-output" style="width:100%;margin-top:10px;min-height:0;"></div>`;
}

export async function recordResult(correct, grade) {
  if (!currentVerb) return;
  const effectiveCorrect = correct && !currentCardHinted;
  window.__lastCardHinted = currentCardHinted; // for the sync SRS-form path
  currentCardHinted = false;

  const stats = loadStats();
  const key = currentVerb.id;
  if (!stats[key]) stats[key] = { total: 0, correct: 0 };
  stats[key].total++;
  if (effectiveCorrect) stats[key].correct++;

  const tkey = 'tense_' + currentTense;
  if (!stats[tkey]) stats[tkey] = { total: 0, correct: 0 };
  stats[tkey].total++;
  if (effectiveCorrect) stats[tkey].correct++;

  await saveStats(stats);
  updateStreak();

  // SRS interval update:
  // - Session mode: handled SYNCHRONOUSLY in checkAnswer (form-by-form), so we
  //   skip it here to avoid double-advancing and the async race that caused the
  //   infinite single-form loop.
  // - Normal mode: update the current tense's card on every answer.
  if (!srsSessionActive) {
    updateSRSVerb(currentVerb.id, effectiveCorrect, grade, currentTense);
  }

  if (correct) { sessionGood++; sessionStreak++; }
  else { sessionBad++; sessionStreak = 0; }
  document.getElementById('score-good').textContent = sessionGood;
  document.getElementById('score-bad').textContent = sessionBad;
  document.getElementById('score-streak').textContent = sessionStreak;
}

export function updateSRSVerb(verbId, correct, grade, tense) {
  if (!verbId) return;
  // Per-tense key. Falls back to currentTense if not passed.
  const t = tense || currentTense || 'present';
  const key = srsKey(verbId, t);
  const effectiveGrade = grade !== undefined ? grade : (correct ? 4 : 1);
  const srs = loadSRS();
  const card = srs[key] || null;
  const updated = sm2Update(card, effectiveGrade);
  srs[key] = updated;
  saveSRS(srs);
}

export function showHint() {
  if (!currentVerb) return;
  currentCardHinted = true;
  const correct = getCorrectAnswer();
  // Reveal one more letter each press, from the start
  hintLevel = Math.min(hintLevel + 1, correct.length);
  const revealed = correct.slice(0, hintLevel);
  const hidden = correct.slice(hintLevel);
  const masked = hidden.split('').map(ch => ch === ' ' ? ' ' : '·').join('');
  const isFull = hintLevel >= correct.length;
  const out = document.getElementById('hint-output');
  if (out) out.innerHTML =
    `<div style="font-family:'IBM Plex Mono',monospace;font-size:1.1rem;letter-spacing:3px;text-align:center">
       <strong style="color:var(--accent)">${revealed}</strong><span style="color:var(--text-dim)">${masked}</span>
       <span style="font-size:0.7rem;color:var(--text-dim);margin-left:8px;letter-spacing:0">${isFull ? '(полностью)' : `${hintLevel}/${correct.length}`}</span>
     </div>`;
  // Update button label to show it can be pressed again
  const hb = document.getElementById('hint-btn');
  if (hb && !isFull) hb.textContent = '💡 Ещё букву';
  else if (hb && isFull) hb.textContent = '💡 Открыто полностью';
  // Penalty only on the first hint of the card (don't punish every letter)
  if (hintLevel === 1) {
    sessionBad++; sessionStreak = 0;
    document.getElementById('score-bad').textContent = sessionBad;
    document.getElementById('score-streak').textContent = sessionStreak;
  }
}

export function markAsKnown() {
  if (!currentVerb) return;
  const srs = loadSRS();
  const key = srsKey(currentVerb.id, currentTense || 'present');
  const existing = srs[key];
  if (!existing || existing.interval < 7) {
    srs[key] = {
      interval: 7,
      easeFactor: existing ? existing.easeFactor : 2.5,
      repetitions: existing ? Math.max(existing.repetitions, 2) : 2,
      dueDate: addDays(todayStr(), 7),
      lastReview: todayStr(),
      markedKnown: true
    };
    saveSRS(srs);
  }
  const stats = loadStats();
  if (!stats[currentVerb.id]) stats[currentVerb.id] = {total:1, correct:1};
  saveStats(stats);
  const fb = document.getElementById('feedback-row');
  if (fb) fb.innerHTML = `<div style="color:var(--good);font-size:0.82rem">✓ ${currentVerb.inf} — помечен как знакомый</div>`;
}

export function checkAnswer(resetTrainer) {
  if (!currentVerb) return;
  const input = document.getElementById('answer-input');
  if (!input || input.dataset.answered === '1') return;
  input.dataset.answered = '1';
  const userRaw = input.value;
  const correct = getCorrectAnswer();
  const correctFull = normalize(correct);
  const pronoun = PRONOUNS[currentPronounIdx];
  const correctShort = normalize(correct.replace(new RegExp('^' + pronoun + '\\s+'), ''));
  const userNorm = normalize(userRaw);
  const isCorrect = userNorm === correctFull || userNorm === correctShort;

  // Speak the correct form as early as possible — right after the tap on
  // "Проверить" — so mobile browsers don't block playback for lack of a
  // user-gesture context (async work below would otherwise delay it).
  speak(correct);

  input.blur();

  const isTypo = !isCorrect && (
    levenshtein(userNorm, correctFull) === 1 ||
    levenshtein(userNorm, correctShort) === 1
  );

  recordResult(isCorrect);

  // Advance the SRS session form SYNCHRONOUSLY, right here — recordResult is
  // async (it awaits saveStats), so if we leave the form-advance inside it the
  // user can tap "Следующий" before it runs, and pickCard re-picks the same
  // form forever (the infinite "je" loop). Doing it synchronously fixes that.
  if (srsSessionActive) {
    const effectiveCorrect = isCorrect && !window.__lastCardHinted;
    const key = srsCurrentCardKey();
    const result = srsSessionMark(key, effectiveCorrect);
    if (result === 'cleared') {
      updateSRSVerb(currentVerb.id, true, undefined, currentTense);
    }
  }
  input.className = 'answer-input ' + (isCorrect ? 'correct' : isTypo ? '' : 'wrong');
  if (isTypo) input.style.borderColor = 'var(--warn)';
  const ctxEl = document.getElementById('card-context');
  if (ctxEl) ctxEl.style.visibility = 'visible';

  const fb = document.getElementById('feedback-row');
  if (isCorrect) {
    document.getElementById('card-context').style.visibility = 'visible';
    fb.innerHTML = `<div class="feedback-msg correct">✓ Верно!</div><button class="btn btn-primary" style="padding:8px 20px;font-size:0.85rem" onclick="resetTrainer()">Следующий →</button>`;
  } else if (isTypo) {
    fb.innerHTML = `<div style="color:var(--warn);font-size:0.9rem;font-weight:500">⚠ Опечатка! Правильно: <strong>${correct}</strong></div>
      <button class="btn btn-primary" style="padding:8px 20px;font-size:0.85rem" onclick="resetTrainer()">Следующий →</button>`;
  } else {
    fb.innerHTML = `<div class="feedback-msg wrong">✗ Правильно: <strong>${correct}</strong></div><button class="btn btn-secondary" style="padding:8px 16px;font-size:0.8rem" onclick="resetTrainer()">Следующий</button>`;
    const _sb = document.createElement('button');
    _sb.textContent = '🔊';
    _sb.style.cssText = 'background:none;border:1px solid var(--border);border-radius:6px;padding:6px 10px;cursor:pointer;color:var(--text-muted);font-size:0.85rem';
    _sb.onclick = (()=>{const _c=correct;return ()=>speak(_c);})();
    fb.appendChild(_sb);
    const card = document.getElementById('trainer-card');
    if (card) { card.classList.add('shake'); setTimeout(() => card.classList.remove('shake'), 400); }
    if (navigator.vibrate) navigator.vibrate([30, 10, 30]);
  }
  // Scroll to bottom on mobile so feedback button is visible above keyboard
  setTimeout(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }), 100);
}

export function revealRecall() {
  document.getElementById('recall-step1').style.display = 'none';
  document.getElementById('recall-step2').style.display = 'block';
  document.getElementById('card-context').style.visibility = 'visible';
  speak(getCorrectAnswer());
}

export function recallResult(grade, resetTrainer) {
  const correct = grade >= 3;
  // Single SRS update path: recordResult handles stats AND the SRS card
  // (passing grade through). The extra updateSRSVerb call here caused a
  // double interval update per answer.
  recordResult(correct, grade);
  setTimeout(resetTrainer, 400);
}
