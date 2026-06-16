// ════════════════════════════════════════════════
// state.js — глобальное состояние приложения
// ════════════════════════════════════════════════

// ── Профиль ──
export let currentProfile = null;
export function setCurrentProfile(name) { currentProfile = name; }

// ── Данные из Supabase ──
export let VERBS = [];
export let PHRASES = [];
export let VERBS_LOADED = false;
export let PHRASES_LOADED = false;

export function setVerbsLoaded(v) { VERBS_LOADED = v; }
export function setPhrasesLoaded(v) { PHRASES_LOADED = v; }
export function setVerbs(arr) { VERBS.length = 0; arr.forEach(v => VERBS.push(v)); }
export function setPhrases(arr) { PHRASES.length = 0; arr.forEach(p => PHRASES.push(p)); }

// ── Константы ──
export const PRONOUNS = ['je','tu','il','nous','vous','ils'];
export const TENSE_NAMES = {
  present: 'Présent',
  passe: 'Passé composé',
  imparfait: 'Imparfait',
  futur: 'Futur simple',
  plus_que_parfait: 'Plus-que-parfait',
  conditionnel: 'Conditionnel présent',
  subjonctif: 'Subjonctif présent',
  imperatif: 'Impératif',
  passe_simple: 'Passé simple'
};
export const BADGE_CLASS = {er:'badge-er',ir:'badge-ir',re:'badge-re',irr:'badge-irr',ref:'badge-ref'};
export const AUX_AVOIR = ['ai','as','a','avons','avez','ont'];
export const AUX_ETRE  = ['suis','es','est','sommes','êtes','sont'];

// ── Настройки ──
export let frKbEnabled = localStorage.getItem('frKbEnabled') !== '0';
export let autoSpeak   = localStorage.getItem('autoSpeak') === '1';
export function setFrKbEnabled(v) { frKbEnabled = v; }
export function setAutoSpeak(v)   { autoSpeak = v; }

// ── Тренажёр ──
export let currentVerb = null;
export let currentPronounIdx = null;
export let currentTense = null;
export let ruleVisible = false;
export function setCurrentVerb(v) { currentVerb = v; }
export function setCurrentPronounIdx(i) { currentPronounIdx = i; }
export function setCurrentTense(t) { currentTense = t; }
export function setRuleVisible(v) { ruleVisible = v; }

// ── Раздел изучить ──
export let studySelectedIds = new Set();
export let studySelectMode = false;
export let learnVerb = null;
export let learnCheckPronounIdx = 0;
export let learnCheckQueue = [];
export let learnCheckPos = 0;
export let learnCheckErrors = 0;
export let learnPhraseQueue = [];
export let learnPhraseIdx = 0;
export let learnPhraseErrors = 0;
export let learnPhraseCount = parseInt(localStorage.getItem('learnPhraseCount') || '3');
export let studyQueue = [];
export let studyQueueIdx = 0;
export function setLearnVerb(v) { learnVerb = v; }
export function setStudySelectMode(v) { studySelectMode = v; }

// ── Фразы ──
export let currentPhrase = null;
export let phGood = 0, phBad = 0, phStreak = 0;
export let phSelectedVerbs = new Set();
export function setCurrentPhrase(p) { currentPhrase = p; }
export function resetPhScores() { phGood = 0; phBad = 0; phStreak = 0; }
export function incPhGood() { phGood++; phStreak++; }
export function incPhBad() { phBad++; phStreak = 0; }

// ── Словарь ──
export let dictSelected = null;
export function setDictSelected(id) { dictSelected = id; }

// ── Числа ──
export let currentNumber = null;
export let nGood = 0, nBad = 0, nStreak = 0;

// ── Группы ──
export let currentGroupId = null;
export let gCurrentVerb = null;
export let gCurrentPronounIdx = null;
export let gCurrentTense = 'present';
export let gGood = 0, gBad = 0, gStreak = 0, gCount = 0;

// ── TTS ──
export let ttsVoice = null;
export let ttsAudio = null;
export let ttsToken = 0;
export function setTtsVoice(v) { ttsVoice = v; }
export function setTtsAudio(a) { ttsAudio = a; }
export function nextTtsToken() { return ++ttsToken; }

// ── Прочее ──
export let selectedVerbIds = new Set();
export let vpGroupFilter = 'all';
