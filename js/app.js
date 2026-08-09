/* ============================================================
   N4 単語帳 — 主程式
   資料由 js/data/*.js 推入 window.VOCAB_RAW
   活用變化由 js/conjugate.js 即時生成
   ============================================================ */
(function () {
  'use strict';

  var CAT = function (p) {
    if (/^動詞/.test(p)) return '動詞';
    if (/形容詞$/.test(p)) return '形容詞';
    if (p === '名詞') return '名詞';
    return '副詞・其他';
  };

  var VOCAB = (window.VOCAB_RAW || []).map(function (v, i) {
    v.c = CAT(v.p);
    v.id = v.w + '::' + v.k;
    v.idx = i;
    v.ex = v.ex || [];
    return v;
  });

  /* ---------- 儲存 ---------- */
  var KEY = 'n4-vocab-app';
  var store = load();

  function load() {
    var d = { fav: [], learned: [], theme: 'light', quiz: { rounds: 0, right: 0, total: 0 } };
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) {
        var p = JSON.parse(raw);
        if (Array.isArray(p.fav)) d.fav = p.fav;
        if (Array.isArray(p.learned)) d.learned = p.learned;
        if (p.theme) d.theme = p.theme;
        if (p.quiz) d.quiz = p.quiz;
      }
    } catch (e) { /* localStorage 不可用時就用預設值 */ }
    return d;
  }
  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify({
        fav: Array.from(fav), learned: Array.from(learned),
        theme: store.theme, quiz: store.quiz
      }));
    } catch (e) { /* 忽略（無痕模式等） */ }
  }
  var fav = new Set(store.fav);
  var learned = new Set(store.learned);

  var $ = function (s) { return document.querySelector(s); };
  var $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function shuffleArr(a) {
    var r = a.slice();
    for (var i = r.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = r[i]; r[i] = r[j]; r[j] = t;
    }
    return r;
  }

  /* ---------- 主題 ---------- */
  function applyTheme() {
    document.documentElement.setAttribute('data-theme', store.theme);
    $('#themeBtn').textContent = store.theme === 'dark' ? '☀️' : '🌙';
  }
  $('#themeBtn').addEventListener('click', function () {
    store.theme = store.theme === 'dark' ? 'light' : 'dark';
    applyTheme(); save();
  });
  applyTheme();

  /* ---------- 語音 ---------- */
  var jaVoice = null;
  function pickVoice() {
    if (!('speechSynthesis' in window)) return;
    jaVoice = speechSynthesis.getVoices().filter(function (v) { return /^ja/i.test(v.lang); })[0] || null;
  }
  if ('speechSynthesis' in window) { pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; }
  function speak(text) {
    if (!('speechSynthesis' in window) || !text) return;
    speechSynthesis.cancel();
    var u = new SpeechSynthesisUtterance(text);
    u.lang = 'ja-JP'; u.rate = 0.9;
    if (jaVoice) u.voice = jaVoice;
    speechSynthesis.speak(u);
  }

  /* ---------- 活用表 ---------- */
  function conjHTML(v) {
    var c = window.Conjugate && window.Conjugate.of(v);
    if (!c) return '';
    var head = c.kind === 'verb'
      ? '第 ' + ['', '一', '二', '三'][c.group] + ' 類動詞（' + ['', '五段', '一段', 'サ変・カ変'][c.group] + '）'
      : c.kind;
    var rows = c.forms.map(function (f) {
      var cell = c.table[f.key];
      if (!cell) return '';
      var sub = (cell.kana && cell.kana !== cell.disp) ? '<span class="cj-kana">' + esc(cell.kana) + '</span>' : '';
      return '<div class="cj-row"><span class="cj-label">' + esc(f.label) +
        '<em>' + esc(f.note) + '</em></span>' +
        '<span class="cj-form">' + esc(cell.disp) + sub + '</span></div>';
    }).join('');
    return '<div class="conj"><div class="cj-head">' + esc(head) + '</div><div class="cj-grid">' + rows + '</div></div>';
  }

  /* ---------- 分頁切換 ---------- */
  function showView(name, scroll) {
    var tab = $('.tab[data-view="' + name + '"]');
    if (!tab) return;
    $$('.tab').forEach(function (x) { x.classList.remove('active'); });
    $$('.view').forEach(function (x) { x.classList.remove('active'); });
    tab.classList.add('active');
    $('#view-' + name).classList.add('active');
    if (name === 'card') refreshCardDeck();
    if (name === 'quiz') updatePoolNote();
    if (scroll) window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  $$('.tab').forEach(function (t) {
    t.addEventListener('click', function () { location.hash = t.dataset.view; showView(t.dataset.view, true); });
  });
  window.addEventListener('hashchange', function () {
    showView(location.hash.replace('#', '') || 'list', true);
  });

  /* ---------- 進度 ---------- */
  function updateProgress() {
    var pct = VOCAB.length ? Math.round(learned.size / VOCAB.length * 100) : 0;
    $('#progressFill').style.width = pct + '%';
    $('#progressText').textContent = learned.size + ' / ' + VOCAB.length;
  }

  /* =========================================================
     單字表
     ========================================================= */
  var filter = { cat: '全部', q: '', fav: false, hideLearned: false, sort: 'default' };
  var randomOrder = null;
  var PAGE = 60, shown = PAGE;

  function getFiltered() {
    var q = filter.q.trim().toLowerCase();
    var list = VOCAB.filter(function (v) {
      if (filter.cat !== '全部' && v.c !== filter.cat) return false;
      if (filter.fav && !fav.has(v.id)) return false;
      if (filter.hideLearned && learned.has(v.id)) return false;
      if (q) {
        var hay = (v.w + v.k + v.m + v.p + v.ex.map(function (e) { return e.join(''); }).join('')).toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
    if (filter.sort === 'kana') {
      list.sort(function (a, b) { return a.k.localeCompare(b.k, 'ja'); });
    } else if (filter.sort === 'random') {
      if (!randomOrder) {
        randomOrder = {};
        shuffleArr(VOCAB.map(function (v) { return v.id; })).forEach(function (id, i) { randomOrder[id] = i; });
      }
      list.sort(function (a, b) { return randomOrder[a.id] - randomOrder[b.id]; });
    }
    return list;
  }

  function wordHTML(v) {
    var isFav = fav.has(v.id), isLearn = learned.has(v.id);
    var ex = v.ex.map(function (e, i) {
      return '<div class="ex"><span class="ex-no">' + '①②③'.charAt(i) + '</span>' +
        '<div><div class="ja">' + esc(e[0]) + '</div><div class="zh">' + esc(e[1]) + '</div></div></div>';
    }).join('');
    var hasConj = /^動詞/.test(v.p) || /形容詞$/.test(v.p);
    return '<article class="word' + (isLearn ? ' learned' : '') + '" data-id="' + esc(v.id) + '">' +
      '<div class="w-actions">' +
        '<button class="act speak-btn" title="發音">🔊</button>' +
        '<button class="act fav-btn' + (isFav ? ' on-fav' : '') + '" title="收藏">' + (isFav ? '★' : '☆') + '</button>' +
        '<button class="act learn-btn' + (isLearn ? ' on-learn' : '') + '" title="標記已背">✓</button>' +
      '</div>' +
      '<div class="w-head"><div class="w-kana">' + esc(v.k) + '</div>' +
        '<div class="w-head-line"><span class="w-main">' + esc(v.w) + '</span>' +
        '<span class="w-pos">' + esc(v.p) + '</span></div></div>' +
      '<div class="w-mean' + ($('#hideMeaning').checked ? ' masked' : '') + '">' + esc(v.m) + '</div>' +
      (ex ? '<div class="w-ex">' + ex + '</div>' : '') +
      (hasConj ? '<button class="conj-toggle">▸ 活用變化</button><div class="conj-box" hidden></div>' : '') +
    '</article>';
  }

  function renderList(reset) {
    if (reset !== false) shown = PAGE;
    var list = getFiltered();
    $('#wordList').innerHTML = list.slice(0, shown).map(wordHTML).join('');
    $('#countText').textContent = '顯示 ' + Math.min(shown, list.length) + ' / ' + list.length + ' 個單字' +
      (fav.size ? '　★ ' + fav.size : '') + (learned.size ? '　✓ ' + learned.size : '');
    $('#emptyList').hidden = list.length > 0;
    var more = $('#loadMore');
    more.hidden = shown >= list.length;
    more.textContent = '載入更多（還有 ' + Math.max(0, list.length - shown) + ' 個）';
  }
  $('#loadMore').addEventListener('click', function () { shown += PAGE; renderList(false); });

  $('#wordList').addEventListener('click', function (e) {
    var art = e.target.closest('.word');
    if (!art) return;
    var v = VOCAB.filter(function (x) { return x.id === art.dataset.id; })[0];
    if (!v) return;

    if (e.target.closest('.speak-btn')) { speak(v.k); return; }
    if (e.target.closest('.fav-btn')) {
      if (fav.has(v.id)) fav.delete(v.id); else fav.add(v.id);
      save(); renderList(false); return;
    }
    if (e.target.closest('.learn-btn')) {
      if (learned.has(v.id)) learned.delete(v.id); else learned.add(v.id);
      save(); updateProgress(); renderList(false); return;
    }
    if (e.target.closest('.conj-toggle')) {
      var btn = e.target.closest('.conj-toggle'), box = art.querySelector('.conj-box');
      if (box.hidden) { if (!box.innerHTML) box.innerHTML = conjHTML(v); box.hidden = false; btn.textContent = '▾ 活用變化'; }
      else { box.hidden = true; btn.textContent = '▸ 活用變化'; }
      return;
    }
    if (e.target.classList.contains('masked')) { e.target.classList.remove('masked'); return; }
    var exJa = e.target.closest('.ex');
    if (exJa) { speak(exJa.querySelector('.ja').textContent); }
  });

  $('#search').addEventListener('input', function (e) { filter.q = e.target.value; renderList(); });
  $('#catChips').addEventListener('click', function (e) {
    var c = e.target.closest('.chip'); if (!c) return;
    $$('#catChips .chip').forEach(function (x) { x.classList.remove('active'); });
    c.classList.add('active'); filter.cat = c.dataset.cat; renderList();
  });
  $('#onlyFav').addEventListener('change', function (e) { filter.fav = e.target.checked; renderList(); });
  $('#hideLearned').addEventListener('change', function (e) { filter.hideLearned = e.target.checked; renderList(); });
  $('#hideMeaning').addEventListener('change', function () { renderList(false); });
  $('#sortBy').addEventListener('change', function (e) {
    filter.sort = e.target.value;
    if (filter.sort === 'random') randomOrder = null;
    renderList();
  });

  /* =========================================================
     單字卡
     ========================================================= */
  var deck = [], deckPos = 0;

  function refreshCardDeck() {
    var keepId = deck[deckPos] && deck[deckPos].id;
    deck = getFiltered();
    var found = keepId ? deck.map(function (v) { return v.id; }).indexOf(keepId) : -1;
    deckPos = found >= 0 ? found : 0;
    renderCard();
  }

  function renderCard() {
    var empty = deck.length === 0;
    $('#cardEmpty').hidden = !empty;
    $('#flashcard').style.display = empty ? 'none' : '';
    $('.card-controls').style.display = empty ? 'none' : '';
    if (empty) { $('#cardCounter').textContent = '0 / 0'; return; }
    if (deckPos >= deck.length) deckPos = 0;

    var v = deck[deckPos], reverse = $('#cardReverse').checked;
    $('#flashcard').classList.remove('flipped');
    $('#cardCounter').textContent = (deckPos + 1) + ' / ' + deck.length;

    if (!reverse) {
      $('#fKana').textContent = '';
      $('#fWord').textContent = v.w;
      $('#bMean').textContent = v.m;
      $('#bSub').textContent = v.w === v.k ? '' : v.k;
    } else {
      $('#fKana').textContent = v.p;
      $('#fWord').textContent = v.m;
      $('#bMean').textContent = v.w;
      $('#bSub').textContent = v.w === v.k ? '' : v.k;
    }
    $('#bPos').textContent = v.p;
    $('#bEx').innerHTML = v.ex.map(function (e) {
      return '<p class="ex-ja">' + esc(e[0]) + '</p><p class="ex-zh">' + esc(e[1]) + '</p>';
    }).join('');

    var fb = $('#cardFav'), lb = $('#cardLearned');
    fb.classList.toggle('on-fav', fav.has(v.id));
    fb.textContent = fav.has(v.id) ? '★ 已收藏' : '☆ 收藏';
    lb.classList.toggle('on-learn', learned.has(v.id));
    lb.textContent = learned.has(v.id) ? '✓ 已背起來' : '✓ 已背';

    var cj = $('#cardConj');
    var html = conjHTML(v);
    cj.innerHTML = html;
    cj.hidden = !html;
  }

  function flip() { $('#flashcard').classList.toggle('flipped'); }
  function moveCard(step) {
    if (!deck.length) return;
    deckPos = (deckPos + step + deck.length) % deck.length;
    renderCard();
  }
  $('#flashcard').addEventListener('click', flip);
  $('#cardPrev').addEventListener('click', function () { moveCard(-1); });
  $('#cardNext').addEventListener('click', function () { moveCard(1); });
  $('#cardReverse').addEventListener('change', renderCard);
  $('#cardShuffle').addEventListener('click', function () { deck = shuffleArr(deck); deckPos = 0; renderCard(); });
  $('#cardSpeak').addEventListener('click', function (e) {
    e.stopPropagation(); var v = deck[deckPos]; if (v) speak(v.k);
  });
  $('#cardFav').addEventListener('click', function () {
    var v = deck[deckPos]; if (!v) return;
    if (fav.has(v.id)) fav.delete(v.id); else fav.add(v.id);
    save(); renderCard(); renderList(false);
  });
  $('#cardLearned').addEventListener('click', function () {
    var v = deck[deckPos]; if (!v) return;
    if (learned.has(v.id)) learned.delete(v.id); else learned.add(v.id);
    save(); updateProgress(); renderCard(); renderList(false);
  });

  document.addEventListener('keydown', function (e) {
    if (!$('#view-card').classList.contains('active')) return;
    var tag = document.activeElement && document.activeElement.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    if (e.key === ' ') { e.preventDefault(); flip(); }
    else if (e.key === 'ArrowRight') moveCard(1);
    else if (e.key === 'ArrowLeft') moveCard(-1);
    else if (e.key === 's' || e.key === 'S') { var v = deck[deckPos]; if (v) speak(v.k); }
  });

  /* =========================================================
     測驗
     ========================================================= */
  var quiz = { dir: 'ja2zh', num: 10, scope: 'all', qs: [], i: 0, right: 0, wrong: [], answered: false };

  function quizPool() {
    var pool;
    if (quiz.scope === 'filter') pool = getFiltered();
    else if (quiz.scope === 'fav') pool = VOCAB.filter(function (v) { return fav.has(v.id); });
    else if (quiz.scope === 'unlearned') pool = VOCAB.filter(function (v) { return !learned.has(v.id); });
    else pool = VOCAB.slice();
    if (quiz.dir === 'kana') pool = pool.filter(function (v) { return v.w !== v.k; });
    if (quiz.dir === 'group') pool = pool.filter(function (v) { return /^動詞/.test(v.p); });
    return pool;
  }

  function updatePoolNote() {
    var n = quizPool().length;
    $('#quizPoolNote').textContent = '可出題範圍：' + n + ' 個單字' + (n < 4 ? '（至少需要 4 個才能出題）' : '');
    $('#quizStart').disabled = n < 4;
    var q = store.quiz;
    $('#quizStats').innerHTML = q.rounds
      ? '累計：完成 ' + q.rounds + ' 回合 ・ 答對 ' + q.right + ' / ' + q.total +
        '（' + Math.round(q.right / q.total * 100) + '%）'
      : '還沒有測驗紀錄，開始第一回合吧！';
  }

  $$('#quizSetup .chips').forEach(function (group) {
    group.addEventListener('click', function (e) {
      var c = e.target.closest('.chip'); if (!c) return;
      Array.prototype.forEach.call(group.children, function (x) { x.classList.remove('active'); });
      c.classList.add('active');
      if (c.dataset.dir) quiz.dir = c.dataset.dir;
      if (c.dataset.num) quiz.num = parseInt(c.dataset.num, 10);
      if (c.dataset.scope) quiz.scope = c.dataset.scope;
      updatePoolNote();
    });
  });

  function faceOf(v) {
    if (quiz.dir === 'ja2zh') return { main: v.w, sub: v.w === v.k ? '' : v.k };
    if (quiz.dir === 'zh2ja') return { main: v.m, sub: v.p };
    if (quiz.dir === 'group') return { main: v.w, sub: v.k + '　→　這是第幾類動詞？' };
    return { main: v.w, sub: '' };
  }
  function answerOf(v) {
    if (quiz.dir === 'ja2zh') return v.m;
    if (quiz.dir === 'zh2ja') return v.w;
    if (quiz.dir === 'group') return v.p === '動詞I' ? '第一類（五段）' : v.p === '動詞II' ? '第二類（一段）' : '第三類（サ変・カ変）';
    return v.k;
  }

  function buildQuestions() {
    var pool = quizPool();
    var picked = shuffleArr(pool).slice(0, Math.min(quiz.num, pool.length));
    return picked.map(function (v) {
      var correct = answerOf(v), opts;
      if (quiz.dir === 'group') {
        opts = ['第一類（五段）', '第二類（一段）', '第三類（サ変・カ変）'];
      } else {
        var others = shuffleArr(pool.filter(function (o) { return o.id !== v.id && answerOf(o) !== correct; }));
        var same = others.filter(function (o) { return o.c === v.c; });
        var picks = [], used = {};
        same.concat(others).forEach(function (o) {
          var a = answerOf(o);
          if (picks.length < 3 && !used[a]) { used[a] = 1; picks.push(a); }
        });
        opts = shuffleArr(picks.concat([correct]));
      }
      return { v: v, correct: correct, opts: opts };
    });
  }

  $('#quizStart').addEventListener('click', function () {
    quiz.qs = buildQuestions();
    if (!quiz.qs.length) return;
    quiz.i = 0; quiz.right = 0; quiz.wrong = [];
    $('#quizSetup').hidden = true; $('#quizResult').hidden = true; $('#quizPlay').hidden = false;
    showQuestion();
  });

  function showQuestion() {
    var q = quiz.qs[quiz.i];
    quiz.answered = false;
    var f = faceOf(q.v);
    $('#quizQuestion').innerHTML = esc(f.main) + (f.sub ? '<span class="q-sub">' + esc(f.sub) + '</span>' : '');
    $('#quizProgress').textContent = (quiz.i + 1) + ' / ' + quiz.qs.length;
    $('#quizScore').textContent = '✓ ' + quiz.right;
    $('#quizBar').style.width = (quiz.i / quiz.qs.length * 100) + '%';
    $('#quizExplain').hidden = true; $('#quizNext').hidden = true;
    $('#quizSpeak').hidden = quiz.dir === 'zh2ja' || !('speechSynthesis' in window);
    $('#quizOptions').innerHTML = q.opts.map(function (o) {
      return '<button class="opt" data-val="' + esc(o) + '">' + esc(o) + '</button>';
    }).join('');
  }

  $('#quizSpeak').addEventListener('click', function () { speak(quiz.qs[quiz.i].v.k); });

  $('#quizOptions').addEventListener('click', function (e) {
    var btn = e.target.closest('.opt');
    if (!btn || quiz.answered) return;
    quiz.answered = true;
    var q = quiz.qs[quiz.i], chosen = btn.dataset.val, ok = chosen === q.correct;
    $$('#quizOptions .opt').forEach(function (b) {
      b.disabled = true;
      if (b.dataset.val === q.correct) b.classList.add('correct');
      else if (b === btn) b.classList.add('wrong');
    });
    if (ok) quiz.right++;
    else quiz.wrong.push({ v: q.v, correct: q.correct, chosen: chosen });
    $('#quizScore').textContent = '✓ ' + quiz.right;

    var v = q.v, ex = v.ex[0];
    $('#quizExplain').innerHTML =
      '<div><b>' + esc(v.w) + '</b>' + (v.w === v.k ? '' : '　<span class="dim">' + esc(v.k) + '</span>') +
      '　<span class="w-pos">' + esc(v.p) + '</span></div><div>' + esc(v.m) + '</div>' +
      (ex ? '<p class="ex-ja" style="margin:8px 0 0">' + esc(ex[0]) + '</p><p class="ex-zh" style="margin:0">' + esc(ex[1]) + '</p>' : '');
    $('#quizExplain').hidden = false;
    $('#quizNext').hidden = false;
    $('#quizNext').textContent = quiz.i === quiz.qs.length - 1 ? '看結果 →' : '下一題 →';
    speak(v.k);
  });

  $('#quizNext').addEventListener('click', function () {
    if (quiz.i < quiz.qs.length - 1) { quiz.i++; showQuestion(); } else finishQuiz();
  });

  function finishQuiz() {
    var total = quiz.qs.length, pct = Math.round(quiz.right / total * 100);
    store.quiz.rounds++; store.quiz.right += quiz.right; store.quiz.total += total;
    save();
    $('#quizPlay').hidden = true; $('#quizResult').hidden = false;
    $('#scorePct').textContent = pct + '%';
    $('#scoreLine').textContent = '答對 ' + quiz.right + ' / ' + total + ' 題　' +
      (pct === 100 ? '完美！すごい！🎉' : pct >= 80 ? '很不錯，繼續保持！💪' : pct >= 60 ? '再複習一下就更穩了 📚' : '沒關係，多練幾次就會了 🌱');
    $('#wrongList').innerHTML = quiz.wrong.length
      ? '<div class="dim" style="margin-bottom:4px">答錯的單字（已自動加入收藏 ★）</div>' +
        quiz.wrong.map(function (w) {
          return '<div class="wrong-item"><b>' + esc(w.v.w) + '</b>' +
            (w.v.w === w.v.k ? '' : '<span class="k">' + esc(w.v.k) + '</span>') + '　' + esc(w.v.m) +
            '<br><span class="dim">你選了：' + esc(w.chosen) + '　正解：' + esc(w.correct) + '</span></div>';
        }).join('')
      : '<div style="text-align:center;color:var(--green);font-weight:600">全部答對，太厲害了！</div>';
    quiz.wrong.forEach(function (w) { fav.add(w.v.id); });
    if (quiz.wrong.length) { save(); renderList(false); }
  }

  $('#quizAgain').addEventListener('click', function () {
    quiz.qs = buildQuestions(); quiz.i = 0; quiz.right = 0; quiz.wrong = [];
    $('#quizResult').hidden = true; $('#quizPlay').hidden = false;
    showQuestion();
  });
  $('#quizBack').addEventListener('click', function () {
    $('#quizResult').hidden = true; $('#quizPlay').hidden = true; $('#quizSetup').hidden = false;
    updatePoolNote();
  });

  /* ---------- 清除紀錄 ---------- */
  $('#resetBtn').addEventListener('click', function () {
    if (!confirm('確定要清除所有收藏、已背標記與測驗紀錄嗎？此動作無法復原。')) return;
    fav.clear(); learned.clear(); store.quiz = { rounds: 0, right: 0, total: 0 };
    save(); updateProgress(); renderList(); renderCard(); updatePoolNote();
  });

  /* ---------- 啟動 ---------- */
  $('#totalWords').textContent = VOCAB.length;
  updateProgress();
  renderList();
  refreshCardDeck();
  updatePoolNote();
  if (location.hash) showView(location.hash.replace('#', ''), false);
})();
