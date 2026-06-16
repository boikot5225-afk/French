// ════════════════════════════════════════════════
// study.js — раздел «Изучить»
// ════════════════════════════════════════════════

import { normalize, todayStr, addDays, profileKey, showToast } from './utils.js';
import { loadSRS, saveSRS, sm2Update, srsKey, getCard, verbHasAnyCard, SRS_TENSES } from './srs.js';
import { loadStats, removeLearnLater, isInLearnLater, loadLearnLater, addLearnLater, saveLearnLater } from './storage.js';
import { sbUser, sb, ADMIN_USERNAME } from './supabase.js';
import { speak } from './tts.js';

// ── Состояние ──
export let learnVerb = null;
export function getLearnVerb() { return learnVerb; }
export let learnCheckPronounIdx = 0;
export let learnCheckQueue = [];
export let learnCheckPos = 0;
export let learnCheckErrors = 0;
let learnCheckCompleted = false; // true only if the user passed the full check step
export let learnPhraseQueue = [];
export let learnPhraseIdx = 0;
export let learnPhraseErrors = 0;
export let studySelectedIds = new Set();
export let studySelectMode = false;
export let studyQueue = [];
export let studyQueueIdx = 0;
export let learnPhraseCount = parseInt(localStorage.getItem('learnPhraseCount') || '3');

// ── Вспомогательные ──
function showLearnView(id) {
  ['study-pick','study-card-view','study-check-view','study-phrases-view','study-result-view'].forEach(v => {
    const el = document.getElementById(v);
    if (el) el.style.display = v === id ? 'block' : 'none';
  });
}

function highlightEnding(inf, form) {
  const stem = inf.replace(/(?:er|ir|re|oir)$/i, '');
  if (form.startsWith(stem) && stem.length > 1) {
    const ending = form.slice(stem.length);
    return `${stem}<span style="color:var(--accent);font-weight:500">${ending}</span>`;
  }
  const cut = form.length > 4 ? form.length - 3 : form.length - 2;
  if (cut > 0) return `${form.slice(0, cut)}<span style="color:var(--accent);font-weight:500">${form.slice(cut)}</span>`;
  return form;
}

// ── Главный экран ──
// Tense labels for the per-tense indicators
const TENSE_LABELS = { present: 'Présent', passe: 'Passé', imparfait: 'Imparf.', futur: 'Futur' };

// Which tenses of a verb are learned (have an SRS card)?
function learnedTenses(srs, verbId) {
  return SRS_TENSES.filter(t => srs[srsKey(verbId, t)]);
}

