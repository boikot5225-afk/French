// ════════════════════════════════════════════════
// dict.js — словарь глаголов
// ════════════════════════════════════════════════

import { PRONOUNS, TENSE_NAMES, BADGE_CLASS } from './state.js';
import { loadStats, isInLearnLater } from './storage.js';
import { loadSRS } from './srs.js';
import { sbUser } from './supabase.js';
import { ADMIN_USERNAME } from './supabase.js';
import { buildExample } from './trainer.js';
import { speak } from './tts.js';

export let dictSelected = null;
export let vpGroupFilter = 'all';
export let selectedVerbIds = new Set();

const DICT_TENSES = [
  ['present','Présent — настоящее'],
  ['passe','Passé composé — прошедшее завершённое'],
  ['imparfait','Imparfait — прошедшее незавершённое'],
  ['futur','Futur simple — будущее'],
  ['plus_que_parfait','Plus-que-parfait — предпрошедшее'],
  ['conditionnel','Conditionnel présent — условное'],
  ['subjonctif','Subjonctif présent — сослагательное'],
  ['imperatif','Impératif — повелительное'],
  ['passe_simple','Passé simple — книжное прошедшее']
];

function verbHasTense(v, tense) {
  if (!tense || tense === 'all') return true;
  if (tense === 'passe') return !!v.pp;
  return Array.isArray(v.conj?.[tense]) && v.conj[tense].length > 0;
}


export function setDictLayout() {
  const isMobile = window.innerWidth < 700;
  const listWrap = document.getElementById('dict-list-wrap');
  const detailWrap = document.getElementById('dict-detail-wrap');
  if (!listWrap || !detailWrap) return;
  if (!isMobile) {
    const container = listWrap.parentElement;
    container.style.display = 'grid';
    container.style.gridTemplateColumns = '280px 1fr';
    container.style.gap = '20px';
    container.style.alignItems = 'start';
    listWrap.style.display = 'block';
    if (dictSelected) detailWrap.style.display = 'block';
  } else {
    const container = listWrap.parentElement;
    container.style.display = 'block';
  }
}

