// ════════════════════════════════════════════════
// numbers.js — тренажёр чисел
// ════════════════════════════════════════════════

import { normalize } from './utils.js';
import { speak } from './tts.js';

let currentNumber = null;
let nGood = 0, nBad = 0, nStreak = 0;

export function renderNumbersScreen() {
  nGood = 0; nBad = 0; nStreak = 0;
  document.getElementById('nscore-good').textContent = '0';
  document.getElementById('nscore-bad').textContent = '0';
  document.getElementById('nscore-streak').textContent = '0';
  nextNumber();
}

export function nextNumber() {
  const from = parseInt(document.getElementById('num-from').value) || 0;
  const to   = parseInt(document.getElementById('num-to').value) || 100;
  if (from >= to) { alert('Диапазон некорректен'); return; }
  currentNumber = Math.floor(Math.random() * (to - from + 1)) + from;
  document.getElementById('num-display').textContent = currentNumber.toLocaleString('fr-FR');
  document.getElementById('num-input').value = '';
  document.getElementById('num-input').className = 'answer-input';
  document.getElementById('num-input').dataset.answered = '0';
  document.getElementById('num-feedback').innerHTML = '';
  document.getElementById('num-input').focus();
}

export function speakCurrentNumber() {
  if (currentNumber === null) return;
  speak(numberToFrench(currentNumber));
}

export function checkNumber() {
  const inp = document.getElementById('num-input');
  if (!inp || inp.dataset.answered === '1') return;
  inp.dataset.answered = '1';

  const userRaw = inp.value.trim().toLowerCase();
  const correct = numberToFrench(currentNumber);
  const alts = numAlternatives(currentNumber);
  const userNorm = normalize(userRaw);
  const isCorrect = [...alts].some(a => normalize(a) === userNorm);

  inp.className = 'answer-input ' + (isCorrect ? 'correct' : 'wrong');
  speak(correct);

  const fb = document.getElementById('num-feedback');
  if (isCorrect) {
    nGood++; nStreak++;
    fb.innerHTML = `<div class="feedback-msg correct">✓ Верно!</div><button class="btn btn-primary" style="padding:8px 20px;font-size:0.85rem" onclick="nextNumber()">Следующий →</button>`;
  } else {
    nBad++; nStreak = 0;
    const _nb = document.createElement('button');
    _nb.textContent = '🔊';
    _nb.style.cssText = 'background:none;border:1px solid var(--border);border-radius:6px;padding:6px 10px;cursor:pointer;color:var(--text-muted);font-size:0.85rem';
    _nb.onclick = (()=>{const _nc=correct;return ()=>speak(_nc);})();
    const _nf = document.createElement('div');
    _nf.style.cssText = 'display:flex;gap:12px;align-items:center;justify-content:center;flex-wrap:wrap';
    _nf.innerHTML = `<div class="feedback-msg wrong">✗ <strong>${correct}</strong></div><button class="btn btn-secondary" style="padding:8px 16px;font-size:0.8rem" onclick="nextNumber()">Следующий</button>`;
    _nf.appendChild(_nb);
    fb.innerHTML = ''; fb.appendChild(_nf);
  }
  document.getElementById('nscore-good').textContent = nGood;
  document.getElementById('nscore-bad').textContent = nBad;
  document.getElementById('nscore-streak').textContent = nStreak;
}

// ── Number to French ──
function numberToFrench(n) {
  if (n < 0) return 'moins ' + numberToFrench(-n);
  if (n === 0) return 'zéro';
  const ones = ['','un','deux','trois','quatre','cinq','six','sept','huit','neuf',
                 'dix','onze','douze','treize','quatorze','quinze','seize',
                 'dix-sept','dix-huit','dix-neuf'];
  const tens = ['','','vingt','trente','quarante','cinquante','soixante'];
  if (n < 20) return ones[n];
  if (n < 70) {
    const t = Math.floor(n/10), r = n%10;
    if (r === 0) return tens[t];
    if (r === 1) return tens[t] + ' et un';
    return tens[t] + '-' + ones[r];
  }
  if (n < 80) {
    const r = n - 60;
    if (r === 1) return 'soixante et onze';
    return 'soixante-' + ones[r];
  }
  if (n < 100) {
    const r = n - 80;
    if (r === 0) return 'quatre-vingts';
    return 'quatre-vingt-' + ones[r];
  }
  if (n < 200) {
    const r = n - 100;
    if (r === 0) return 'cent';
    return 'cent ' + numberToFrench(r);
  }
  if (n < 1000) {
    const h = Math.floor(n/100), r = n%100;
    const hStr = h === 1 ? 'cent' : ones[h] + ' cent' + (r === 0 && h > 1 ? 's' : '');
    return r === 0 ? hStr : hStr + ' ' + numberToFrench(r);
  }
  if (n < 2000) {
    const r = n - 1000;
    return r === 0 ? 'mille' : 'mille ' + numberToFrench(r);
  }
  const th = Math.floor(n/1000), r = n%1000;
  const thStr = ones[th] + ' mille';
  return r === 0 ? thStr : thStr + ' ' + numberToFrench(r);
}

function numAlternatives(n) {
  const main = numberToFrench(n);
  const alts = new Set([main]);
  // Accept without hyphens
  alts.add(main.replace(/-/g, ' '));
  return alts;
}
