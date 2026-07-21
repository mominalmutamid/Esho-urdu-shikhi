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
    library: {},          // { wordId: { firstUnlockedAt, dayIndex } }
    spelling: { attempts: 0, correct: 0 },
    quiz: { attempts: 0, correct: 0 },
    sentenceBuild: { attempts: 0, correct: 0 }
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
        sentenceBuild: Object.assign({ attempts: 0, correct: 0 }, parsed.sentenceBuild)
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
    sentenceBuild: { current: null, tier: 'easy', tokens: [], tiles: [], answer: [], usedIds: new Set() }
  };

  /* ------------------------------------------------------------------------
     6. Data access helpers
     ------------------------------------------------------------------------ */
  function findWord(id) {
    return state.words.find((w) => w.id === id) || (state.data.classical_poetry || []).find((w) => w.id === id);
  }
  function wordOfDayForIndex(idx) {
    const seq = state.data.word_of_day_sequence;
    const i = ((idx % seq.length) + seq.length) % seq.length;
    return findWord(seq[i]);
  }
  function nonProverbWords() { return state.words.filter((w) => w.type !== 'proverb'); }
  function poeticWords() { return [...state.words.filter((w) => w.is_poetic), ...(state.data.classical_poetry || [])]; }

  function sentencePool(tier) {
    if (tier === 'hard') {
      return state.words.filter((w) => w.type === 'proverb')
        .map((w) => ({ urdu: w.urdu, bengali: w.bengali_meaning, pron_bn: w.bengali_pron }));
    }
    return state.words.filter((w) => w.example_sentence)
      .map((w) => ({ urdu: w.example_sentence.urdu, bengali: w.example_sentence.bengali, pron_bn: w.example_sentence.pron_bn }));
  }

  /* ------------------------------------------------------------------------
     7. Daily unlock engine (no streak tracking — just "opened today or not")
     ------------------------------------------------------------------------ */
  function isTodayUnlocked() {
    return currentDayIndex() === state.progress.lastUnlockDayIndex;
  }
  function unlockToday() {
    const idx = currentDayIndex();
    if (idx === state.progress.lastUnlockDayIndex) return wordOfDayForIndex(idx);

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
    alphabet: renderAlphabetView,
    sentence: renderSentenceView
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

    const wrap = document.getElementById('wod-wrap');
    wrap.querySelectorAll('.seal, .wod-card').forEach((n) => n.remove());

    if (unlocked) {
      wrap.appendChild(buildWodCard(word, true));
    } else {
      const seal = el(`
        <button class="seal" aria-label="আজকের শব্দ খুলুন">
          <span class="seal-title">শব্দটি খুলুন</span>
          <span class="seal-hint">ট্যাপ করুন</span>
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
          renderDayStrip();
          showToast('আজকের শব্দ সংগ্রহে যুক্ত হলো');
        }, 420);
      });
      wrap.appendChild(seal);
    }

    renderDayStrip();
  }

  function buildWodCard(word, alreadyOpen) {
    const isProverb = word.type === 'proverb';
    const isClassical = word.type === 'classical_poetry';
    const tagLabel = isClassical ? 'ক্লাসিক কবিতা' : (isProverb ? 'প্রবাদ' : 'কাব্যিক শব্দ');
    const card = el(`
      <div class="wod-card ${alreadyOpen ? 'already-open is-revealed' : ''}">
        <span class="type-tag">${tagLabel}</span>
        <div class="urdu-display">${word.urdu}</div>
        ${isClassical ? `<div class="poet-credit">— ${escapeHtml(word.poet_bn)} (${word.poet_urdu})</div>` : ''}
        <div class="meaning">${escapeHtml(word.bengali_meaning)}</div>
        <button class="speak-link" type="button">উচ্চারণ শুনুন</button>
        ${word.poetic_note ? `<div class="poetic-note bn-serif">${escapeHtml(word.poetic_note)}</div>` : ''}
      </div>
    `);
    card.querySelector('.speak-link').addEventListener('click', () => speakUrdu(word.urdu));
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
        <button class="speak-link" type="button">উচ্চারণ শুনুন</button>
      </div>
    `);
    prompt.querySelector('.speak-link').addEventListener('click', () => speakUrdu(word.urdu));
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
        <button class="speak-link" type="button">উচ্চারণ শুনুন</button>
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
        ${word.example_sentence ? `
          <div class="example-sentence">
            <span class="ex-label">উদাহরণ বাক্য</span>
            <div class="ex-urdu urdu">${word.example_sentence.urdu}</div>
            <div class="ex-bengali">${escapeHtml(word.example_sentence.bengali)}</div>
            ${word.example_sentence.pron_bn ? `<div class="ex-pron">উচ্চারণ: ${escapeHtml(word.example_sentence.pron_bn)}</div>` : ''}
          </div>` : ''}
      </div>
    `);
    card.querySelector('.speak-link').addEventListener('click', () => speakUrdu(word.urdu));
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
    const isClassical = word.type === 'classical_poetry';
    inner.innerHTML = `
      <div class="urdu-display">${word.urdu}</div>
      ${isClassical ? `<div class="poet-credit">— ${escapeHtml(word.poet_bn)} (${word.poet_urdu})</div>` : ''}
      <div class="translit">${escapeHtml(word.transliteration)}</div>
      ${isClassical ? `<div class="ex-pron" style="margin-bottom:10px">উচ্চারণ: ${escapeHtml(word.bengali_pron)}</div>` : ''}
      <div class="meaning">${escapeHtml(word.bengali_meaning)}</div>
      <button class="speak-link" type="button">উচ্চারণ শুনুন</button>
      ${word.poetic_note ? `<p class="poetic-note">${escapeHtml(word.poetic_note)}</p>` : ''}
      ${word.example_sentence ? `
        <div class="example-sentence">
          <span class="ex-label">উদাহরণ বাক্য</span>
          <div class="ex-urdu urdu">${word.example_sentence.urdu}</div>
          <div class="ex-bengali">${escapeHtml(word.example_sentence.bengali)}</div>
          ${word.example_sentence.pron_bn ? `<div class="ex-pron">উচ্চারণ: ${escapeHtml(word.example_sentence.pron_bn)}</div>` : ''}
        </div>` : ''}
    `;
    const speakBtn = inner.querySelector('.speak-link');
    if (speakBtn) speakBtn.addEventListener('click', () => speakUrdu(word.urdu));
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
     14. URDU ALPHABET MODE
     ------------------------------------------------------------------------ */
  function renderAlphabetView() {
    const grid = document.getElementById('alphabet-grid');
    grid.innerHTML = '';
    state.data.alphabet.forEach((letter) => {
      const cell = el(`
        <div class="alphabet-cell">
          <div class="urdu">${letter.urdu}</div>
          <div class="name-bn">${escapeHtml(letter.name_bn)}</div>
          <div class="sound-bn">${escapeHtml(letter.sound_bn)}</div>
          <button class="speak-link" type="button">উচ্চারণ শুনুন</button>
        </div>
      `);
      cell.querySelector('.speak-link').addEventListener('click', () => speakUrdu(letter.urdu));
      grid.appendChild(cell);
    });
  }

  /* ------------------------------------------------------------------------
     14b. SENTENCE FORMATION MODE (বাক্য গঠন মোড)
     Reuses the same verified example sentences (word level) and proverbs
     (full-sentence level) already in the dictionary — arrange word-tiles
     into the correct order rather than typing freely, so there is always
     exactly one correct, pre-verified answer.
     ------------------------------------------------------------------------ */
  function renderSentenceView() {
    document.querySelectorAll('#view-sentence .tier-tab').forEach((b) => {
      b.classList.toggle('is-active', b.dataset.tier === state.sentenceBuild.tier);
    });
    if (!state.sentenceBuild.current) newSentenceRound();
    else renderSentencePanel();
  }

  function newSentenceRound() {
    const pool = sentencePool(state.sentenceBuild.tier);
    if (!pool.length) return;
    let entry = randomChoice(pool);
    if (state.sentenceBuild.current && pool.length > 1) {
      while (entry.urdu === state.sentenceBuild.current.urdu) entry = randomChoice(pool);
    }
    state.sentenceBuild.current = entry;
    const tokens = entry.urdu.split(' ').map((w, i) => ({ text: w, id: i }));
    state.sentenceBuild.tokens = tokens;
    state.sentenceBuild.tiles = shuffle(tokens);
    state.sentenceBuild.answer = [];
    state.sentenceBuild.usedIds = new Set();
    renderSentencePanel();
  }

  function renderSentencePanel() {
    const panel = document.getElementById('sentence-panel');
    const entry = state.sentenceBuild.current;
    panel.innerHTML = '';

    const prompt = el(`
      <div class="prompt-card">
        <div class="meaning">${escapeHtml(entry.bengali)}</div>
        ${entry.pron_bn ? `<div class="translit-hint">উচ্চারণ: ${escapeHtml(entry.pron_bn)}</div>` : ''}
      </div>
    `);
    panel.appendChild(prompt);

    const slot = el(`<div class="answer-slot"><span class="urdu"></span></div>`);
    slot.querySelector('.urdu').textContent = state.sentenceBuild.answer.map((t) => t.text).join(' ');
    panel.appendChild(slot);

    const pool = el(`<div class="word-tile-pool"></div>`);
    state.sentenceBuild.tiles.forEach((tile) => {
      const btn = document.createElement('button');
      btn.className = 'word-tile urdu';
      btn.textContent = tile.text;
      if (state.sentenceBuild.usedIds.has(tile.id)) btn.classList.add('is-used');
      btn.addEventListener('click', () => onSentenceTileTap(tile));
      pool.appendChild(btn);
    });
    panel.appendChild(pool);

    const actions = el(`
      <div class="spelling-actions">
        <button class="btn btn-outline" id="sentence-clear">মুছে ফেলো</button>
        <button class="btn btn-outline" id="sentence-skip">এড়িয়ে যাও</button>
      </div>
    `);
    actions.querySelector('#sentence-clear').addEventListener('click', () => {
      state.sentenceBuild.answer = [];
      state.sentenceBuild.usedIds = new Set();
      renderSentencePanel();
    });
    actions.querySelector('#sentence-skip').addEventListener('click', newSentenceRound);
    panel.appendChild(actions);

    const stats = state.progress.sentenceBuild;
    panel.appendChild(el(`
      <div class="score-row">
        <span>সঠিক: <b>${stats.correct}</b></span>
        <span>চেষ্টা: <b>${stats.attempts}</b></span>
      </div>
    `));
  }

  function onSentenceTileTap(tile) {
    if (state.sentenceBuild.usedIds.has(tile.id)) return;
    state.sentenceBuild.usedIds.add(tile.id);
    state.sentenceBuild.answer.push(tile);
    renderSentencePanel();

    if (state.sentenceBuild.answer.length === state.sentenceBuild.tokens.length) {
      const built = state.sentenceBuild.answer.map((t) => t.text).join(' ');
      const correct = built === state.sentenceBuild.current.urdu;
      state.progress.sentenceBuild.attempts++;
      const slotEl = document.querySelector('#sentence-panel .answer-slot');
      if (correct) {
        state.progress.sentenceBuild.correct++;
        slotEl.classList.add('is-correct');
        saveProgress();
        setTimeout(newSentenceRound, 1100);
      } else {
        slotEl.classList.add('is-wrong');
        saveProgress();
        setTimeout(() => {
          state.sentenceBuild.answer = [];
          state.sentenceBuild.usedIds = new Set();
          renderSentencePanel();
        }, 900);
      }
    }
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
    document.querySelectorAll('.tier-tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (btn.dataset.tier === state.sentenceBuild.tier) return;
        state.sentenceBuild.tier = btn.dataset.tier;
        state.sentenceBuild.current = null;
        renderSentenceView();
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
