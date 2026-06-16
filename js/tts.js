// ════════════════════════════════════════════════
// tts.js — синтез речи и французская клавиатура
// ════════════════════════════════════════════════
import { fetchWithTimeout, SUPABASE_URL, SUPABASE_KEY } from './supabase.js';

let ttsVoice = null;
let ttsAudio = null;
let ttsToken = 0;

// Edge Function endpoint for server-side TTS (OpenRouter Kokoro).
// Works everywhere including Android WebView, unlike Web Speech.
const TTS_FN_URL = `${SUPABASE_URL}/functions/v1/tts`;
// Simple in-memory cache of object URLs for this session (cloud caches too)
const ttsMemCache = new Map();

// Shared AudioContext (created lazily, resumed on each play — mobile needs this)
let ttsCtx = null;
let ttsCurrentSource = null;

function normalizeFrenchSpeechText(text) {
  let t = String(text || '').trim();
  if (!t) return '';
  // UI sometimes shows combined pronouns. A TTS engine reads "il/elle" as junk,
  // so for sound we pick a single natural variant.
  t = t
    .replace(/\bils\s*\/\s*elles\b/gi, 'ils')
    .replace(/\bil\s*\/\s*elle\b/gi, 'il')
    .replace(/\belles\s*\/\s*ils\b/gi, 'ils')
    .replace(/\belle\s*\/\s*il\b/gi, 'il');
  // In tables the app can build "je ai" / "je ai eu". French sound needs j'.
  t = t.replace(/\bje\s+([aeiouhàâäéèêëîïôöùûü])/gi, "j'$1");
  // For variants like allé/allée or allés/allées, speak the first option.
  t = t.replace(/([^\s\/]+)\/([^\s]+)/g, '$1');
  t = t.replace(/\s+/g, ' ').trim();
  if (t && !/[.!?…]$/.test(t)) t += '.';
  return t;
}

async function speakViaOpenRouter(text, onFail) {
  text = normalizeFrenchSpeechText(text);
  if (!text) return;
  // Stop anything currently playing
  if (ttsCurrentSource) { try { ttsCurrentSource.stop(); } catch (e) {} ttsCurrentSource = null; }
  if (ttsAudio) { try { ttsAudio.pause(); } catch (e) {} ttsAudio = null; }
  const token = ++ttsToken;

  // Step 1: get the audio bytes (cache an ArrayBuffer per text this session)
  let buf = ttsMemCache.get(text);
  try {
    if (!buf) {
      const resp = await fetchWithTimeout(TTS_FN_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'apikey': SUPABASE_KEY,
        },
        body: JSON.stringify({ text }),
      }, 20000);
      if (!resp.ok) throw new Error('tts http ' + resp.status);
      buf = await resp.arrayBuffer();
      if (!buf || buf.byteLength < 200) throw new Error('tts empty audio');
      ttsMemCache.set(text, buf);
    }
  } catch (e) {
    if (onFail) onFail();
    return;
  }
  if (ttsToken !== token) return;

  // Step 2: play via Web Audio API (more reliable than <audio>+blob on mobile)
  try {
    if (!ttsCtx) ttsCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (ttsCtx.state === 'suspended') { try { await ttsCtx.resume(); } catch (e) {} }
    // decodeAudioData needs its own copy (it detaches the buffer)
    const audioData = await ttsCtx.decodeAudioData(buf.slice(0));
    if (ttsToken !== token) return;
    const source = ttsCtx.createBufferSource();
    source.buffer = audioData;
    source.connect(ttsCtx.destination);
    ttsCurrentSource = source;
    source.start(0);
  } catch (e) {
    // Web Audio failed (decode/context) — fall back to <audio> element
    try {
      const blob = new Blob([buf], { type: 'audio/mpeg' });
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.volume = 1;
      ttsAudio = audio;
      audio.play().catch(() => {});
    } catch (e2) {}
  }
}

export let frKbEnabled = localStorage.getItem('frKbEnabled') !== '0';
export function isFrKbEnabled() { return frKbEnabled; }
export let autoSpeak   = localStorage.getItem('autoSpeak') === '1';
let frKbShift = false;
let frKbBlurTimer = null;
let frKbActiveId = null;

export const KB_INPUT_MAP = {
  main:'answer-input', grp:'ganswer-input', ph:'ph-input',
  num:'num-input', learn:'check-input', 'phrase-learn':'phrase-input'
};

// ── Speech ──
function pickFrenchVoice() {
  const voices = (window.speechSynthesis?.getVoices()) || [];
  return voices.find(v => v.lang === 'fr-FR' && v.localService)
      || voices.find(v => v.lang === 'fr-FR')
      || voices.find(v => v.lang.startsWith('fr-'))
      || voices.find(v => v.lang.startsWith('fr'))
      || null;
}