export async function renderStudyScreen(VERBS, VERBS_LOADED, PHRASES_LOADED, loadVerbsFromCloud, loadPhrasesFromCloud, frKbEnabled, autoSpeak, currentProfile) {
  if (!VERBS_LOADED && sbUser) await loadVerbsFromCloud();
  // Фразы не грузим при простом открытии раздела: это тяжёлая база.
  // Они подтянутся только на шаге с фразами.
  initPhraseCountButtons();

  const srs = loadSRS();
  const search = document.getElementById('study-search')?.value.trim().toLowerCase() || '';

  // NEW CONCEPT: the study pool is the user's PERSONAL list (learn-later),
  // not everything that ever had SRS. No auto-migration here: old SRS data
  // should not silently inflate «Мой план».
  let planIds = loadLearnLater();
  const validPlanIds = planIds.filter(id => VERBS.some(v => v.id === id));
  if (validPlanIds.length !== planIds.length) { saveLearnLater(validPlanIds); planIds = validPlanIds; }
  const planVerbs = planIds.map(id => VERBS.find(v => v.id === id)).filter(Boolean);

  // Apply search within the personal plan
  const pool = search
    ? planVerbs.filter(v => v.inf.includes(search) || v.meaning.toLowerCase().includes(search))
    : planVerbs;

  // "Active" = not all 4 tenses learned yet; "Done" = all 4 tenses learned
  const isFullyLearned = (v) => learnedTenses(srs, v.id).length >= SRS_TENSES.length;
  const activeVerbs = pool.filter(v => !isFullyLearned(v));
  const doneVerbs   = pool.filter(v => isFullyLearned(v));

  // Counts reflect the whole plan
  const activeAll = planVerbs.filter(v => !isFullyLearned(v));
  const doneAll   = planVerbs.filter(v => isFullyLearned(v));
  const nc = document.getElementById('study-new-count');
  const kc = document.getElementById('study-known-count');
  if (nc) nc.textContent = activeAll.length;
  if (kc) kc.textContent = doneAll.length;

  // Admin buttons
  const addVerbBtn = document.getElementById('add-verb-btn');
  if (addVerbBtn) addVerbBtn.style.display = currentProfile?.toLowerCase() === ADMIN_USERNAME ? 'inline-block' : 'none';

  // Build the per-tense indicator chips for a verb.
  // The first unlearned tense is the RECOMMENDED next step — highlighted.
  const tenseChips = (v) => {
    const learned = learnedTenses(srs, v.id);
    const nextTense = SRS_TENSES.find(t => !learned.includes(t));
    return SRS_TENSES.map(t => {
      const done = learned.includes(t);
      const isNext = t === nextTense;
      const bg = done ? 'var(--good)' : (isNext ? 'rgba(166,42,33,0.10)' : 'var(--surface2)');
      const col = done ? '#f5ecd8' : (isNext ? 'var(--accent)' : 'var(--text-dim)');
      const br = done ? 'var(--good)' : (isNext ? 'var(--accent)' : 'var(--border)');
      const weight = isNext ? 'font-weight:600;' : '';
      // Clicking a tense chip starts learning the verb in THAT tense
      return `<button onclick="event.stopPropagation(); window.learnVerbInTense('${v.id}','${t}')"
        style="background:${bg};color:${col};border:1px solid ${br};border-radius:6px;padding:3px 8px;font-size:0.66rem;cursor:pointer;font-family:'IBM Plex Sans',sans-serif;white-space:nowrap;${weight}">
        ${TENSE_LABELS[t]} ${done ? '✓' : (isNext ? '←' : '')}</button>`;
    }).join('');
  };

  const list = document.getElementById('study-new-list');
  if (list) {
    if (planVerbs.length === 0) {
      list.innerHTML = `<div style="color:var(--text-muted);padding:24px 16px;text-align:center;line-height:1.6">
        <div style="font-size:2rem;margin-bottom:8px">📌</div>
        <div style="font-size:0.95rem;color:var(--text);margin-bottom:6px">Твой список пуст</div>
        <div style="font-size:0.82rem">Добавляй глаголы для изучения из <b>Словаря</b> кнопкой «➕ В мой план», и они появятся здесь.</div>
      </div>`;
    } else if (activeVerbs.length === 0) {
      list.innerHTML = '<div style="color:var(--good);padding:16px;text-align:center">🎉 Все глаголы в плане изучены во всех временах!</div>';
    } else {
      list.innerHTML = activeVerbs.map(v => {
        const selected = studySelectedIds.has(v.id);
        return `<div style="display:flex;flex-direction:column;gap:8px;padding:12px 14px;background:${selected ? 'var(--surface2)' : 'var(--surface)'};border:1px solid ${selected ? 'var(--accent)' : 'var(--border)'};border-radius:8px;">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
            <div style="flex:1;min-width:0;">
              <span style="font-family:'Playfair Display',serif;font-style:italic;font-size:1rem">${v.inf}</span>
              <span style="font-size:0.8rem;color:var(--text-muted);margin-left:10px">${v.meaning}</span>
            </div>
            <button onclick="event.stopPropagation(); window.removeFromPlan('${v.id}')" title="Убрать из плана"
              style="background:none;border:none;color:var(--text-dim);cursor:pointer;font-size:0.9rem;flex-shrink:0;padding:2px">🗑</button>
          </div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;">${tenseChips(v)}</div>
        </div>`;
      }).join('');
    }
  }

  const knownList = document.getElementById('study-known-list');
  if (knownList && search) {
    knownList.style.display = 'flex';
    knownList.style.flexDirection = 'column';
    const icon = document.getElementById('known-toggle-icon');
    if (icon) icon.textContent = '▲';
  }
  if (knownList) {
    knownList.innerHTML = doneVerbs.length === 0
      ? '<div style="color:var(--text-muted);padding:12px;text-align:center;font-size:0.85rem">Пока нет полностью изученных</div>'
      : doneVerbs.map(v => {
          return `<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:var(--surface);border:1px solid var(--border);border-radius:8px;opacity:0.85">
            <div>
              <span style="font-family:'Playfair Display',serif;font-style:italic;font-size:1rem">${v.inf}</span>
              <span style="font-size:0.8rem;color:var(--text-muted);margin-left:10px">${v.meaning}</span>
            </div>
            <span style="font-size:0.7rem;color:var(--good);flex-shrink:0">✓ все времена</span>
          </div>`;
        }).join('');
  }
}

