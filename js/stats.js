// ════════════════════════════════════════════════
// stats.js — экран статистики
// ════════════════════════════════════════════════

import { TENSE_NAMES } from './state.js';
import { profileKey } from './utils.js';
import { loadStats } from './storage.js';
import { loadMeta } from './storage.js';
import { loadSRS } from './srs.js';
import { sbUser, sb, sbLoadStats } from './supabase.js';
import { currentProfile } from './state.js';

export async function renderStats(VERBS, NOUNS) {
  let stats = {};
  if (sbUser) {
    const data = await sbLoadStats();
    if (data) stats = data;
  } else {
    stats = loadStats();
  }
  const meta = loadMeta();
  const srs  = loadSRS();

  const verbKeys = Object.keys(stats).filter(k =>
    !k.startsWith('tense_') && !k.startsWith('noun_') && !k.startsWith('prep_') && !k.startsWith('ph_')
  );

  if (verbKeys.length === 0 && Object.keys(stats).filter(k => k.startsWith('noun_')).length === 0) {
    document.getElementById('stats-empty').style.display = 'block';
    document.getElementById('stats-content').style.display = 'none';
    return;
  }
  document.getElementById('stats-empty').style.display = 'none';
  document.getElementById('stats-content').style.display = 'block';

  document.getElementById('stat-streak').textContent = meta.streak || 0;
  document.getElementById('stat-streak-best').textContent = 'Рекорд: ' + (meta.bestStreak || 0);
  let totalAll = 0;
  verbKeys.forEach(k => { totalAll += stats[k].total || 0; });
  document.getElementById('stat-total-label').textContent = 'Всего попыток (глаголы): ' + totalAll;

  const tenseEl = document.getElementById('tense-stats');
  tenseEl.innerHTML = '';
  ['present','passe','imparfait','futur'].forEach(t => {
    const s = stats['tense_' + t];
    const pct = s && s.total > 0 ? Math.round(s.correct / s.total * 100) : null;
    const color = pct === null ? 'var(--text-dim)' : pct >= 75 ? 'var(--good)' : pct >= 50 ? 'var(--warn)' : 'var(--bad)';
    tenseEl.innerHTML += `
      <div class="tense-stat-row">
        <div class="tense-stat-name">${TENSE_NAMES[t]}</div>
        <div class="tense-stat-bar-wrap"><div class="tense-stat-bar" style="width:${pct||0}%;background:${color}"></div></div>
        <div class="tense-stat-pct" style="color:${color}">${pct !== null ? pct+'%' : '—'}</div>
        <div style="font-size:0.72rem;color:var(--text-muted);min-width:60px;text-align:right">${s ? s.total + ' попыток' : 'нет данных'}</div>
      </div>`;
  });

  const verbData = verbKeys.map(k => {
    const s = stats[k];
    const verb = VERBS.find(v => v.id === k);
    const card = srs[k];
    return {
      id: k, inf: verb ? verb.inf : k, meaning: verb ? verb.meaning : '',
      total: s.total, correct: s.correct,
      pct: Math.round(s.correct / s.total * 100),
      interval: card ? card.interval : 0, known: card?.markedKnown
    };
  }).sort((a,b) => a.pct - b.pct);

  const weakEl = document.getElementById('weak-verbs-list');
  const weak = verbData.filter(v => v.pct < 60 && v.total >= 2);
  weakEl.innerHTML = weak.length === 0
    ? '<div style="color:var(--text-muted);font-size:0.85rem;padding:12px 0">Пока нет слабых глаголов — отлично!</div>'
    : weak.map(v => verbStatRow(v)).join('');

  document.getElementById('all-verb-stats').innerHTML = verbData.map(v => verbStatRow(v)).join('');

  const nounKeys = Object.keys(stats).filter(k => k.startsWith('noun_'));
  let nounStatsEl = document.getElementById('noun-stats-section');
  if (!nounStatsEl) {
    const section = document.createElement('div');
    section.id = 'noun-stats-section'; section.style.marginTop = '32px';
    document.getElementById('all-verb-stats').parentElement.appendChild(section);
    nounStatsEl = section;
  }
  if (nounKeys.length > 0) {
    const nounData = nounKeys.map(k => {
      const s = stats[k];
      const id = k.replace('noun_','');
      const noun = NOUNS.find(n => n.id === id);
      return { id, inf: noun ? noun.fr : id, meaning: noun ? noun.ru : '',
               total: s.total, correct: s.correct, pct: Math.round(s.correct / s.total * 100) };
    }).sort((a,b) => a.pct - b.pct);
    const weak = nounData.filter(n => n.pct < 60 && n.total >= 2);
    nounStatsEl.innerHTML = `
      <div class="section-title" style="margin-bottom:12px">🔤 Существительные</div>
      ${weak.length > 0 ? `<div style="font-size:0.72rem;text-transform:uppercase;letter-spacing:0.08em;color:var(--bad);margin-bottom:8px">Слабые</div>` + weak.map(n => verbStatRow(n)).join('') : ''}
      <div style="font-size:0.72rem;text-transform:uppercase;letter-spacing:0.08em;color:var(--text-muted);margin:12px 0 8px">Все (${nounData.length})</div>
      ${nounData.map(n => verbStatRow(n)).join('')}`;
  } else {
    nounStatsEl.innerHTML = '';
  }
}

function verbStatRow(v) {
  const color = v.pct >= 75 ? 'var(--good)' : v.pct >= 50 ? 'var(--warn)' : 'var(--bad)';
  return `<div class="verb-stat-row">
    <div class="verb-stat-name" style="font-style:italic">${v.inf}</div>
    <div style="font-size:0.75rem;color:var(--text-muted);min-width:100px">${v.meaning}</div>
    <div class="verb-stat-bar-wrap"><div class="verb-stat-bar" style="width:${v.pct}%;background:${color}"></div></div>
    <div class="verb-stat-pct" style="color:${color}">${v.pct}%</div>
    <div class="verb-stat-count">${v.total} попыток</div>
  </div>`;
}

export async function confirmReset(VERBS, renderStatsFn, renderHomeFn) {
  if (!confirm('Сбросить всю статистику и расписание повторений? Это действие нельзя отменить.')) return;
  localStorage.removeItem(profileKey('stats', currentProfile));
  localStorage.removeItem(profileKey('meta', currentProfile));
  localStorage.removeItem(profileKey('srs', currentProfile));
  if (sbUser) {
    await sb.from('stats').delete().eq('user_id', sbUser.id);
    await sb.from('meta').delete().eq('user_id', sbUser.id);
    await sb.from('srs').delete().eq('user_id', sbUser.id);
  }
  renderStatsFn();
  renderHomeFn();
}
