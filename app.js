/* ==========================================================================
   এসো উর্দু শিখি — Application logic
   No build step, no framework. Everything below is plain ES2017+ JS.
   ========================================================================== */

(() => {
  'use strict';

  /* ------------------------------------------------------------------------
     0. Config & storage keys
     ------------------------------------------------------------------------ */
  const STORAGE_KEY = 'euk_progress_v1';
  const DATA_URL = './data/words.json';

  const DEFAULT_PROGRESS = () => ({
    installDate: todayStr(),
    lastUnlockDayIndex: -1,
    streak: 0,
    library: {},          // { wordId: { firstUnlockedAt, dayIndex } }
    spelling: { attempts: 0, correct: 0 },
    quiz: { attempts: 0, correct: 0 },
    seenHotspots: []
  });

  /* ------------------------------------------------------------------------
     1. Storage helpers (defensive — private browsing / quota can throw)
     ------------------------------------------------------------------------ */
  function loadProgress() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return DEFAULT_PROGRESS();
      const parsed = JSON.parse(raw);
      // merge with defaults so new fields added in future updates don't crash old saves
      return Object.assign(DEFAULT_PROGRESS(), parsed, {
        library: parsed.library || {},
        spelling: Object.assign({ attempts: 0, correct: 0 }, parsed.spelling),
        quiz: Object.assign({ attempts: 0, correct: 0 }, parsed.quiz),
        seenHotspots: parsed.seenHotspots || []
      });
    } catch (e) {
      console.warn('Progress load failed, starting fresh.', e);
      return DEFAULT_PROGRESS();
    }
  }

  function saveProgress() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.progress));
    } catch (e) {
      console.warn('Could not save progress (storage may be full or disabled).', e);
      showToast('অগ্রগতি সংরক্ষণ করা যায়নি — স্টোরেজ পূর্ণ বা বন্ধ থাকতে পারে');
    }
  }

  /* ------------------------------------------------------------------------
     2. Date / day-index utilities (local calendar day, not UTC)
     ------------------------------------------------------------------------ */
  function todayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  function localMidnight(str) {
    const [y, m, d] = str.split('-').map(Number);
    return new Date(y, m - 1, d).getTime();
  }
  function currentDayIndex() {
    const diff = localMidnight(todayStr()) - localMidnight(state.progress.installDate);
    return Math.round(diff / 86400000);
  }

  /* ------------------------------------------------------------------------
     3. Small generic utilities
     ------------------------------------------------------------------------ */
  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  function randomChoice(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  function sampleDistinct(arr, n, excludeFn) {
    const pool = shuffle(arr.filter((x) => !excludeFn(x)));
    return pool.slice(0, n);
  }
  function el(html) {
    const t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }
  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  let toastTimer = null;
  function showToast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.remove('is-shown');
    void t.offsetWidth; // restart animation
    t.classList.add('is-shown');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('is-shown'), 2400);
  }

  /* ------------------------------------------------------------------------
     4. Text-to-speech helper (graceful — many Android WebViews lack an Urdu voice)
     ------------------------------------------------------------------------ */
  let voicesCache = [];
  function primeVoices() {
    if (!('speechSynthesis' in window)) return;
    voicesCache = speechSynthesis.getVoices();
    if (!voicesCache.length) {
      speechSynthesis.addEventListener('voiceschanged', () => {
        voicesCache = speechSynthesis.getVoices();
      }, { once: true });
    }
  }
  function speakUrdu(text) {
    if (!('speechSynthesis' in window)) {
      showToast('এই ব্রাউজারে উচ্চারণ শোনার সুবিধা নেই');
      return;
    }
    const voices = voicesCache.length ? voicesCache : speechSynthesis.getVoices();
    const urVoice = voices.find((v) => v.lang && v.lang.toLowerCase().startsWith('ur'));
    const arVoice = voices.find((v) => v.lang && v.lang.toLowerCase().startsWith('ar'));
    const utter = new SpeechSynthesisUtterance(text);
    utter.voice = urVoice || arVoice || null;
    utter.lang = (urVoice && urVoice.lang) || (arVoice && arVoice.lang) || 'ar-SA';
    utter.rate = 0.82;
    speechSynthesis.cancel();
    speechSynthesis.speak(utter);
    if (!urVoice && !arVoice) {
      showToast('উর্দু কণ্ঠস্বর পাওয়া যায়নি — কাছাকাছি উচ্চারণ শোনানো হচ্ছে');
    }
  }

  /* ------------------------------------------------------------------------
     5. Global state
     ------------------------------------------------------------------------ */
  const state = {
    progress: loadProgress(),
    data: null,       // loaded JSON
    words: [],         // data.words
    view: 'home',
    study: { filter: 'all', index: 0, list: [] },
    poetic: { index: 0, list: [] },
    spelling: { current: null, letters: [], tiles: [], answer: [], usedIds: new Set(), pool: [] },
    quiz: { current: null, options: [], answered: false, pool: [] },
    visual: { scene: null }
  };

  /* ------------------------------------------------------------------------
     6. Data access helpers
     ------------------------------------------------------------------------ */
  function findWord(id) { return state.words.find((w) => w.id === id); }
  function wordOfDayForIndex(idx) {
    const seq = state.data.word_of_day_sequence;
    const i = ((idx % seq.length) + seq.length) % seq.length;
    return findWord(seq[i]);
  }
  function nonProverbWords() { return state.words.filter((w) => w.type !== 'proverb'); }
  function poeticWords() { return state.words.filter((w) => w.is_poetic); }

  /* ------------------------------------------------------------------------
     7. Streak / unlock engine
     ------------------------------------------------------------------------ */
  function isTodayUnlocked() {
    return currentDayIndex() === state.progress.lastUnlockDayIndex;
  }
  function unlockToday() {
    const idx = currentDayIndex();
    if (idx === state.progress.lastUnlockDayIndex) return wordOfDayForIndex(idx);

    state.progress.streak = (state.progress.lastUnlockDayIndex === idx - 1) ? state.progress.streak + 1 : 1;
    state.progress.lastUnlockDayIndex = idx;

    const word = wordOfDayForIndex(idx);
    if (!state.progress.library[word.id]) {
      state.progress.library[word.id] = { firstUnlockedAt: new Date().toISOString(), dayIndex: idx };
    }
    saveProgress();
    return word;
  }

  /* ------------------------------------------------------------------------
     8. Router
     ------------------------------------------------------------------------ */
  const RENDERERS = {
    home: renderHome,
    spelling: renderSpellingView,
    study: renderStudyView,
    poetic: renderPoeticView,
    library: renderLibraryView,
    visual: renderVisualView
  };

  function goto(view) {
    state.view = view;
    document.querySelectorAll('.view').forEach((v) => v.classList.remove('is-active'));
    document.getElementById(`view-${view}`).classList.add('is-active');
    document.querySelectorAll('.nav-item').forEach((b) => b.classList.toggle('is-active', b.dataset.view === view));
    RENDERERS[view]();
    window.scrollTo(0, 0);
  }

  /* ------------------------------------------------------------------------
     9. HOME
     ------------------------------------------------------------------------ */
  function renderHome() {
    const idx = currentDayIndex();
    const unlocked = isTodayUnlocked();
    const word = wordOfDayForIndex(idx);

    document.getElementById('streak-count').textContent = state.progress.streak;
    document.getElementById('streak-flame').classList.toggle('is-active', state.progress.streak > 0);

    const wrap = document.getElementById('wod-wrap');
    wrap.querySelectorAll('.seal, .wod-card').forEach((n) => n.remove());

    if (unlocked) {
      wrap.appendChild(buildWodCard(word, true));
    } else {
      const seal = el(`
        <button class="seal" aria-label="আজকের শব্দ খুলুন">
          🔒
          <span class="seal-hint">খুলতে ট্যাপ করুন</span>
        </button>`);
      seal.addEventListener('click', () => {
        seal.classList.add('is-cracking');
        seal.disabled = true;
        setTimeout(() => {
          const opened = unlockToday();
          seal.remove();
          const card = buildWodCard(opened, false);
          wrap.appendChild(card);
          requestAnimationFrame(() => card.classList.add('is-revealed'));
          document.getElementById('streak-count').textContent = state.progress.streak;
          document.getElementById('streak-flame').classList.add('is-active');
          renderDayStrip();
          showToast(`দিন ${state.progress.streak} — চালিয়ে যাও! 🔥`);
        }, 420);
      });
      wrap.appendChild(seal);
    }

    renderDayStrip();
  }

  function buildWodCard(word, alreadyOpen) {
    const isProverb = word.type === 'proverb';
    const card = el(`
      <div class="wod-card ${alreadyOpen ? 'already-open is-revealed' : ''}">
        <span class="type-tag">${isProverb ? 'প্রবাদ' : 'কাব্যিক শব্দ'}</span>
        <div class="urdu-display">${word.urdu}</div>
        <div class="meaning">${escapeHtml(word.bengali_meaning)}</div>
        ${word.poetic_note ? `<div class="poetic-note bn-serif">${escapeHtml(word.poetic_note)}</div>` : ''}
      </div>
    `);
    return card;
  }

  function renderDayStrip() {
    const stripEl = document.getElementById('day-strip');
    stripEl.innerHTML = '';
    const todayIdx = currentDayIndex();
    const start = Math.max(0, todayIdx - 6);
    const end = todayIdx + 3;
    for (let i = start; i <= end; i++) {
      const chip = document.createElement('div');
      chip.className = 'day-chip';
      chip.textContent = i + 1;
      if (i > todayIdx) {
        chip.classList.add('locked');
        chip.textContent = '';
      } else if (i <= state.progress.lastUnlockDayIndex) {
        chip.classList.add('viewed');
      } else if (i === todayIdx) {
        chip.classList.add('today');
      }
      stripEl.appendChild(chip);
    }
    // keep "today" roughly in view
    requestAnimationFrame(() => { stripEl.scrollLeft = stripEl.scrollWidth; });
  }

  /* ------------------------------------------------------------------------
     10. SPELLING & READING MODE
     ------------------------------------------------------------------------ */
  function renderSpellingView() {
    document.querySelectorAll('.subtab').forEach((b) => {
      b.classList.toggle('is-active', b.dataset.subtab === (state.spellingSubtab || 'spell'));
    });
    document.getElementById('spelling-panel').style.display = (state.spellingSubtab || 'spell') === 'spell' ? '' : 'none';
    document.getElementById('quiz-panel').style.display = (state.spellingSubtab || 'spell') === 'quiz' ? '' : 'none';

    if (!state.spelling.current) newSpellingRound();
    else renderSpellingPanel();

    if (!state.quiz.current) newQuizRound();
    else renderQuizPanel();
  }

  function newSpellingRound() {
    const pool = nonProverbWords().filter((w) => w.urdu.length >= 2);
    let word = randomChoice(pool);
    if (state.spelling.current && pool.length > 1) {
      while (word.id === state.spelling.current.id) word = randomChoice(pool);
    }
    state.spelling.current = word;
    const letters = Array.from(word.urdu).map((ch, i) => ({ ch, id: i }));
    state.spelling.letters = letters;
    state.spelling.tiles = shuffle(letters);
    state.spelling.answer = [];
    state.spelling.usedIds = new Set();
    renderSpellingPanel();
  }

  function renderSpellingPanel() {
    const panel = document.getElementById('spelling-panel');
    const word = state.spelling.current;
    panel.innerHTML = '';

    const prompt = el(`
      <div class="prompt-card">
        <div class="meaning">${escapeHtml(word.bengali_meaning)}</div>
        <div class="translit-hint">উচ্চারণ: ${escapeHtml(word.bengali_pron)}</div>
        <button class="speak-btn" aria-label="উচ্চারণ শুনুন">🔊</button>
      </div>
    `);
    prompt.querySelector('.speak-btn').addEventListener('click', () => speakUrdu(word.urdu));
    panel.appendChild(prompt);

    const slot = el(`<div class="answer-slot"><span class="urdu"></span></div>`);
    slot.querySelector('.urdu').textContent = state.spelling.answer.join('');
    panel.appendChild(slot);

    const pool = el(`<div class="tile-pool"></div>`);
    state.spelling.tiles.forEach((tile) => {
      const btn = document.createElement('button');
      btn.className = 'tile urdu';
      btn.textContent = tile.ch;
      if (state.spelling.usedIds.has(tile.id)) btn.classList.add('is-used');
      btn.addEventListener('click', () => onTileTap(tile));
      pool.appendChild(btn);
    });
    panel.appendChild(pool);

    const actions = el(`
      <div class="spelling-actions">
        <button class="btn btn-outline" id="spell-clear">মুছে ফেলো</button>
        <button class="btn btn-outline" id="spell-skip">এড়িয়ে যাও</button>
      </div>
    `);
    actions.querySelector('#spell-clear').addEventListener('click', () => {
      state.spelling.answer = [];
      state.spelling.usedIds = new Set();
      renderSpellingPanel();
    });
    actions.querySelector('#spell-skip').addEventListener('click', newSpellingRound);
    panel.appendChild(actions);

    const stats = state.progress.spelling;
    panel.appendChild(el(`
      <div class="score-row">
        <span>সঠিক: <b>${stats.correct}</b></span>
        <span>চেষ্টা: <b>${stats.attempts}</b></span>
      </div>
    `));
  }

  function onTileTap(tile) {
    if (state.spelling.usedIds.has(tile.id)) return;
    state.spelling.usedIds.add(tile.id);
    state.spelling.answer.push(tile.ch);
    renderSpellingPanel();

    if (state.spelling.answer.length === state.spelling.letters.length) {
      const built = state.spelling.answer.join('');
      const correct = built === state.spelling.current.urdu;
      state.progress.spelling.attempts++;
      const slotEl = document.querySelector('.answer-slot');
      if (correct) {
        state.progress.spelling.correct++;
        slotEl.classList.add('is-correct');
        saveProgress();
        setTimeout(newSpellingRound, 900);
      } else {
        slotEl.classList.add('is-wrong');
        saveProgress();
        setTimeout(() => {
          state.spelling.answer = [];
          state.spelling.usedIds = new Set();
          renderSpellingPanel();
        }, 750);
      }
    }
  }

  function newQuizRound() {
    const pool = nonProverbWords();
    const word = randomChoice(pool);
    const distractors = sampleDistinct(pool, 3, (w) => w.id === word.id || w.bengali_meaning === word.bengali_meaning);
    const options = shuffle([word, ...distractors]);
    state.quiz.current = word;
    state.quiz.options = options;
    state.quiz.answered = false;
    renderQuizPanel();
  }

  function renderQuizPanel() {
    const panel = document.getElementById('quiz-panel');
    panel.innerHTML = '';
    const word = state.quiz.current;

    panel.appendChild(el(`
      <div class="quiz-card">
        <div class="urdu-display">${word.urdu}</div>
      </div>
    `));

    const optsWrap = el(`<div class="quiz-options"></div>`);
    state.quiz.options.forEach((opt) => {
      const btn = document.createElement('button');
      btn.className = 'quiz-opt';
      btn.textContent = opt.bengali_meaning;
      btn.disabled = state.quiz.answered;
      if (state.quiz.answered) {
        if (opt.id === word.id) btn.classList.add('correct');
      }
      btn.addEventListener('click', () => onQuizAnswer(opt));
      optsWrap.appendChild(btn);
    });
    panel.appendChild(optsWrap);

    if (state.quiz.answered) {
      const nextBtn = el(`<div class="content-pad"><button class="btn btn-primary" style="width:100%" id="quiz-next">পরবর্তী প্রশ্ন</button></div>`);
      nextBtn.querySelector('#quiz-next').addEventListener('click', newQuizRound);
      panel.appendChild(nextBtn);
    }

    const stats = state.progress.quiz;
    panel.appendChild(el(`
      <div class="score-row">
        <span>সঠিক: <b>${stats.correct}</b></span>
        <span>চেষ্টা: <b>${stats.attempts}</b></span>
      </div>
    `));
  }

  function onQuizAnswer(opt) {
    if (state.quiz.answered) return;
    state.quiz.answered = true;
    state.progress.quiz.attempts++;
    if (opt.id === state.quiz.current.id) state.progress.quiz.correct++;
    saveProgress();
    renderQuizPanel();
    // mark the tapped wrong option after re-render (correct is auto-marked in render)
    if (opt.id !== state.quiz.current.id) {
      const wrongBtn = Array.from(document.querySelectorAll('.quiz-opt')).find((b) => b.textContent === opt.bengali_meaning);
      if (wrongBtn) wrongBtn.classList.add('wrong');
    }
  }

  /* ------------------------------------------------------------------------
     11. STUDY MODE (side-by-side cards)
     ------------------------------------------------------------------------ */
  const STUDY_FILTERS = [
    { key: 'all', label: 'সব' },
    { key: 'everyday', label: 'দৈনন্দিন' },
    { key: 'emotion', label: 'আবেগ' },
    { key: 'poetic', label: 'কাব্যিক' },
    { key: 'proverb', label: 'প্রবাদ' }
  ];

  function studyFilterList(key) {
    if (key === 'all') return state.words;
    if (key === 'poetic') return state.words.filter((w) => w.is_poetic);
    if (key === 'proverb') return state.words.filter((w) => w.type === 'proverb');
    return state.words.filter((w) => (w.tags || []).includes(key));
  }

  function renderStudyView() {
    const bar = document.getElementById('study-filterbar');
    if (!bar.dataset.built) {
      bar.dataset.built = '1';
      STUDY_FILTERS.forEach((f) => {
        const chip = document.createElement('button');
        chip.className = 'chip-filter';
        chip.textContent = f.label;
        chip.dataset.filter = f.key;
        chip.addEventListener('click', () => {
          state.study.filter = f.key;
          state.study.index = 0;
          renderStudyView();
        });
        bar.appendChild(chip);
      });
      document.getElementById('study-prev').addEventListener('click', () => stepStudy(-1));
      document.getElementById('study-next').addEventListener('click', () => stepStudy(1));
    }
    bar.querySelectorAll('.chip-filter').forEach((c) => c.classList.toggle('is-active', c.dataset.filter === state.study.filter));

    state.study.list = studyFilterList(state.study.filter);
    if (state.study.index >= state.study.list.length) state.study.index = 0;
    renderStudyCard();
  }

  function stepStudy(dir) {
    const len = state.study.list.length;
    if (!len) return;
    state.study.index = (state.study.index + dir + len) % len;
    renderStudyCard();
  }

  function renderStudyCard() {
    const stage = document.getElementById('study-stage');
    const list = state.study.list;
    if (!list.length) {
      stage.innerHTML = `<div class="study-card"><span>এই তালিকায় এখনো কোনো শব্দ নেই</span></div>`;
      document.getElementById('study-counter').textContent = '';
      return;
    }
    const word = list[state.study.index];
    stage.innerHTML = '';
    const card = el(`
      <div class="study-card">
        <div class="urdu-display">${word.urdu}</div>
        <div class="translit">${escapeHtml(word.transliteration)} • ${escapeHtml(word.bengali_pron)}</div>
        <div class="divider"></div>
        <div class="meaning-row">
          <span class="meaning">${escapeHtml(word.bengali_meaning)}</span>
        </div>
        ${word.antonym ? `
          <div class="divider"></div>
          <div class="antonym-row">
            <span class="pill gulnar">বিপরীত</span>
            <span class="urdu">${word.antonym.urdu}</span>
            <span>— ${escapeHtml(word.antonym.bengali_meaning)}</span>
          </div>` : ''}
      </div>
    `);
    stage.appendChild(card);
    document.getElementById('study-counter').textContent = `${state.study.index + 1} / ${list.length}`;
  }

  /* ------------------------------------------------------------------------
     12. POETIC MODE (diary page)
     ------------------------------------------------------------------------ */
  function renderPoeticView() {
    state.poetic.list = poeticWords();
    if (state.poetic.index >= state.poetic.list.length) state.poetic.index = 0;

    if (!document.getElementById('poetic-prev').dataset.bound) {
      document.getElementById('poetic-prev').dataset.bound = '1';
      document.getElementById('poetic-prev').addEventListener('click', () => stepPoetic(-1));
      document.getElementById('poetic-next').addEventListener('click', () => stepPoetic(1));
    }
    renderPoeticCard(false);
  }

  function stepPoetic(dir) {
    const len = state.poetic.list.length;
    if (!len) return;
    state.poetic.index = (state.poetic.index + dir + len) % len;
    renderPoeticCard(true);
  }

  function renderPoeticCard(animate) {
    const inner = document.getElementById('diary-inner');
    const list = state.poetic.list;
    if (!list.length) {
      inner.innerHTML = `<p>এখনো কোনো কাব্যিক শব্দ যোগ করা হয়নি।</p>`;
      return;
    }
    const word = list[state.poetic.index];
    inner.innerHTML = `
      <div class="urdu-display">${word.urdu}</div>
      <div class="translit">${escapeHtml(word.transliteration)}</div>
      <div class="meaning">${escapeHtml(word.bengali_meaning)}</div>
      ${word.poetic_note ? `<p class="poetic-note">${escapeHtml(word.poetic_note)}</p>` : ''}
    `;
    if (animate) {
      inner.classList.remove('is-flipping');
      void inner.offsetWidth;
      inner.classList.add('is-flipping');
    }

    const dotsWrap = document.getElementById('diary-dots');
    dotsWrap.innerHTML = '';
    if (list.length <= 12) {
      list.forEach((_, i) => {
        const dot = document.createElement('span');
        if (i === state.poetic.index) dot.className = 'is-current';
        dotsWrap.appendChild(dot);
      });
    } else {
      dotsWrap.textContent = `${state.poetic.index + 1} / ${list.length}`;
      dotsWrap.style.color = 'var(--muted)';
      dotsWrap.style.fontSize = '0.78rem';
    }
  }

  /* ------------------------------------------------------------------------
     13. MY LIBRARY
     ------------------------------------------------------------------------ */
  function renderLibraryView() {
    const entries = Object.entries(state.progress.library)
      .map(([id, meta]) => ({ word: findWord(id), meta }))
      .filter((e) => e.word)
      .sort((a, b) => b.meta.dayIndex - a.meta.dayIndex);

    document.getElementById('library-stats').innerHTML = `
      <div class="btn-row" style="gap:10px">
        <span class="pill">সংগ্রহে ${entries.length}টি শব্দ</span>
        <span class="pill gulnar">🔥 ${state.progress.streak} দিনের ধারা</span>
      </div>
    `;

    const content = document.getElementById('library-content');
    if (!entries.length) {
      content.innerHTML = `<div class="library-empty">এখনো লাইব্রেরি খালি — হোম স্ক্রিনে আজকের শব্দটি খুলে প্রথম শব্দ সংগ্রহ করো।</div>`;
      return;
    }
    content.innerHTML = '';
    const grid = document.createElement('div');
    grid.className = 'library-grid';
    entries.forEach(({ word, meta }) => {
      const d = new Date(meta.firstUnlockedAt);
      const dateLabel = `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
      grid.appendChild(el(`
        <div class="lib-card">
          <div class="urdu">${word.urdu}</div>
          <div class="meaning">${escapeHtml(word.bengali_meaning)}</div>
          <div class="date">${dateLabel}</div>
        </div>
      `));
    });
    content.appendChild(grid);
  }

  /* ------------------------------------------------------------------------
     14. VISUAL VOCABULARY MODE
     ------------------------------------------------------------------------ */
  function sceneSvg(sceneId) {
    if (sceneId === 'room') {
      return `
        <svg viewBox="0 0 300 375" xmlns="http://www.w3.org/2000/svg">
          <rect width="300" height="375" fill="#EDE3CC"/>
          <rect x="0" y="0" width="300" height="230" fill="#E3D6B4"/>
          <rect x="0" y="230" width="300" height="145" fill="#C9A26A"/>
          <rect x="20" y="40" width="80" height="100" rx="4" fill="#F7F1E1" stroke="#B99A5B" stroke-width="3"/>
          <line x1="60" y1="40" x2="60" y2="140" stroke="#B99A5B" stroke-width="3"/>
          <line x1="20" y1="90" x2="100" y2="90" stroke="#B99A5B" stroke-width="3"/>
          <rect x="220" y="30" width="55" height="120" rx="3" fill="#7A5A3A"/>
          <rect x="225" y="35" width="45" height="110" rx="2" fill="#95765230"/>
          <circle cx="257" cy="90" r="4" fill="#3A2A18"/>
          <rect x="90" y="230" width="140" height="14" fill="#8A6A45"/>
          <rect x="100" y="244" width="10" height="60" fill="#8A6A45"/>
          <rect x="210" y="244" width="10" height="60" fill="#8A6A45"/>
          <rect x="60" y="260" width="55" height="70" fill="#4A6B8A"/>
          <rect x="60" y="260" width="55" height="10" fill="#5C7E9C"/>
          <ellipse cx="185" cy="255" rx="16" ry="10" fill="#DCEAF2" stroke="#9CB8C9" stroke-width="2"/>
          <rect x="178" y="255" width="14" height="26" fill="#DCEAF2" stroke="#9CB8C9" stroke-width="2"/>
        </svg>`;
    }
    return `
      <svg viewBox="0 0 300 375" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#0F1830"/>
            <stop offset="100%" stop-color="#2E4270"/>
          </linearGradient>
        </defs>
        <rect width="300" height="375" fill="url(#sky)"/>
        <circle cx="220" cy="80" r="42" fill="#F3E9D2" opacity="0.95"/>
        <circle cx="205" cy="68" r="42" fill="#0F1830" opacity="0.55"/>
        <path d="M0 300 L60 260 L130 300 L200 250 L300 300 L300 375 L0 375 Z" fill="#182647"/>
        <path d="M0 320 L80 300 L160 330 L240 300 L300 320 L300 375 L0 375 Z" fill="#101B36"/>
      </svg>`;
  }

  function renderVisualView() {
    const scenes = Object.keys(state.data.scenes);
    if (!state.visual.scene) state.visual.scene = scenes[0];

    const tabs = document.getElementById('scene-tabs');
    tabs.innerHTML = '';
    scenes.forEach((id) => {
      const btn = document.createElement('button');
      btn.className = 'scene-tab' + (id === state.visual.scene ? ' is-active' : '');
      btn.textContent = state.data.scenes[id].label_bn;
      btn.addEventListener('click', () => { state.visual.scene = id; renderVisualView(); });
      tabs.appendChild(btn);
    });

    const stage = document.getElementById('scene-stage');
    stage.innerHTML = sceneSvg(state.visual.scene);
    const wordsInScene = state.words.filter((w) => w.scene === state.visual.scene);
    wordsInScene.forEach((word) => {
      const dot = document.createElement('button');
      dot.className = 'hotspot' + (state.progress.seenHotspots.includes(word.id) ? ' is-seen' : '');
      dot.style.left = word.scene_position.x + '%';
      dot.style.top = word.scene_position.y + '%';
      dot.textContent = '?';
      dot.setAttribute('aria-label', word.bengali_meaning);
      dot.addEventListener('click', () => openHotspot(word, dot));
      stage.appendChild(dot);
    });
  }

  function openHotspot(word, dotEl) {
    if (!state.progress.seenHotspots.includes(word.id)) {
      state.progress.seenHotspots.push(word.id);
      saveProgress();
    }
    dotEl.classList.add('is-seen');

    const backdrop = el(`
      <div class="scene-popover-backdrop">
        <div class="scene-popover">
          <div class="urdu-display">${word.urdu}</div>
          <div class="meaning">${escapeHtml(word.bengali_meaning)}</div>
          <div class="translit">${escapeHtml(word.transliteration)} • ${escapeHtml(word.bengali_pron)}</div>
          <div class="btn-row">
            <button class="btn btn-outline" id="hs-speak">🔊 শুনুন</button>
            <button class="btn btn-primary" id="hs-close">বন্ধ করো</button>
          </div>
        </div>
      </div>
    `);
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) backdrop.remove(); });
    backdrop.querySelector('#hs-speak').addEventListener('click', () => speakUrdu(word.urdu));
    backdrop.querySelector('#hs-close').addEventListener('click', () => backdrop.remove());
    document.body.appendChild(backdrop);
  }

  /* ------------------------------------------------------------------------
     15. Bootstrap
     ------------------------------------------------------------------------ */
  function bindNav() {
    document.querySelectorAll('.nav-item').forEach((btn) => {
      btn.addEventListener('click', () => goto(btn.dataset.view));
    });
    document.querySelectorAll('[data-goto]').forEach((btn) => {
      btn.addEventListener('click', () => goto(btn.dataset.goto));
    });
    document.querySelectorAll('.subtab').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.spellingSubtab = btn.dataset.subtab;
        renderSpellingView();
      });
    });
  }

  function showFatalError() {
    document.getElementById('app').innerHTML = `
      <div style="padding:40px 24px;text-align:center;font-family:sans-serif;color:#1B2A4A">
        <h2>শব্দভাণ্ডার লোড করা যায়নি</h2>
        <p style="color:#746B58;margin:10px 0 20px">অ্যাপটি ইন্টারনেট সংযোগ ছাড়া প্রথমবার খোলা যাবে না, অথবা data/words.json ফাইলটি খুঁজে পাওয়া যায়নি।</p>
        <button onclick="location.reload()" style="padding:12px 22px;border-radius:8px;background:#1B2A4A;color:#fff;border:none;font-weight:600">আবার চেষ্টা করো</button>
      </div>`;
  }

  async function init() {
    primeVoices();
    bindNav();
    try {
      const res = await fetch(DATA_URL, { cache: 'no-cache' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      state.data = await res.json();
      state.words = state.data.words;
    } catch (e) {
      console.error(e);
      showFatalError();
      return;
    }

    goto('home');

    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('SW registration failed', e));
      });
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