function hasBrowserFrenchVoice() {
  return !!pickFrenchVoice();
}

export function initSpeech() {
  if (!window.speechSynthesis) return;
  ttsVoice = pickFrenchVoice();
  speechSynthesis.onvoiceschanged = () => { ttsVoice = pickFrenchVoice(); };
  setTimeout(() => { ttsVoice = ttsVoice || pickFrenchVoice(); }, 500);
  setTimeout(() => { ttsVoice = ttsVoice || pickFrenchVoice(); }, 1500);
}

function speakViaWebSpeech(text) {
  text = normalizeFrenchSpeechText(text);
  if (!text || !window.speechSynthesis) return;
  speechSynthesis.cancel();
  const utt = new SpeechSynthesisUtterance(text);
  utt.lang = 'fr-FR'; utt.rate = 0.88; utt.pitch = 1;
  if (ttsVoice) utt.voice = ttsVoice;
  speechSynthesis.speak(utt);
}

function speakViaGoogleTTS(text, onFail) {
  text = normalizeFrenchSpeechText(text);
  if (!text) return;
  if (ttsAudio) { ttsAudio.pause(); ttsAudio = null; }
  const token = ++ttsToken;
  const urls = [
    'https://translate.google.com/translate_tts?ie=UTF-8&q=' + encodeURIComponent(text) + '&tl=fr&client=tw-ob',
    'https://translate.googleapis.com/translate_tts?ie=UTF-8&q=' + encodeURIComponent(text) + '&tl=fr&client=gtx',
  ];
  function tryUrl(i) {
    if (i >= urls.length) { if (onFail) onFail(); return; }
    const audio = new Audio(urls[i]);
    audio.volume = 1;
    ttsAudio = audio;
    audio.play().catch(() => { if (ttsToken === token) tryUrl(i + 1); });
    audio.addEventListener('loadedmetadata', () => {
      if (audio.duration < 0.3 && ttsToken === token) { audio.pause(); tryUrl(i + 1); }
    });
  }
  tryUrl(0);
}

export function speak(text) {
  text = normalizeFrenchSpeechText(text);
  if (!text) return;
  const engine = localStorage.getItem('ttsEngine') || 'auto';

  // Manual overrides kept for debugging only
  if (engine === 'webspeech') { speakViaWebSpeech(text); return; }
  if (engine === 'google') { speakViaGoogleTTS(text, () => {}); return; }
  if (engine === 'server') {
    speakViaOpenRouter(text, () => {
      console.warn('[tts] Server TTS unavailable, fallback to browser:', text);
      speakViaWebSpeech(text);
    });
    return;
  }

  // AUTO mode: fast local voice first. Server voice is prettier, but laggy.
  if (window.speechSynthesis && hasBrowserFrenchVoice()) {
    speakViaWebSpeech(text);
    return;
  }

  speakViaOpenRouter(text, () => {
    console.warn('[tts] Server TTS unavailable, fallback to browser/google:', text);
    if (window.speechSynthesis) speakViaWebSpeech(text);
    else speakViaGoogleTTS(text, () => {});
  });
}

export function toggleAutoSpeak() {
  autoSpeak = !autoSpeak;
  localStorage.setItem('autoSpeak', autoSpeak ? '1' : '0');
  const btn = document.getElementById('auto-speak-btn');
  if (btn) {
    btn.textContent = autoSpeak ? 'Вкл' : 'Выкл';
    btn.style.background = autoSpeak ? 'var(--accent)' : 'var(--surface2)';
    btn.style.color = autoSpeak ? '#f5ecd8' : 'var(--text-muted)';
  }
}

export function setTTSEngine(engine) {
  localStorage.setItem('ttsEngine', engine);
  document.querySelectorAll('.tts-engine-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.engine === engine);
  });
}

export function initTTSEngineUI() {
  const engine = localStorage.getItem('ttsEngine') || 'auto';
  document.querySelectorAll('.tts-engine-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.engine === engine);
  });
  const btn = document.getElementById('auto-speak-btn');
  if (btn) {
    btn.textContent = autoSpeak ? 'Вкл' : 'Выкл';
    btn.style.background = autoSpeak ? 'var(--accent)' : 'var(--surface2)';
    btn.style.color = autoSpeak ? '#f5ecd8' : 'var(--text-muted)';
  }
}

