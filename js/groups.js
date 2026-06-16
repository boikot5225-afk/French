// ════════════════════════════════════════════════
// groups.js — тренажёр групп неправильных глаголов
// ════════════════════════════════════════════════

import { PRONOUNS, TENSE_NAMES } from './state.js';
import { elide, normalize } from './utils.js';
import { loadStats, saveStats } from './storage.js';
import { speak } from './tts.js';

export const IRR_GROUPS = [
  { id:'etre_avoir', name:'ÊTRE / AVOIR', color:'var(--accent)',
    pattern:'Полностью нерегулярные — просто заучить.\nêtre: suis/es/est/sommes/êtes/sont\navoir: ai/as/a/avons/avez/ont',
    verbIds:['être','avoir'], note:'Основа être в imparfait: ét- (j\'étais). Futur: ser- / aur-' },
  { id:'aller', name:'ALLER', color:'var(--er)',
    pattern:'Единственный -ER глагол с полностью нерегулярным présent.\nje vais / tu vas / il va / nous allons / vous allez / ils vont\nFutur: ir- (j\'irai)',
    verbIds:['aller'], note:'Passé composé с être: je suis allé(e)' },
  { id:'venir_tenir', name:'VENIR / TENIR', color:'var(--ir)',
    pattern:'Паттерн: -iens / -iens / -ient / -enons / -enez / -iennent\nvenir: viens/viens/vient/venons/venez/viennent\ntenir: tiens/tiens/tient/tenons/tenez/tiennent\nFutur: viendr- / tiendr-',
    verbIds:['venir','tenir'], note:'Все производные: devenir, revenir, obtenir, appartenir — тот же паттерн' },
  { id:'prendre', name:'PRENDRE', color:'var(--re)',
    pattern:'Ед.ч.: prends/prends/prend (без -s у il!)\nМн.ч.: prenons/prenez/prennent (удвоение n)\nFutur регулярный: prendrai',
    verbIds:['prendre','comprendre','apprendre'], note:'comprendre, apprendre, surprendre — тот же паттерн' },
  { id:'partir_sortir', name:'PARTIR / SORTIR / DORMIR', color:'var(--irr)',
    pattern:'В ед.ч. отбрасывается конечный согласный основы:\npartir: pars/pars/part — partons/partez/partent\nsortir: sors/sors/sort — sortons/sortez/sortent\ndormir: dors/dors/dort — dormons/dormez/dorment',
    verbIds:['partir','sortir','dormir','sentir'], note:'Passé composé: partir/sortir с être, dormir/sentir с avoir' },
  { id:'voir', name:'VOIR / CROIRE', color:'var(--er)',
    pattern:'Основа меняется: voi- в ед.ч. → voy- в nous/vous\nvois/vois/voit — voyons/voyez/voient\nFutur неправильный: verr- (verrai, verras...)',
    verbIds:['voir'], note:'croire: crois/crois/croit/croyons/croyez/croient' },
  { id:'faire', name:'FAIRE', color:'var(--accent)',
    pattern:'fais/fais/fait/faisons/faites/font\nВнимание: vous faites — исключение из правила -ez!\nFutur: fer- (ferai, feras...)',
    verbIds:['faire'], note:'Participe passé: fait. Très fréquent!' },
  { id:'mettre', name:'METTRE / BATTRE', color:'var(--re)',
    pattern:'В ед.ч. только одна t:\nmets/mets/met — mettons/mettez/mettent\nbats/bats/bat — battons/battez/battent\nFutur регулярный: mettrai/battrai',
    verbIds:['mettre','permettre','promettre','battre'], note:'permettre, promettre — тот же паттерн' },
  { id:'pouvoir_vouloir', name:'POUVOIR / VOULOIR / SAVOIR', color:'var(--irr)',
    pattern:'Модальные глаголы:\npeux/peux/peut/pouvons/pouvez/peuvent\nveux/veux/veut/voulons/voulez/veulent\nsais/sais/sait/savons/savez/savent\nFutur: pourr- / voudr- / saur-',
    verbIds:['pouvoir','vouloir','savoir','devoir'], note:'devoir: dois/dois/doit/devons/devez/doivent — тот же тип' },
  { id:'ouvrir', name:'OUVRIR / OFFRIR', color:'var(--er)',
    pattern:'Спрягаются КАК -ER глаголы (не как -IR!):\nouvre/ouvres/ouvre/ouvrons/ouvrez/ouvrent\nParticipe passé нерегулярный: ouvert',
    verbIds:['ouvrir'], note:'Та же модель: couvrir, découvrir, offrir, souffrir' },
  { id:'connaitre', name:'CONNAÎTRE / PARAÎTRE', color:'var(--accent)',
    pattern:'connais/connais/connaît (circonflexe перед t!)\nconnaissons/connaissez/connaissent\nОснова: connaiss- во мн.ч.',
    verbIds:['connaître'], note:'paraître, naître — тот же паттерн' },
];