export function toggleSelectMode(renderStudyScreenFn) {
  studySelectMode = !studySelectMode;
  const btn = document.getElementById('select-mode-btn');
  if (btn) {
    btn.style.background = studySelectMode ? 'var(--accent)' : '';
    btn.style.color = studySelectMode ? '#f5ecd8' : '';
  }
  if (!studySelectMode) { studySelectedIds.clear(); updateSelectedBar(); }
  renderStudyScreenFn();
}

export function toggleVerbSelect(id, renderStudyScreenFn) {
  if (studySelectedIds.has(id)) studySelectedIds.delete(id);
  else studySelectedIds.add(id);
  updateSelectedBar();
  renderStudyScreenFn();
}

export function updateSelectedBar() {
  const bar = document.getElementById('study-selected-bar');
  const label = document.getElementById('study-selected-label');
  if (!bar) return;
  if (studySelectedIds.size > 0) {
    bar.style.display = 'flex';
    label.textContent = `Выбрано: ${studySelectedIds.size}`;
  } else {
    bar.style.display = 'none';
  }
}

export function clearStudySelection(renderStudyScreenFn) {
  studySelectedIds.clear();
  studySelectMode = false;
  const btn = document.getElementById('select-mode-btn');
  if (btn) { btn.style.background = ''; btn.style.color = ''; }
  updateSelectedBar();
  renderStudyScreenFn();
}

export function startLearnLaterSession(verbIds, VERBS) {
  studyQueue = verbIds.map(id => VERBS.find(v => v.id === id)).filter(Boolean);
  studyQueueIdx = 0;
  studySelectMode = false;
  if (!studyQueue.length) return;
  // Same route as "Изучить следующий": first verb with an unlearned tense,
  // opened in that tense (not blindly the first verb in présent).
  const srs = loadSRS();
  for (let i = 0; i < studyQueue.length; i++) {
    const v = studyQueue[i];
    const nextTense = SRS_TENSES.find(t => !srs[srsKey(v.id, t)]);
    if (nextTense) {
      studyQueueIdx = i;
      if (window.learnVerbInTense) window.learnVerbInTense(v.id, nextTense);
      else learnVerbStart(v.id, VERBS);
      return;
    }
  }
  if (window.showToast) window.showToast('🎉 Все выбранные глаголы изучены во всех временах!');
}

export function startSelectedSession(VERBS) {
  if (!studySelectedIds.size) return;
  studyQueue = Array.from(studySelectedIds).map(id => VERBS.find(v => v.id === id)).filter(Boolean);
  studyQueueIdx = 0;
  studySelectMode = false;
  clearStudySelection(() => {});
  if (studyQueue.length) learnVerbStart(studyQueue[0].id, VERBS);
}

