// ════════════════════════════════════════════════
// home.js — reader-first главный экран
// ════════════════════════════════════════════════

export async function renderHome() {
  const $ = (id) => document.getElementById(id);
  const setText = (id, val) => { const el = $(id); if (el) el.textContent = val; };
  const escape = (s) => String(s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  const username = localStorage.getItem('an2_current_profile') || localStorage.getItem('profileName') || '—';
  setText('home-username', username);
  try {
    setText('home-date', new Date().toLocaleDateString('ru-RU', { weekday:'long', day:'numeric', month:'long' }));
  } catch { setText('home-date', 'сегодня'); }

  let books = [];
  try { books = JSON.parse(localStorage.getItem('an2_reader_books_v1') || '[]') || []; } catch { books = []; }
  if (!Array.isArray(books)) books = [];

  const bookProgress = (book) => {
    const chapters = book?.chapters || [];
    const total = chapters.reduce((n, ch) => n + (ch.paragraphs?.length || 0), 0) || 1;
    let done = 0;
    const ci = book.currentChapter || 0;
    for (let i = 0; i < Math.min(ci, chapters.length); i++) done += chapters[i].paragraphs?.length || 0;
    done += Math.min(book.currentParagraph || 0, chapters[ci]?.paragraphs?.length || 0);
    return Math.max(0, Math.min(100, Math.round(done / total * 100)));
  };

  const recent = [...books].sort((a,b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0))[0];
  const continueCard = $('home-reader-continue');
  if (continueCard) {
    if (recent) {
      const pct = bookProgress(recent);
      continueCard.innerHTML = `
        <div class="home-section-label">продолжить</div>
        <button onclick="showScreen('reader'); setTimeout(()=>readerOpenBook('${escape(recent.id)}'), 120)" class="home-continue-card">
          <div>
            <b>${escape(recent.title || 'Текст')}</b>
            <small>${escape(recent.author || recent.level || 'французский input')}</small>
          </div>
          <div class="home-continue-progress"><span style="width:${pct}%"></span></div>
          <em>${pct}%</em>
        </button>`;
      setText('home-active-progress', pct + '%');
    } else {
      continueCard.innerHTML = `
        <div class="home-section-label">начать</div>
        <button onclick="showScreen('reader'); setTimeout(()=>showReaderImportModal(),120)" class="home-continue-card empty">
          <div><b>Добавить первый текст</b><small>вставка, TXT или EPUB</small></div><em>＋</em>
        </button>`;
      setText('home-active-progress', '0%');
    }
  }

  setText('home-books-count', books.length);

  let wordState = {};
  try { wordState = JSON.parse(localStorage.getItem('an2_reader_word_state_v1') || '{}') || {}; } catch { wordState = {}; }
  const words = Object.values(wordState).filter(w => w && w.word);
  setText('home-viewed-words', words.filter(w => (w.clicked || 0) > 0).length);
  setText('home-saved-words', words.filter(w => w.saved).length);

  const recentWords = $('home-recent-reader-words');
  if (recentWords) {
    const rows = words
      .sort((a,b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0))
      .slice(0, 12);
    if (!rows.length) {
      recentWords.innerHTML = `<div class="home-empty-note">Пока нет слов из чтения. Открой текст и нажимай только те слова, которые мешают пониманию.</div>`;
    } else {
      recentWords.innerHTML = rows.map(w => {
        const status = w.saved ? 'в словаре' : w.known ? 'изучено' : (w.clicked ? 'просмотрено' : `видел ${w.seen || 1}`);
        return `<span class="home-word-chip ${w.saved?'saved':''}"><b>${escape(w.word)}</b><small>${escape(status)}</small></span>`;
      }).join('');
    }
  }
}
