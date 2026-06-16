// ════════════════════════════════════════════════
// srs.js — алгоритм SM-2 и работа с SRS данными
// ════════════════════════════════════════════════

import { todayStr, addDays, profileKey, toDateStr } from './utils.js';
import { sbUser, sb, sbSaveSRS } from './supabase.js';
import { currentProfile } from './state.js';

export const SRS_DEFAULT_EF = 2.5;
export const SRS_MIN_EF = 1.3;

const SRS_MAX_INTERVAL = 100; // cap interval at 100 days

// ════════════════════════════════════════════════
// Per-tense SRS keys: a card is identified by verb + tense, e.g. "etre|present".
// All 6 persons of that tense are checked inside one review (handled in trainer).
// ════════════════════════════════════════════════
export const SRS_TENSES = ['present', 'passe', 'imparfait', 'futur'];

export function srsKey(verbId, tense) {
  return `${verbId}|${tense}`;
}

// Parse a key back into { verbId, tense }. Legacy keys (no "|") → tense null.
export function parseSrsKey(key) {
  const i = key.indexOf('|');
  if (i === -1) return { verbId: key, tense: null };
  return { verbId: key.slice(0, i), tense: key.slice(i + 1) };
}

// Get the card for a specific verb+tense
export function getCard(srs, verbId, tense) {
  return srs[srsKey(verbId, tense)] || null;
}

// Does this verb have ANY tense card (i.e. has it been studied at all)?
export function verbHasAnyCard(srs, verbId) {
  const prefix = verbId + '|';
  for (const k in srs) {
    if (k === verbId || k.startsWith(prefix)) return true;
  }
  return false;
}

// Which tenses of this verb are due (dueDate <= today)?
export function verbDueTenses(srs, verbId, today, toDateStrFn) {
  const due = [];
  for (const t of SRS_TENSES) {
    const c = srs[srsKey(verbId, t)];
    if (c && toDateStrFn(c.dueDate) <= today) due.push(t);
  }
  return due;
}


// ── One-time repair for cards corrupted by the old multiply-every-answer bug ──
// Caps absurd intervals (e.g. 9300 days) and recomputes a sane due date.
export function sanitizeSRS(srs) {
  let changed = false;
  for (const [id, card] of Object.entries(srs || {})) {
    if (!card) continue;
    if (typeof card.interval === 'number' && card.interval > 100) {
      // Clamp to the max and pull the due date back in range.
      card.interval = 100;
      card.dueDate = addDays(todayStr(), card.interval);
      changed = true;
    }
    // Also guard ease factor from drifting unreasonably high
    if (typeof card.easeFactor === 'number' && card.easeFactor > 3.0) {
      card.easeFactor = 2.5;
      changed = true;
    }
  }
  return { srs, changed };
}

export function sm2Update(card, grade) {
  let { interval = 1, easeFactor = SRS_DEFAULT_EF, repetitions = 0, lastReview = null } = card || {};

  const today = todayStr();

  // GUARD: only advance the interval ONCE per day.
  // SM-2 assumes one review per day. Practicing the same verb many times in a
  // session must NOT multiply the interval each time (that caused 9300-day intervals).
  if (lastReview && toDateStr(lastReview) === today) {
    if (grade >= 3) {
      // Already reviewed correctly today — keep schedule, just refresh lastReview.
      return { interval, easeFactor, repetitions, dueDate: addDays(today, interval), lastReview: today };
    }
    // A wrong answer still resets (you clearly don't know it).
    easeFactor = Math.max(SRS_MIN_EF, easeFactor - 0.2);
    return { interval: 1, easeFactor, repetitions: 0, dueDate: addDays(today, 1), lastReview: today };
  }

  if (grade >= 3) {
    if (repetitions === 0) interval = 1;
    else if (repetitions === 1) interval = 6;
    else interval = Math.round(interval * easeFactor);
    interval = Math.min(interval, SRS_MAX_INTERVAL); // hard cap
    repetitions++;
    easeFactor = Math.max(SRS_MIN_EF, easeFactor + 0.1 - (5 - grade) * (0.08 + (5 - grade) * 0.02));
  } else {
    repetitions = 0;
    interval = 1;
    easeFactor = Math.max(SRS_MIN_EF, easeFactor - 0.2);
  }

  const dueDate = addDays(today, interval);
  return { interval, easeFactor, repetitions, dueDate, lastReview: today };
}


// ── Merge cloud + local SRS: newer lastReview wins ──
// Prevents cloud (possibly stale due to a failed write) from wiping fresh local progress.
export function mergeSRS(local, cloud) {
  const merged = { ...(local || {}) };
  for (const [id, cloudCard] of Object.entries(cloud || {})) {
    const localCard = merged[id];
    if (!localCard) {
      merged[id] = cloudCard;
    } else {
      // Compare lastReview dates — keep the newer one
      const lr = toDateStr(localCard.lastReview) || '0000-00-00';
      const cr = toDateStr(cloudCard.lastReview) || '0000-00-00';
      merged[id] = cr > lr ? cloudCard : localCard;
    }
  }
  return merged;
}

// ── Retry queue for failed cloud writes ──
const SRS_RETRY_KEY = 'srs_retry_pending';

function queueFailedSync(profile) {
  try { localStorage.setItem(SRS_RETRY_KEY, profile || ''); } catch {}
}

export async function flushFailedSync() {
  const pending = localStorage.getItem(SRS_RETRY_KEY);
  if (!pending || !sbUser) return;
  const data = loadSRS();
  if (!Object.keys(data).length) { localStorage.removeItem(SRS_RETRY_KEY); return; }
  try {
    await sbSaveSRS(data);
    localStorage.removeItem(SRS_RETRY_KEY);
    console.log('SRS retry sync succeeded');
  } catch (e) {
    console.warn('SRS retry still failing:', e);
  }
}

export function loadSRS() {
  if (!currentProfile) return {};
  try { return JSON.parse(localStorage.getItem(profileKey('srs', currentProfile)) || '{}'); } catch { return {}; }
}

export async function saveSRS(s) {
  if (!currentProfile) return;
  // localStorage FIRST — instant, never lost
  localStorage.setItem(profileKey('srs', currentProfile), JSON.stringify(s));
  // Cloud SECOND — on failure, queue for retry instead of losing silently
  if (sbUser) {
    try {
      await sbSaveSRS(s);
      localStorage.removeItem(SRS_RETRY_KEY); // success clears any pending retry
    } catch(e) {
      console.error('saveSRS cloud error, queued for retry:', e);
      queueFailedSync(currentProfile);
    }
  }
}

export function updateSRS(verbId, correct, grade) {
  if (!verbId) return;
  const effectiveGrade = grade !== undefined ? grade : (correct ? 4 : 1);
  const srs = loadSRS();
  const card = srs[verbId] || null;
  const updated = sm2Update(card, effectiveGrade);
  srs[verbId] = updated;
  saveSRS(srs); // handles both localStorage and cloud with retry
}