export function startLearnSession(VERBS) {
  const srs = loadSRS();
  // NEW CONCEPT: "Изучить следующий" walks the PERSONAL plan, not all verbs.
  // Pick the first plan verb that still has an unlearned tense, and open
  // that specific tense (the learning route is: verb → next tense → next verb).
  let planIds = loadLearnLater();
  const validPlanIds = planIds.filter(id => VERBS.some(v => v.id === id));
  if (validPlanIds.length !== planIds.length) { saveLearnLater(validPlanIds); planIds = validPlanIds; }
  const planVerbs = planIds.map(id => VERBS.find(v => v.id === id)).filter(Boolean);
  if (!planVerbs.length) {
    if (window.showToast) window.showToast('📌 План пуст — добавь глаголы из Словаря');
    return;
  }
  for (const v of planVerbs) {
    const nextTense = SRS_TENSES.find(t => !srs[srsKey(v.id, t)]);
    if (nextTense) {
      studyQueue = planVerbs;
      studyQueueIdx = planVerbs.indexOf(v);
      if (window.learnVerbInTense) window.learnVerbInTense(v.id, nextTense);
      else learnVerbStart(v.id, VERBS);
      return;
    }
  }
  if (window.showToast) window.showToast('🎉 Весь план изучен во всех временах!');
}

export function initPhraseCountButtons() {
  setPhraseCount(learnPhraseCount);
}

export function setPhraseCount(n) {
  learnPhraseCount = n;
  localStorage.setItem('learnPhraseCount', n);
  [1,3,5].forEach(i => {
    const btn = document.getElementById('pc-btn-' + i);
    if (btn) {
      btn.style.background = i === n ? 'var(--accent)' : '';
      btn.style.color = i === n ? '#f5ecd8' : '';
      btn.style.borderColor = i === n ? 'var(--accent)' : '';
    }
  });
}

export function toggleKnownList() {
  const el = document.getElementById('study-known-list');
  const icon = document.getElementById('known-toggle-icon');
  if (!el) return;
  const isHidden = window.getComputedStyle(el).display === 'none';
  el.style.display = isHidden ? 'flex' : 'none';
  el.style.flexDirection = 'column';
  if (icon) icon.textContent = isHidden ? '▲' : '▼';
  // When opening, scroll the list into view (it sits below the "new" list)
  if (isHidden) {
    setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  }
}

// ── Карточка изучения ──
export function learnVerbStart(verbId, VERBS) {
  learnVerb = VERBS.find(v => v.id === verbId);
  if (!learnVerb) return;
  // Default entry is ALWAYS présent. Internal calls (queues, selections) used
  // to inherit the last chosen tense from window.learnCurrentTense — a verb
  // could open in stale imparfait. learnVerbInTense overrides AFTER this call.
  window.learnCurrentTense = 'present';
  learnCheckCompleted = false; // new session — check not passed yet
  showLearnView('study-card-view');
  renderLearnCard();
}

export function renderLearnCard(autoSpeak, currentProfile, showFrKbFn) {
  const v = learnVerb;
  const GROUP_NAMES = {er:'1-я группа (-ER)',ir:'2-я группа (-IR)',re:'3-я группа (-RE)',irr:'Неправильный',ref:'Возвратный'};
  const tense = window.learnCurrentTense || 'present';
  const TENSE_NAMES = { present:'Présent', passe:'Passé composé', imparfait:'Imparfait', futur:'Futur simple' };
  document.getElementById('learn-badge').textContent = GROUP_NAMES[v.group] || v.group;
  document.getElementById('learn-inf').textContent = v.inf;
  document.getElementById('learn-meaning').textContent = v.meaning;
  document.getElementById('study-step-label').textContent = `Шаг 1 из 2 — знакомство · ${TENSE_NAMES[tense] || ''}`;

  // Render the conjugation table for the fixed tense (handled in app.js)
  if (window.renderLearnTenseTable) window.renderLearnTenseTable();

  // Read autoSpeak live from storage (import snapshot can be stale).
  // Speak the example phrase (with the verb form), not just the infinitive.
  if (localStorage.getItem('autoSpeak') === '1') {
    const ex = v.ex?.[tense] || v.ex?.present || v.inf;
    setTimeout(() => speak(ex), 300);
  }

  const genBtn = document.getElementById('study-gen-btn');
  if (genBtn) genBtn.style.display = currentProfile?.toLowerCase() === ADMIN_USERNAME ? 'block' : 'none';
  const addVerbBtn = document.getElementById('add-verb-btn');
  if (addVerbBtn) addVerbBtn.style.display = currentProfile?.toLowerCase() === ADMIN_USERNAME ? 'inline-block' : 'none';
}