let currentGroupId = null;
let gCurrentVerb = null, gCurrentPronounIdx = null, gCurrentTense = 'present';
let gGood = 0, gBad = 0, gStreak = 0, gCount = 0;

export function renderGroupsHome(VERBS) {
  const grid = document.getElementById('groups-grid');
  grid.innerHTML = IRR_GROUPS.map(g => {
    const available = VERBS.filter(v => g.verbIds.includes(v.id));
    return `<div onclick="openGroup('${g.id}')" style="background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:20px;cursor:pointer;transition:all 0.2s"
      onmouseover="this.style.borderColor='${g.color}';this.style.background='var(--surface2)'"
      onmouseout="this.style.borderColor='var(--border)';this.style.background='var(--surface)'">
      <div style="font-family:'IBM Plex Mono',monospace;font-size:0.7rem;color:${g.color};text-transform:uppercase;letter-spacing:0.08em;margin-bottom:8px">${g.name}</div>
      <div style="font-size:0.82rem;color:var(--text-muted);line-height:1.5;margin-bottom:10px">${g.pattern.split('\n')[0]}</div>
      <div style="font-size:0.75rem;color:var(--text-dim)">${available.map(v=>v.inf).join(', ')}</div>
    </div>`;
  }).join('');
}

export function openGroup(id, VERBS) {
  currentGroupId = id;
  const grp = IRR_GROUPS.find(g => g.id === id);
  document.getElementById('groups-home').style.display = 'none';
  document.getElementById('group-trainer').style.display = 'block';
  document.getElementById('group-pattern-card').innerHTML = `
    <div style="font-family:'IBM Plex Mono',monospace;font-size:0.8rem;color:${grp.color};text-transform:uppercase;letter-spacing:0.08em;margin-bottom:12px">${grp.name}</div>
    <div style="font-family:'IBM Plex Mono',monospace;font-size:0.85rem;line-height:1.9;color:var(--text);white-space:pre-line;margin-bottom:12px">${grp.pattern}</div>
    <div style="font-size:0.78rem;color:var(--text-muted);padding-top:10px;border-top:1px solid var(--border)">${grp.note}</div>
  `;
  gGood = 0; gBad = 0; gStreak = 0; gCount = 0;
  document.getElementById('gscore-good').textContent = '0';
  document.getElementById('gscore-bad').textContent = '0';
  document.getElementById('gscore-streak').textContent = '0';
  gNextCard(VERBS);
}

export function backToGroups() {
  document.getElementById('groups-home').style.display = 'block';
  document.getElementById('group-trainer').style.display = 'none';
  currentGroupId = null;
}