export async function renderDict(VERBS, VERBS_LOADED, loadVerbsFromCloud) {
  if (!VERBS_LOADED) await loadVerbsFromCloud();
  const query = (document.getElementById('dict-search')?.value || '').toLowerCase().trim();
  const group = document.getElementById('dict-group')?.value || 'all';
  const sort  = document.getElementById('dict-sort')?.value || 'alpha';
  const tense = document.getElementById('dict-tense')?.value || 'all';

  let verbs = VERBS.filter(v => v.conj);
  if (group !== 'all') verbs = verbs.filter(v => v.group === group);
  if (tense !== 'all') verbs = verbs.filter(v => verbHasTense(v, tense));
  if (query) {
    verbs = verbs.filter(v =>
      String(v.inf || '').toLowerCase().includes(query) ||
      String(v.meaning || '').toLowerCase().includes(query) ||
      String(v.group || v.group_name || '').toLowerCase() === query.replace('-','') ||
      (v.conj && Object.values(v.conj).some(tenseForms =>
        Array.isArray(tenseForms) && tenseForms.some(form => form && form.toLowerCase().includes(query))
      ))
    );
  }
  if (sort === 'alpha') verbs = [...verbs].sort((a,b) => String(a.inf || '').localeCompare(String(b.inf || ''), 'fr'));
  if (sort === 'group') verbs = [...verbs].sort((a,b) => {
    const order = {er:0,ir:1,re:2,irr:3};
    const ag = a.group || a.group_name || '';
    const bg = b.group || b.group_name || '';
    return (order[ag]||0) - (order[bg]||0) || String(a.inf || '').localeCompare(String(b.inf || ''),'fr');
  });

  document.getElementById('dict-count').textContent = `${verbs.length} глагол${verbs.length===1?'':verbs.length<5?'а':'ов'}`;
  setDictLayout();

  const list = document.getElementById('dict-list');
  if (verbs.length === 0) {
    list.innerHTML = '<div style="padding:24px;color:var(--text-muted);font-size:0.85rem;text-align:center">Ничего не найдено</div>';
    return;
  }

  list.innerHTML = verbs.map(v => {
    const active = dictSelected === v.id ? 'background:var(--surface2);border-left:3px solid var(--accent);' : 'border-left:3px solid transparent;';
    const g = v.group || v.group_name || 'irr';
    const badgeColor = {er:'var(--er)',ir:'var(--ir)',re:'var(--re)',irr:'var(--irr)',ref:'var(--ref)'}[g] || 'var(--text-muted)';
    const badgeBg    = {er:'var(--er-dim)',ir:'var(--ir-dim)',re:'var(--re-dim)',irr:'var(--irr-dim)',ref:'var(--ref-dim)'}[g] || 'var(--surface2)';
    return `<div onclick="selectDictVerb('${v.id}')" style="padding:12px 16px;cursor:pointer;border-bottom:1px solid var(--border);${active}transition:background 0.15s;display:flex;align-items:center;gap:10px;"
      onmouseover="if('${v.id}'!==dictSelected)this.style.background='var(--surface2)'" onmouseout="if('${v.id}'!==dictSelected)this.style.background=''">
      <span style="font-style:italic;font-size:0.95rem;flex:1;color:var(--text)">${v.inf || v.id || '—'}</span>
      <span style="font-size:0.7rem;color:var(--text-muted)">${v.meaning || ''}</span>
      <span style="font-size:0.6rem;padding:2px 6px;border-radius:10px;background:${badgeBg};color:${badgeColor};font-family:'IBM Plex Mono',monospace;white-space:nowrap">${String(g).toUpperCase()}</span>
    </div>`;
  }).join('');

  if (dictSelected && !verbs.find(v => v.id === dictSelected)) {
    document.getElementById('dict-detail').innerHTML = '<div style="color:var(--text-muted);font-size:0.9rem;text-align:center;padding:40px 0;">← Выбери глагол из списка</div>';
    dictSelected = null;
  }

  // Don't auto-open any verb — show the list + a prompt instead.
  if (!dictSelected && verbs.length > 0) {
    document.getElementById('dict-detail').innerHTML = '<div style="color:var(--text-muted);font-size:0.9rem;text-align:center;padding:40px 0;">← Выбери глагол из списка</div>';
  } else if (dictSelected && verbs.find(v => v.id === dictSelected)) {
    selectDictVerb(dictSelected, VERBS);
  }
}

export function closeDictDetail() {
  const lw = document.getElementById('dict-list-wrap');
  const dw = document.getElementById('dict-detail-wrap');
  if (lw) lw.style.display = 'block';
  if (dw) dw.style.display = 'none';
  dictSelected = null;
}