export function startLearnCheck(frKbEnabled, showFrKb, hideFrKb) {
  learnCheckQueue = [0,1,2,3,4,5].sort(() => Math.random() - 0.5);
  learnCheckPos = 0;
  learnCheckErrors = 0;
  learnCheckCompleted = false;
  showLearnCheckForm(frKbEnabled, showFrKb, hideFrKb);
}

export function showLearnCheckForm(frKbEnabled, showFrKb, hideFrKb) {
  const idx = learnCheckQueue[learnCheckPos];
  const pronouns = ['je','tu','il/elle','nous','vous','ils/elles'];
  const GROUP_NAMES = {er:'1-я группа (-ER)',ir:'2-я группа (-IR)',re:'3-я группа (-RE)',irr:'Неправильный',ref:'Возвратный'};

  document.getElementById('check-badge').textContent = GROUP_NAMES[learnVerb.group] || learnVerb.group;
  document.getElementById('check-inf').textContent = learnVerb.inf;
  document.getElementById('check-meaning').textContent = learnVerb.meaning;
  const TENSE_HINT = { present:'', passe:' (passé composé)', imparfait:' (imparfait)', futur:' (futur)' };
  const t = window.learnCurrentTense || 'present';
  document.getElementById('check-pronoun').textContent = pronouns[idx] + ' ...' + (TENSE_HINT[t] || '');
  document.getElementById('check-input').value = '';
  document.getElementById('check-feedback').innerHTML = '';
  document.getElementById('study-step-label').textContent =
    `Шаг 2 из 2 — проверка (${learnCheckPos + 1} / ${learnCheckQueue.length})`;

  showLearnView('study-check-view');
  if (frKbEnabled) showFrKb('learn');
  else hideFrKb('learn');
  const checkInp = document.getElementById('check-input');
  if (checkInp) {
    checkInp.inputMode = frKbEnabled ? 'none' : 'text';
    setTimeout(() => checkInp.focus(), 150);
  }
}