export function gNextCard(VERBS) {
  const grp = IRR_GROUPS.find(g => g.id === currentGroupId);
  const verbs = VERBS.filter(v => grp.verbIds.includes(v.id) && v.conj);
  if (!verbs.length) return;
  gCurrentVerb = verbs[Math.floor(Math.random() * verbs.length)];
  gCurrentPronounIdx = Math.floor(Math.random() * 6);
  const tenses = ['present','present','present','imparfait','futur','passe'];
  gCurrentTense = tenses[Math.floor(Math.random() * tenses.length)];
  document.getElementById('gcard-badge').textContent = 'Irrégulier · ' + TENSE_NAMES[gCurrentTense];
  document.getElementById('gcard-verb').textContent = gCurrentVerb.inf;
  document.getElementById('gcard-meaning').textContent = gCurrentVerb.meaning;
  document.getElementById('gcard-pronoun').textContent = PRONOUNS[gCurrentPronounIdx] + ' ...';
  const ctxEl = document.getElementById('gcard-context');
  ctxEl.textContent = gCurrentVerb.ex?.[gCurrentTense] || '';
  ctxEl.style.visibility = 'hidden';
  const inp = document.getElementById('ganswer-input');
  inp.value = ''; inp.className = 'answer-input'; inp.dataset.answered = '0'; inp.focus();
  document.getElementById('gfeedback-row').innerHTML = '<button class="hint-btn" onclick="gShowHint()">💡 Подсказка (−1)</button>';
  gCount++;
  document.getElementById('gtrainer-progress').style.width = Math.min(gCount * 5, 100) + '%';
}

function gGetCorrect() {
  if (!gCurrentVerb || !gCurrentTense) return '';
  if (gCurrentTense === 'passe') {
    const aux = gCurrentVerb.aux === 'avoir'
      ? ['ai','as','a','avons','avez','ont'][gCurrentPronounIdx]
      : ['suis','es','est','sommes','êtes','sont'][gCurrentPronounIdx];
    return elide(PRONOUNS[gCurrentPronounIdx] + ' ' + aux + ' ' + gCurrentVerb.pp);
  }
  const form = gCurrentVerb.conj[gCurrentTense]?.[gCurrentPronounIdx] || '';
  return elide(PRONOUNS[gCurrentPronounIdx] + ' ' + form);
}

export function gCheckAnswer(VERBS) {
  const inp = document.getElementById('ganswer-input');
  if (!inp || inp.dataset.answered === '1') return;
  inp.dataset.answered = '1';
  const correct = gGetCorrect();
  const userNorm = normalize(inp.value);
  const correctFull = normalize(correct);
  const correctShort = normalize(correct.replace(new RegExp('^' + PRONOUNS[gCurrentPronounIdx] + '\\s+'), ''));
  const isCorrect = userNorm === correctFull || userNorm === correctShort;
  inp.className = 'answer-input ' + (isCorrect ? 'correct' : 'wrong');
  document.getElementById('gcard-context').style.visibility = 'visible';
  inp.blur();
  speak(correct);
  const stats = loadStats();
  const key = gCurrentVerb.id;
  if (!stats[key]) stats[key] = {total:0,correct:0};
  stats[key].total++;
  if (isCorrect) stats[key].correct++;
  const tkey = 'tense_' + gCurrentTense;
  if (!stats[tkey]) stats[tkey] = {total:0,correct:0};
  stats[tkey].total++; if (isCorrect) stats[tkey].correct++;
  saveStats(stats);
  if (isCorrect) {
    gGood++; gStreak++;
    document.getElementById('gfeedback-row').innerHTML = `<div class="feedback-msg correct">✓ Верно!</div><button class="btn btn-primary" style="padding:8px 20px;font-size:0.85rem" onclick="gNextCard()">Следующий →</button>`;
  } else {
    gBad++; gStreak = 0;
    document.getElementById('gfeedback-row').innerHTML = `<div class="feedback-msg wrong">✗ Правильно: <strong>${correct}</strong></div><button class="btn btn-secondary" style="padding:8px 16px;font-size:0.8rem" onclick="gNextCard()">Следующий</button>`;
  }
  document.getElementById('gscore-good').textContent = gGood;
  document.getElementById('gscore-bad').textContent = gBad;
  document.getElementById('gscore-streak').textContent = gStreak;
}

export function gShowHint() {
  const correct = gGetCorrect();
  const half = correct.substring(0, Math.ceil(correct.length * 0.55));
  document.getElementById('gfeedback-row').innerHTML = `<div style="font-family:'IBM Plex Mono',monospace;font-size:0.9rem;color:var(--warn)">💡 ${half}...</div>`;
  gBad++; gStreak = 0;
  document.getElementById('gscore-bad').textContent = gBad;
  document.getElementById('gscore-streak').textContent = gStreak;
}