export function selectDictVerb(id, VERBS, currentProfile) {
  dictSelected = id;
  const verb = VERBS.find(v => v.id === id);
  if (!verb) return;

  const isMobile = window.innerWidth < 700;
  if (isMobile) {
    document.getElementById('dict-list-wrap').style.display = 'none';
    document.getElementById('dict-detail-wrap').style.display = 'block';
  } else {
    document.getElementById('dict-list-wrap').style.display = 'block';
    document.getElementById('dict-detail-wrap').style.display = 'block';
  }

  const items = document.getElementById('dict-list').querySelectorAll('[onclick]');
  items.forEach(el => {
    const elId = el.getAttribute('onclick').match(/'([^']+)'/)?.[1];
    el.style.background = elId === id ? 'var(--surface2)' : '';
    el.style.borderLeft = elId === id ? '3px solid var(--accent)' : '3px solid transparent';
  });

  const badgeColor = {er:'var(--er)',ir:'var(--ir)',re:'var(--re)',irr:'var(--irr)',ref:'var(--ref)'}[verb.group];
  const badgeBg    = {er:'var(--er-dim)',ir:'var(--ir-dim)',re:'var(--re-dim)',irr:'var(--irr-dim)',ref:'var(--ref-dim)'}[verb.group];
  const groupLabel = {er:'1-я группа (-ER)',ir:'2-я группа (-IR)',re:'3-я группа (-RE)',irr:'Неправильный глагол',ref:'Возвратный глагол'}[verb.group];

  const AUX_AVOIR = ['ai','as','a','avons','avez','ont'];
  const AUX_ETRE  = ['suis','es','est','sommes','êtes','sont'];
  const auxForms  = verb.aux === 'avoir' ? AUX_AVOIR : AUX_ETRE;
  const selectedTense = document.getElementById('dict-tense')?.value || 'all';

  const speakBtn = (txt) => `<button data-speak="${txt.replace(/"/g,'&quot;')}" style="background:none;border:none;cursor:pointer;color:var(--text-dim);font-size:0.8rem;padding:2px 4px;opacity:0.6;transition:opacity 0.2s" onmouseover="this.style.opacity=1" onmouseout="this.style.opacity=0.6" onclick="speak(this.dataset.speak)">🔊</button>`;

  function conjTable(tense, label, color) {
    if (tense === 'passe') {
      const rows = PRONOUNS.map((p,i) => {
        const form = auxForms[i] + ' ' + verb.pp;
        const full = p + ' ' + form;
        const ex = buildExample(verb,tense,i);
        return `<div style="display:flex;align-items:center;gap:10px;padding:9px 12px;border-bottom:1px solid rgba(120,90,60,0.12)">
          <span style="font-family:'IBM Plex Mono',monospace;font-size:0.74rem;color:var(--accent);min-width:54px;flex-shrink:0">${p}</span>
          <span style="font-family:'Playfair Display',serif;font-style:italic;font-size:1rem;color:var(--text);flex-shrink:0">${form}</span>
          ${speakBtn(full)}
          <span style="font-size:0.76rem;color:var(--text-dim);font-style:italic;margin-left:auto;text-align:right">${ex}</span>
          ${ex ? speakBtn(ex) : ''}
        </div>`;
      }).join('');
      return tableWrap(label, color, rows);
    }
    if (!verb.conj[tense]) return '';
    const rows = PRONOUNS.map((p,i) => {
      const form = verb.conj[tense][i];
      const full = p + ' ' + form;
      const ex = buildExample(verb,tense,i);
      return `<div style="display:flex;align-items:center;gap:10px;padding:9px 12px;border-bottom:1px solid rgba(120,90,60,0.12)">
        <span style="font-family:'IBM Plex Mono',monospace;font-size:0.74rem;color:var(--accent);min-width:54px;flex-shrink:0">${p}</span>
        <span style="font-family:'Playfair Display',serif;font-style:italic;font-size:1rem;color:var(--text);flex-shrink:0">${form}</span>
        ${speakBtn(full)}
        <span style="font-size:0.76rem;color:var(--text-dim);font-style:italic;margin-left:auto;text-align:right">${ex}</span>
        ${ex ? speakBtn(ex) : ''}
      </div>`;
    }).join('');
    return tableWrap(label, color, rows);
  }

  function tableWrap(label, color, rows) {
    return `<div style="margin-bottom:20px;">
      <div style="font-family:'Playfair Display',serif;font-size:0.95rem;color:${color};margin-bottom:8px;font-weight:600;letter-spacing:0.02em">${label}</div>
      <div style="background:var(--surface2);border:1px solid var(--border);border-radius:10px;overflow:hidden">${rows}</div>
    </div>`;
  }


  const allConjBlocks = [
    ['present','Présent — настоящее','var(--er)'],
    ['passe','Passé composé — прошедшее завершённое','var(--ir)'],
    ['imparfait','Imparfait — прошедшее незавершённое','var(--re)'],
    ['futur','Futur simple — будущее','var(--irr)'],
    ['plus_que_parfait','Plus-que-parfait — предпрошедшее','var(--accent)'],
    ['conditionnel','Conditionnel présent — условное','var(--warn)'],
    ['subjonctif','Subjonctif présent — сослагательное','var(--blue)'],
    ['imperatif','Impératif — повелительное','var(--good)'],
    ['passe_simple','Passé simple — книжное прошедшее','var(--text-muted)']
  ].filter(([key]) => selectedTense === 'all' || selectedTense === key)
   .map(([key,label,color]) => conjTable(key,label,color))
   .filter(Boolean)
   .join('');

  const tenseFilterNote = selectedTense !== 'all'
    ? `<div style="font-size:0.78rem;color:var(--text-muted);margin-bottom:12px">Фильтр времени: <b>${(DICT_TENSES.find(([k]) => k === selectedTense)?.[1] || selectedTense)}</b></div>`
    : '';

  const stats = loadStats();
  const s = stats[verb.id];
  const pct = s && s.total > 0 ? Math.round(s.correct/s.total*100) : null;
  const pctColor = pct === null ? 'var(--text-muted)' : pct >= 75 ? 'var(--good)' : pct >= 50 ? 'var(--warn)' : 'var(--bad)';
  const pctLabel = pct !== null
    ? `<span style="font-family:'IBM Plex Mono',monospace;font-size:0.82rem;color:${pctColor}">${pct}% верно (${s.total} попыток)</span>`
    : '<span style="font-size:0.78rem;color:var(--text-muted)">ещё не тренировался</span>';

  const srsCard = loadSRS()[verb.id];
  let srsLabel = '';
  if (!srsCard) {
    srsLabel = '<span style="font-size:0.78rem;color:var(--text-dim)">⚪ Новое слово</span>';
  } else if (srsCard.interval >= 14) {
    srsLabel = `<span style="font-size:0.78rem;color:var(--good)">🟢 Изучено · интервал ${srsCard.interval} дн.</span>`;
  } else if (srsCard.interval >= 3) {
    srsLabel = `<span style="font-size:0.78rem;color:var(--warn)">🟡 В процессе · интервал ${srsCard.interval} дн.</span>`;
  } else {
    srsLabel = `<span style="font-size:0.78rem;color:var(--text-muted)">🔵 Начато · повтор ${srsCard.dueDate || 'скоро'}</span>`;
  }

  const isAdmin = currentProfile?.toLowerCase() === ADMIN_USERNAME;
  document.getElementById('dict-detail').innerHTML = `
    <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px;">
      <div>
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px;">
          <div style="font-family:'Playfair Display',serif;font-style:italic;font-size:2.2rem;color:var(--text);line-height:1">${verb.inf}</div>
          <button onclick="speak(this.dataset.speak)" data-speak="${verb.inf.replace(/'/g,"\\'")}\" title="Произнести" style="background:none;border:1px solid var(--border);border-radius:50%;width:32px;height:32px;cursor:pointer;color:var(--text-muted);font-size:0.85rem;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:all 0.2s" onmouseover="this.style.borderColor='var(--accent)';this.style.color='var(--accent)'" onmouseout="this.style.borderColor='var(--border)';this.style.color='var(--text-muted)'">🔊</button>
        </div>
        <div style="color:var(--text-muted);font-size:0.9rem;margin-bottom:8px">${verb.meaning}</div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
          <span style="font-size:0.68rem;padding:3px 10px;border-radius:12px;background:${badgeBg};color:${badgeColor};font-family:'IBM Plex Mono',monospace;text-transform:uppercase;letter-spacing:0.08em">${groupLabel}</span>
          <span style="font-size:0.78rem;color:var(--text-muted)">pp: <span style="color:var(--accent);font-family:'IBM Plex Mono',monospace">${verb.pp}</span></span>
          <span style="font-size:0.78rem;color:var(--text-muted)">aux: <span style="color:var(--accent);font-family:'IBM Plex Mono',monospace">${verb.aux}</span></span>
        </div>
      </div>
      <div style="text-align:right">
        ${srsLabel}
        <br><span style="display:inline-block;margin-top:4px">${pctLabel}</span>
        <br><div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px;flex-wrap:wrap;">
          <button class="btn btn-secondary" onclick="startTrainerVerb('${verb.id}')" style="padding:7px 14px;font-size:0.75rem">▶ Тренировать</button>
          <button class="btn btn-secondary" onclick="studyOneVerb('${verb.id}');showScreen('study')" style="padding:7px 14px;font-size:0.75rem">🎧 Изучить</button>
          <button class="btn btn-secondary" id="ll-btn-${verb.id}" onclick="toggleLearnLater('${verb.id}')" style="padding:7px 14px;font-size:0.75rem">${isInLearnLater(verb.id) ? '✓ В плане' : '➕ В мой план'}</button>
          ${isAdmin ? `<button class="btn btn-secondary" onclick="window.showAddPhraseModalForVerb && window.showAddPhraseModalForVerb('${verb.id}')" style="padding:7px 14px;font-size:0.75rem">+ Фраза</button>` : ''}
          ${isAdmin ? `<button class="btn btn-secondary" onclick="window.editVerb && window.editVerb('${verb.id}')" style="padding:7px 14px;font-size:0.75rem">✏️ Редактировать</button>` : ''}
          ${verb.custom ? `<button class="btn btn-danger" onclick="deleteCustomVerb('${verb.id}')" style="padding:7px 14px;font-size:0.75rem">🗑 Удалить</button>` : ''}
        </div>
      </div>
    </div>
    <div style="border-top:1px solid var(--border);margin-bottom:20px;"></div>
    ${tenseFilterNote}
    ${allConjBlocks || '<div style="color:var(--text-muted);font-size:0.86rem;padding:20px;text-align:center;background:var(--surface2);border-radius:10px">Для этого времени форм пока нет.</div>'}
    <div id="verb-examples-block"></div>
  `;
  // Fill example phrases from the phrase base (lives in app.js)
  if (window.renderVerbExamples) window.renderVerbExamples(verb.id);
}