export async function checkLearnAnswer(PHRASES, PHRASES_LOADED, loadPhrasesFromCloud, frKbEnabled, showFrKb, hideFrKb) {
  if (!PHRASES_LOADED && sbUser) await loadPhrasesFromCloud();
  const idx = learnCheckQueue[learnCheckPos];
  const input = document.getElementById('check-input')?.value.trim().toLowerCase();
  // Use tense selected in UI
  const tense = window.learnCurrentTense || 'present';
  let correct = '';
  if (tense === 'present') {
    correct = (learnVerb.conj?.present?.[idx] || '').toLowerCase();
  } else if (tense === 'passe') {
    const pp = learnVerb.pp || (learnVerb.inf.endsWith('er') ? learnVerb.inf.slice(0,-2)+'é' : learnVerb.inf.endsWith('ir') ? learnVerb.inf.slice(0,-1) : learnVerb.inf);
    const aux = learnVerb.aux === 'être' ? 'être' : 'avoir';
    const etreConj = ['suis','es','est','sommes','êtes','sont'];
    const avoirConj = ['ai','as','a','avons','avez','ont'];
    const auxForms = aux === 'être' ? etreConj : avoirConj;
    correct = (auxForms[idx] + ' ' + pp).toLowerCase();
  } else if (tense === 'imparfait') {
    const forms = learnVerb.conj?.imparfait || [];
    if (forms.length) {
      correct = (forms[idx] || '').toLowerCase();
    } else {
      const stem = (learnVerb.conj?.present?.[3] || '').replace(/ons$/, '');
      const suffixes = ['ais','ais','ait','ions','iez','aient'];
      correct = (stem + suffixes[idx]).toLowerCase();
    }
  } else if (tense === 'futur') {
    const forms = learnVerb.conj?.futur || [];
    if (forms.length) {
      correct = (forms[idx] || '').toLowerCase();
    } else {
      // Regular futur: infinitive (drop final -e for -re verbs) + endings
      let stem = learnVerb.inf;
      if (stem.endsWith('e')) stem = stem.slice(0, -1);
      const suffixes = ['ai','as','a','ons','ez','ont'];
      correct = (stem + suffixes[idx]).toLowerCase();
    }
  }
  const isCorrect = normalize(input) === normalize(correct);
  const fb = document.getElementById('check-feedback');

  if (isCorrect) {
    // Find phrase matching BOTH the correct form AND the pronoun being practiced.
    // 'achète' matches je/il/elle, so we must check the sentence starts with the right pronoun.
    const tense = window.learnCurrentTense || 'present';
    const wordForm = normalize(correct.split(' ').pop());
    // Expected sentence-start patterns for each pronoun index
    const pronounStarts = [
      ['je ', "j'"],                    // 0: je
      ['tu '],                          // 1: tu
      ['il ', 'elle ', 'on ', "c'"],    // 2: il/elle
      ['nous '],                        // 3: nous
      ['vous '],                        // 4: vous
      ['ils ', 'elles ']                // 5: ils/elles
    ];
    const starts = pronounStarts[idx] || [];
    const matchesPronoun = (fr) => {
      const low = fr.toLowerCase().trimStart();
      return starts.some(s => low.startsWith(s));
    };
    const candidates = PHRASES.filter(p =>
      p.verbId === learnVerb.id && normalize(p.answer) === wordForm
    );
    // Prefer: same tense + matching pronoun → matching pronoun → same tense → any
    const matchingPhrase =
      candidates.find(p => p.tense === tense && matchesPronoun(p.fr)) ||
      candidates.find(p => matchesPronoun(p.fr)) ||
      candidates.find(p => p.tense === tense) ||
      candidates[0];

    // Speak the full example sentence (not the bare form) when we have one
    const spokenText = matchingPhrase
      ? matchingPhrase.fr.replace('___', correct)
      : correct;
    speak(spokenText);

    const exampleHtml = matchingPhrase
      ? `<div style="font-size:0.82rem;color:var(--text-dim);font-style:italic;margin-top:10px;padding:10px 12px;background:var(--surface2);border-radius:8px;line-height:1.5">
          <div style="display:flex;align-items:flex-start;gap:8px">
            <div style="flex:1">${matchingPhrase.fr.replace('___', `<strong style="color:var(--accent)">${correct}</strong>`)}</div>
            <button onclick="speak('${spokenText.replace(/'/g, "\\'")}')" title="Озвучить" style="background:none;border:1px solid var(--border);border-radius:6px;padding:4px 8px;cursor:pointer;color:var(--text-muted);font-size:0.85rem;flex-shrink:0">🔊</button>
          </div>
          <div style="font-size:0.75rem;color:var(--text-muted);margin-top:4px">${matchingPhrase.ru}</div>
         </div>`
      : `<div style="margin-top:8px"><button onclick="speak('${correct.replace(/'/g, "\\'")}')" title="Озвучить" style="background:none;border:1px solid var(--border);border-radius:6px;padding:5px 12px;cursor:pointer;color:var(--text-muted);font-size:0.8rem">🔊 Произнести</button></div>`;
    learnCheckPos++;
    const isLast = learnCheckPos >= learnCheckQueue.length;
    if (isLast) learnCheckCompleted = true; // full check passed honestly
    const nextFn = isLast ? 'startPhrasesStep()' : 'showLearnCheckForm()';
    fb.innerHTML = `<div class="feedback-msg correct" style="margin-bottom:6px">✓ <strong>${correct}</strong></div>${exampleHtml}
      <button class="btn btn-primary" onclick="${nextFn}" style="width:100%;padding:9px;margin-top:10px">Далее →</button>`;
  } else {
    learnCheckErrors++;
    speak(correct);
    learnCheckQueue.push(idx);
    fb.innerHTML = `<div class="feedback-msg wrong" style="margin-bottom:10px">✗ Правильно: <strong>${correct}</strong>
      <button onclick="speak('${correct.replace(/'/g, "\\'")}')" title="Озвучить" style="background:none;border:1px solid var(--border);border-radius:6px;padding:3px 9px;cursor:pointer;color:var(--text-muted);font-size:0.8rem;margin-left:8px">🔊</button></div>
      <div style="font-size:0.78rem;color:var(--text-muted);margin-bottom:10px">Эта форма вернётся в конец очереди</div>
      <button class="btn btn-primary" onclick="showLearnCheckForm()" style="width:100%;padding:10px">Понял, дальше →</button>`;
  }
}