// ── French Keyboard ──
export function applyKbMode() {
  const inputs = ['answer-input','ganswer-input','ph-input','num-input','check-input','phrase-input'];
  inputs.forEach(id => {
    const inp = document.getElementById(id);
    if (inp) inp.inputMode = frKbEnabled ? 'none' : 'text';
  });
  ['main','grp','ph','num'].forEach(kbId => {
    const btn = document.getElementById('kb-toggle-' + kbId);
    if (!btn) return;
    btn.textContent = frKbEnabled ? '⌨ Своя клавиатура' : '🇫🇷 Фр. клавиатура';
    btn.classList.toggle('active', !frKbEnabled);
  });
}

export function toggleKbMode(kbId) {
  frKbEnabled = !frKbEnabled;
  localStorage.setItem('frKbEnabled', frKbEnabled ? '1' : '0');
  applyKbMode();
  if (frKbEnabled) {
    showFrKb(kbId);
  } else {
    ['main','grp','ph','num','learn'].forEach(id => hideFrKb(id));
    const inp = document.getElementById(KB_INPUT_MAP[kbId]);
    if (inp) { inp.inputMode = 'text'; inp.focus(); }
  }
}

export function insertFrChar(kbId, ch) {
  const inp = document.getElementById(KB_INPUT_MAP[kbId]); if (!inp) return;
  const s = inp.selectionStart ?? inp.value.length, e = inp.selectionEnd ?? inp.value.length;
  inp.value = inp.value.slice(0,s) + ch + inp.value.slice(e);
  inp.selectionStart = inp.selectionEnd = s + ch.length;
  inp.focus({preventScroll:true});
}

export function frBackspace(kbId) {
  const inp = document.getElementById(KB_INPUT_MAP[kbId]); if (!inp) return;
  const s = inp.selectionStart ?? inp.value.length, e = inp.selectionEnd ?? inp.value.length;
  if (s !== e) { inp.value = inp.value.slice(0,s) + inp.value.slice(e); inp.selectionStart = inp.selectionEnd = s; }
  else if (s > 0) { inp.value = inp.value.slice(0,s-1) + inp.value.slice(s); inp.selectionStart = inp.selectionEnd = s-1; }
  inp.focus({preventScroll:true});
}

export function frEnter(kbId) {
  if (kbId === 'main') window.checkAnswer?.();
  else if (kbId === 'grp') window.gCheckAnswer?.();
  else if (kbId === 'ph')  window.checkPhrase?.();
  else if (kbId === 'num') window.checkNumber?.();
}

export function frToggleShift(kbId) {
  frKbShift = !frKbShift;
  const kb = document.getElementById('fr-kb-' + kbId); if (!kb) return;
  const sb = document.getElementById('fr-shift-' + kbId);
  if (sb) { sb.style.background = frKbShift?'var(--accent)':''; sb.style.color = frKbShift?'#0e0e10':''; sb.textContent = frKbShift?'⬆':'⇧'; }
  kb.querySelectorAll('.fr-key:not(.fr-key-action)').forEach(btn => {
    const ch = btn.dataset.ch; if (!ch || ch.length !== 1) return;
    btn.dataset.ch = frKbShift ? ch.toUpperCase() : ch.toLowerCase();
    btn.textContent = btn.dataset.ch;
  });
}