export function deleteCustomVerb(id, VERBS, renderDictFn) {
  if (!confirm('Удалить этот глагол?')) return;
  const idx = VERBS.findIndex(v => v.id === id);
  if (idx !== -1) VERBS.splice(idx, 1);
  document.getElementById('dict-detail').innerHTML = '<div style="color:var(--text-muted);font-size:0.9rem;text-align:center;padding:40px 0;">← Выбери глагол из списка</div>';
  dictSelected = null;
  renderDictFn();
}

// ── Verb Picker ──
export function renderVerbPicker(VERBS) {
  const q = (document.getElementById('vp-search')?.value || '').toLowerCase();
  let verbs = VERBS.filter(v => v.conj);
  if (vpGroupFilter !== 'all') verbs = verbs.filter(v => v.group === vpGroupFilter);
  if (q) verbs = verbs.filter(v => v.inf.toLowerCase().includes(q) || v.meaning.toLowerCase().includes(q));
  verbs = [...verbs].sort((a,b) => a.inf.localeCompare(b.inf, 'fr'));

  const badgeColor = {er:'var(--er)',ir:'var(--ir)',re:'var(--re)',irr:'var(--irr)',ref:'var(--ref)'};
  const badgeBg    = {er:'var(--er-dim)',ir:'var(--ir-dim)',re:'var(--re-dim)',irr:'var(--irr-dim)',ref:'var(--ref-dim)'};

  document.getElementById('vp-list').innerHTML = verbs.map(v => `
    <div class="vp-item" onclick="toggleVpVerb('${v.id}',this)">
      <input type="checkbox" ${selectedVerbIds.has(v.id) ? 'checked' : ''} onclick="event.stopPropagation();toggleVpVerb('${v.id}',this.closest('.vp-item'))">
      <span class="vp-inf">${v.inf}</span>
      <span class="vp-meaning">${v.meaning}</span>
      <span class="vp-badge" style="background:${badgeBg[v.group]};color:${badgeColor[v.group]}">${v.group.toUpperCase()}</span>
    </div>`).join('');
  updateVpCount();
}

export function setVpFilter(group, VERBS) {
  vpGroupFilter = group;
  document.querySelectorAll('.vp-filter').forEach(b => {
    b.classList.toggle('active', b.textContent.trim() === ({all:'Все',er:'-ER',ir:'-IR',re:'-RE',irr:'Неправ.',ref:'Возврат.'}[group]));
  });
  renderVerbPicker(VERBS);
}

export function toggleVpVerb(id, row) {
  if (selectedVerbIds.has(id)) selectedVerbIds.delete(id);
  else selectedVerbIds.add(id);
  const cb = row?.querySelector('input[type=checkbox]');
  if (cb) cb.checked = selectedVerbIds.has(id);
  updateVpCount();
}

export function updateVpCount() {
  const n = selectedVerbIds.size;
  document.getElementById('vp-count').textContent = n === 0 ? 'Ничего не выбрано' : `${n} глагол${n===1?'':n<5?'а':'ов'} выбрано`;
}