export async function startPhrasesStep(PHRASES, PHRASES_LOADED, loadPhrasesFromCloud, frKbEnabled, showFrKb, hideFrKb) {
  if (!PHRASES_LOADED && sbUser) await loadPhrasesFromCloud();
  const tense = window.learnCurrentTense || 'present';
  let verbPhrases = PHRASES.filter(p => p.verbId === learnVerb.id && p.tense === tense);
  // Phrases may have been generated after initial load — force reload once
  if (!verbPhrases.length && sbUser) {
    await loadPhrasesFromCloud();
    verbPhrases = PHRASES.filter(p => p.verbId === learnVerb.id && p.tense === tense);
  }
  // No phrases for THIS tense → skip the phrase step entirely.
  // (Never show phrases from another tense — that caused présent phrases to
  //  appear while learning passé composé and broke the check.)
  if (!verbPhrases.length) { finishLearn(); return; }
  learnPhraseQueue = verbPhrases.sort(() => Math.random() - 0.5).slice(0, learnPhraseCount);
  learnPhraseIdx = 0;
  learnPhraseErrors = 0;
  showPhraseForm(frKbEnabled, showFrKb, hideFrKb);
}

export function advancePhrase(frKbEnabled, showFrKb, hideFrKb) {
  learnPhraseIdx++;
  if (learnPhraseIdx >= learnPhraseQueue.length) finishLearn();
  else showPhraseForm(frKbEnabled, showFrKb, hideFrKb);
}

export function showPhraseForm(frKbEnabled, showFrKb, hideFrKb) {
  const phrase = learnPhraseQueue[learnPhraseIdx];
  document.getElementById('phrases-step-label').textContent = `Фраза ${learnPhraseIdx + 1} из ${learnPhraseQueue.length}`;
  document.getElementById('phrase-fr').textContent = phrase.fr;
  document.getElementById('phrase-ru').textContent = phrase.ru;
  document.getElementById('phrase-input').value = '';
  document.getElementById('phrase-feedback').innerHTML = '';
  showLearnView('study-phrases-view');
  if (frKbEnabled) showFrKb('phrase-learn');
  else hideFrKb('phrase-learn');
  const phraseInp = document.getElementById('phrase-input');
  if (phraseInp) {
    phraseInp.inputMode = frKbEnabled ? 'none' : 'text';
    setTimeout(() => phraseInp.focus(), 150);
  }
}

export function checkPhraseAnswer(frKbEnabled, showFrKb, hideFrKb) {
  const phrase = learnPhraseQueue[learnPhraseIdx];
  const input = document.getElementById('phrase-input')?.value.trim();
  const isCorrect = normalize(input) === normalize(phrase.answer);
  const fb = document.getElementById('phrase-feedback');

  if (isCorrect) {
    const fullPhrase = phrase.fr.replace('___', `<strong style="color:var(--accent)">${phrase.answer}</strong>`);
    fb.innerHTML = `<div class="feedback-msg correct" style="margin-bottom:10px">✓ Правильно!</div>
      <div style="font-size:0.88rem;font-style:italic;color:var(--text);line-height:1.6;padding:10px 12px;background:var(--surface2);border-radius:8px;margin-bottom:10px">${fullPhrase}</div>
      <button class="btn btn-primary" onclick="advancePhrase()" style="width:100%;padding:9px">Далее →</button>`;
    speak(phrase.fr.replace('___', phrase.answer));
  } else {
    learnPhraseErrors++;
    speak(phrase.fr.replace('___', phrase.answer));
    learnPhraseQueue.push(phrase);
    fb.innerHTML = `<div class="feedback-msg wrong" style="margin-bottom:10px">✗ Правильно: <strong>${phrase.answer}</strong></div>
      <div style="font-size:0.78rem;color:var(--text-muted);margin-bottom:10px">Эта фраза вернётся в конец очереди</div>
      <button class="btn btn-primary" onclick="advancePhrase()" style="width:100%;padding:10px">Понял, дальше →</button>`;
  }
}