export function showFrKb(kbId) {
  if (!frKbEnabled) return;
  if (frKbBlurTimer) { clearTimeout(frKbBlurTimer); frKbBlurTimer = null; }
  Object.keys(KB_INPUT_MAP).forEach(id => {
    if (id !== kbId) {
      const kb = document.getElementById('fr-kb-' + id);
      if (kb) { kb.style.display = 'none'; kb.classList.remove('kb-visible'); }
    }
  });
  frKbActiveId = kbId;
  buildFrKb(kbId);
  const kb = document.getElementById('fr-kb-' + kbId);
  if (kb) {
    kb.classList.add('kb-visible');
    kb.style.setProperty('display', 'block', 'important');
  }
  const inp = document.getElementById(KB_INPUT_MAP[kbId]);
  if (inp) { inp.setAttribute('inputmode','none'); inp.setAttribute('readonly','readonly'); }
  const indicatorMap = {'learn':'learn-kb-indicator','phrase-learn':'phrase-kb-indicator'};
  if (indicatorMap[kbId]) {
    const ind = document.getElementById(indicatorMap[kbId]);
    if (ind) ind.style.display = 'block';
  }
  const screenId = {main:'trainer',grp:'groups',ph:'phrases',num:'numbers',learn:'study','phrase-learn':'study'}[kbId];
  if (screenId) document.getElementById('screen-' + screenId)?.classList.add('kb-active');
  // Scroll so the input field stays visible above the in-flow keyboard
  setTimeout(() => {
    const target = document.getElementById(KB_INPUT_MAP[kbId]);
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, 100);
}

export function hideFrKb(kbId) {
  const kb = document.getElementById('fr-kb-' + kbId);
  if (kb) { kb.style.display = 'none'; kb.classList.remove('kb-visible'); }
  const inp = document.getElementById(KB_INPUT_MAP[kbId]);
  if (inp) { inp.removeAttribute('readonly'); inp.setAttribute('inputmode','text'); }
  const indicatorMap = {'learn':'learn-kb-indicator','phrase-learn':'phrase-kb-indicator'};
  if (indicatorMap[kbId]) {
    const ind = document.getElementById(indicatorMap[kbId]);
    if (ind) ind.style.display = 'none';
  }
  const screenId = {main:'trainer',grp:'groups',ph:'phrases',num:'numbers',learn:'study','phrase-learn':'study'}[kbId];
  if (screenId) document.getElementById('screen-' + screenId)?.classList.remove('kb-active');
}

// Fast tap: fire on touchstart (no 300ms click delay), fall back to click on desktop
function fastTap(btn, handler) {
  let touched = false;
  btn.addEventListener('touchstart', (e) => {
    touched = true;
    e.preventDefault();
    handler();
  }, { passive: false });
  btn.addEventListener('click', () => {
    if (touched) { touched = false; return; } // already handled by touch
    handler();
  });
}

function buildFrKb(kbId) {
  const kb = document.getElementById('fr-kb-' + kbId);
  if (!kb || kb.dataset.built === '1') return;
  kb.dataset.built = '1';

  const rows = [
    ['a','z','e','r','t','y','u','i','o','p'],
    ['q','s','d','f','g','h','j','k','l','m'],
    ['SHIFT','w','x','c','v','b','n',"'",'BACK'],
    ['SPACE','ENTER']
  ];
  const accents = {
    a:['à','â','ä'], e:['é','è','ê','ë'], i:['î','ï'],
    o:['ô','ö'], u:['ù','û','ü'], c:['ç']
  };

  rows.forEach(row => {
    const rowDiv = document.createElement('div');
    rowDiv.style.cssText = 'display:flex;justify-content:center;gap:4px;margin-bottom:4px;';

    row.forEach(key => {
      const btn = document.createElement('button');
      btn.type = 'button';

      if (key === 'SHIFT') {
        btn.id = 'fr-shift-' + kbId;
        btn.className = 'fr-key fr-key-action fr-key-wide fr-key-shift';
        btn.textContent = '⇧';
        fastTap(btn, () => frToggleShift(kbId));

      } else if (key === 'BACK') {
        btn.className = 'fr-key fr-key-action fr-key-wide';
        btn.textContent = '⌫';
        fastTap(btn, () => frBackspace(kbId));

      } else if (key === 'SPACE') {
        btn.className = 'fr-key fr-key-space';
        btn.textContent = 'espace';
        btn.dataset.ch = ' ';
        fastTap(btn, () => insertFrChar(kbId, ' '));

      } else if (key === 'ENTER') {
        btn.className = 'fr-key fr-key-action fr-key-wide';
        btn.textContent = '↵';
        fastTap(btn, () => frEnter(kbId));

      } else {
        btn.className = 'fr-key';
        btn.dataset.ch = key;
        btn.textContent = key;

        const accList = accents[key];
        if (accList) {
          // Tap = base letter, long-press = cycle accents.
          // Touch and mouse handled separately so mobile doesn't double-fire.
          let pressTimer = null;
          let accIndex = 0;
          let longFired = false;
          const startPress = () => {
            longFired = false;
            pressTimer = setTimeout(() => {
              longFired = true; pressTimer = null;
              insertFrChar(kbId, accList[accIndex % accList.length]);
              accIndex++;
            }, 350);
          };
          const endPress = () => {
            if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
            if (!longFired) insertFrChar(kbId, btn.dataset.ch); // short tap → base letter
          };
          btn.addEventListener('touchstart', e => { e.preventDefault(); startPress(); }, {passive:false});
          btn.addEventListener('touchend', e => { e.preventDefault(); endPress(); }, {passive:false});
          btn.addEventListener('touchcancel', () => { if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; } });
          // Desktop mouse (only fires when no touch)
          btn.addEventListener('mousedown', () => { if (!('ontouchstart' in window)) startPress(); });
          btn.addEventListener('mouseup', () => { if (!('ontouchstart' in window)) endPress(); });
        } else {
          fastTap(btn, () => insertFrChar(kbId, btn.dataset.ch));
        }
      }

      rowDiv.appendChild(btn);
    });
    kb.appendChild(rowDiv);
  });
}
