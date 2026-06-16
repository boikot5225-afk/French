// ════════════════════════════════════════════════
// storage.js — работа с localStorage и данными
// ════════════════════════════════════════════════

import { profileKey } from './utils.js';
import { sbUser, sb, sbSaveStats, sbSaveMeta } from './supabase.js';
import { currentProfile } from './state.js';

export function loadStats() {
  if (!currentProfile) return {};
  try { return JSON.parse(localStorage.getItem(profileKey('stats', currentProfile)) || '{}'); } catch { return {}; }
}

export async function saveStats(s) {
  if (!currentProfile) return;
  localStorage.setItem(profileKey('stats', currentProfile), JSON.stringify(s));
  if (sbUser) {
    try { await sbSaveStats(s); } catch(e) { console.error('saveStats error:', e); }
  }
}

export async function syncStatsFromCloud() {
  if (!sbUser) return;
  try {
    const { data } = await sb.from('stats').select('*').eq('user_id', sbUser.id);
    if (data && data.length > 0) {
      const stats = {};
      data.forEach(r => { stats[r.key] = { total: r.total, correct: r.correct }; });
      localStorage.setItem(profileKey('stats', currentProfile), JSON.stringify(stats));
    }
  } catch(e) { console.error('syncStatsFromCloud error:', e); }
}

export function loadMeta() {
  if (!currentProfile) return {};
  try { return JSON.parse(localStorage.getItem(profileKey('meta', currentProfile)) || '{}'); } catch { return {}; }
}

export async function saveMeta(m) {
  if (!currentProfile) return;
  localStorage.setItem(profileKey('meta', currentProfile), JSON.stringify(m));
  if (sbUser) {
    try { await sbSaveMeta(m); } catch(e) { console.error('saveMeta error:', e); }
  }
}

// ── "Изучить позже" — список глаголов отложенных на изучение ──
export function loadLearnLater() {
  if (!currentProfile) return [];
  try { return JSON.parse(localStorage.getItem(profileKey('learnlater', currentProfile)) || '[]'); }
  catch { return []; }
}

export function saveLearnLater(ids) {
  if (!currentProfile) return;
  localStorage.setItem(profileKey('learnlater', currentProfile), JSON.stringify(ids));
}

export function addLearnLater(verbId) {
  const list = loadLearnLater();
  if (!list.includes(verbId)) {
    list.push(verbId);
    saveLearnLater(list);
  }
  return list;
}

export function removeLearnLater(verbId) {
  const list = loadLearnLater().filter(id => id !== verbId);
  saveLearnLater(list);
  return list;
}

export function isInLearnLater(verbId) {
  return loadLearnLater().includes(verbId);
}