export async function finishLearn(startLearnSessionFn = () => {}) {
  // First interval depends on how well it was learned:
  //   0 errors      → 3 days (knows it well)
  //   1-2 errors    → 1 day
  //   3+ errors     → 0 days (due today — review again right away)
  const totalErrors = learnCheckErrors + learnPhraseErrors;
  let interval;
  if (totalErrors === 0) interval = 3;
  else if (totalErrors <= 2) interval = 1;
  else interval = 0;
  // Skipped the check ("Понял паттерн, сразу к фразам")? Then 0 errors is not
  // evidence of knowledge — be honest and review again tomorrow at the latest.
  if (!learnCheckCompleted) interval = Math.min(interval, 1);

  const srs = loadSRS();
  // Create/update the card for the tense that was just learned
  const learnTense = window.learnCurrentTense || 'present';
  const key = srsKey(learnVerb.id, learnTense);
  const existing = srs[key];
  // Only overwrite if new schedule is sooner-or-equal (don't undo real progress)
  if (!existing || existing.interval >= interval) {
    srs[key] = {
      interval: Math.max(interval, 1), // store at least 1 so it's a valid card
      easeFactor: 2.5,
      repetitions: interval >= 3 ? 1 : 0,
      dueDate: addDays(todayStr(), interval), // interval 0 → due today
      lastReview: todayStr(), stage: 'forms'
    };
    saveSRS(srs);
  }

  // In the new concept the verb stays in the personal plan until ALL tenses
  // are learned. Only remove it from the plan once every tense has a card.
  if (learnVerb && isInLearnLater(learnVerb.id)) {
    const allLearned = ['present','passe','imparfait','futur'].every(t => srs[srsKey(learnVerb.id, t)]);
    if (allLearned) removeLearnLater(learnVerb.id);
  }

  document.getElementById('result-emoji').textContent = totalErrors === 0 ? '🎉' : (totalErrors >= 3 ? '💪' : '✅');
  document.getElementById('result-title').textContent = totalErrors === 0 ? 'Отлично! Без ошибок!' : (totalErrors >= 3 ? 'Изучен — но нужно повторить' : 'Изучен!');

  studyQueueIdx++;
  const hasNext = studyQueueIdx < studyQueue.length;
  const errText = (learnCheckErrors + learnPhraseErrors) > 0 ? ` · ${learnCheckErrors + learnPhraseErrors} ошибок` : ' · без ошибок';
  const whenText = interval === 0 ? 'на сегодня — повтори ещё раз' : `на ${interval} дн.`;
  document.getElementById('result-text').textContent = `${learnVerb.inf} добавлен в расписание ${whenText}`;

  const sessionInfo = document.getElementById('result-session-info');
  if (sessionInfo) {
    const done = studyQueueIdx, total = studyQueue.length;
    sessionInfo.textContent = total > 1 ? `Изучено ${done} из ${total}${errText}` : errText.trim().replace(' · ','');
  }

  const nextBtn = document.getElementById('result-next-btn');
  if (nextBtn) {
    if (hasNext) {
      nextBtn.textContent = `▶ Следующий (${studyQueue.length - studyQueueIdx} осталось)`;
      nextBtn.onclick = () => learnVerbStart(studyQueue[studyQueueIdx].id, studyQueue.map(v => v));
    } else {
      nextBtn.textContent = '▶ Изучить следующий';
      nextBtn.onclick = startLearnSessionFn;
    }
  }
  showLearnView('study-result-view');
}

export function backToLearnCard() {
  showLearnView('study-card-view');
}

export function exitLearnSession(renderStudyScreenFn) {
  learnVerb = null;
  showLearnView('study-pick');
  renderStudyScreenFn();
}
