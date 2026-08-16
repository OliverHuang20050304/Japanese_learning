/* ============================================================
   N4 単語帳 — 主程式
   資料：js/data/*.js → window.VOCAB_RAW
   活用：js/conjugate.js　排程：js/srs.js
   ============================================================ */
(function () {
  'use strict';

  var S = window.SRS;

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

  /* =========================================================
     儲存
     ========================================================= */
  var KEY = 'n4-vocab-app';
  var store = load();

  function load() {
    var d = {
      fav: [], theme: 'light', quiz: { rounds: 0, right: 0, total: 0 },
      srs: {}, order: [], settings: { newPerDay: 10, furi: 'on', voice: '' },
      streak: { days: 0, last: null }, daily: { date: null, newDone: 0, reviewDone: 0 }
    };
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return d;
      var p = JSON.parse(raw);
      if (Array.isArray(p.fav)) d.fav = p.fav;
      if (p.theme) d.theme = p.theme;
      if (p.quiz) d.quiz = p.quiz;
      if (p.srs) d.srs = p.srs;
      if (Array.isArray(p.order)) d.order = p.order;
      if (p.settings) d.settings = Object.assign(d.settings, p.settings);
      if (p.streak) d.streak = p.streak;
      if (p.daily) d.daily = p.daily;
      /* 舊版的「已背」清單 → 匯入成 Lv.3（七天後複習），不歸零重來 */
      if (Array.isArray(p.learned) && p.learned.length && !p.srs) {
        var t = S.today();
        p.learned.forEach(function (id) {
          d.srs[id] = { lv: 3, due: S.addDays(t, 7), seen: 1, right: 1, last: t };
        });
      }
    } catch (e) { /* localStorage 不可用時就用預設值 */ }
    return d;
  }
  function save() {
    try {
      store.fav = Array.from(fav);
      localStorage.setItem(KEY, JSON.stringify(store));
    } catch (e) { /* 無痕模式等，忽略 */ }
  }
  var fav = new Set(store.fav);

  var $ = function (s) { return document.querySelector(s); };
  var $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  var shuffleArr = S.shuffle;

  /* 例句的假名標註：把「漢字[かんじ]」轉成 <ruby> */
  function ruby(furi, plain) {
    if (store.settings.furi === 'off' || !furi) return esc(plain || furi || '');
    var out = '', last = 0, re = /([一-龯々〆]+)\[([^\]]+)\]/g, m;
    while ((m = re.exec(furi)) !== null) {
      out += esc(furi.slice(last, m.index));
      out += '<ruby>' + esc(m[1]) + '<rt>' + esc(m[2]) + '</rt></ruby>';
      last = m.index + m[0].length;
    }
    return out + esc(furi.slice(last));
  }
  function applyFuri() { document.documentElement.setAttribute('data-furi', store.settings.furi); }

  function rec(id) { return store.srs[id]; }
  function lvOf(id) { var r = rec(id); return r ? (r.lv || 0) : -1; }   // -1 = 未學
  function isMastered(id) { return lvOf(id) >= S.MASTER_LV; }

  /* =========================================================
     主題・語音
     ========================================================= */
  function applyTheme() {
    document.documentElement.setAttribute('data-theme', store.theme);
    $('#themeBtn').textContent = store.theme === 'dark' ? '☀️' : '🌙';
  }
  $('#themeBtn').addEventListener('click', function () {
    store.theme = store.theme === 'dark' ? 'light' : 'dark';
    applyTheme(); save();
  });
  applyTheme();

  /* macOS 內建了一批「搞笑語音」（Eddy、Rocko、Grandpa…），
     getVoices() 常常把它們排在最前面，直接取第一個就會聽到怪腔怪調。
     這裡改成替每個日文語音評分，挑最自然的那個。 */
  var NOVELTY = /(eddy|flo|grandma|grandpa|reed|rocko|sandy|shelley|bells|bubbles|jester|organ|superstar|trinoids|whisper|wobble|zarvox|boing|bahh|cellos|deranged|hysterical|junior|ralph|albert|bad news|good news)/i;
  var GOOD_JA = /(kyoko|o-?ren|otoya|hattori|ayumi|nanami|ichiro|mizuki|sayaka|haruka)/i;
  var FEMALE_JA = /(kyoko|o-?ren|ayumi|nanami|mizuki|sayaka|haruka)/i;   // 較接近「Google 小姐」的女聲

  function voiceScore(v) {
    var n = v.name || '', s = 0;
    if (/google/i.test(n)) s += 100;                      // Chrome 的「Google 日本語」最自然
    if (GOOD_JA.test(n)) s += 60;                         // macOS/Windows 的標準日文語音
    if (FEMALE_JA.test(n)) s += 10;                       // 預設挑女聲，聽起來較清晰自然
    if (/(premium|enhanced|拡張|プレミアム|siri)/i.test(n)) s += 30;   // 加強版音質更好
    if (NOVELTY.test(n)) s -= 200;                        // 搞笑語音排到最後
    if (!v.localService) s += 3;
    return s;
  }
  function jaVoices() {
    if (!('speechSynthesis' in window)) return [];
    return speechSynthesis.getVoices()
      .filter(function (v) { return /^ja/i.test(v.lang); })
      .sort(function (a, b) { return voiceScore(b) - voiceScore(a) || a.name.localeCompare(b.name); });
  }
  var jaVoice = null;
  function pickVoice() {
    var list = jaVoices();
    if (!list.length) { jaVoice = null; return; }
    var saved = store.settings.voice;
    jaVoice = (saved && list.filter(function (v) { return v.name === saved; })[0]) || list[0];
    renderVoiceOptions(list);
  }
  function renderVoiceOptions(list) {
    var sel = $('#voiceSel');
    if (!sel) return;
    if (!list.length) {
      sel.innerHTML = '<option>找不到日文語音</option>';
      $('#voiceNote').textContent = '這個瀏覽器沒有可用的日文語音。';
      return;
    }
    sel.innerHTML = list.map(function (v) {
      return '<option value="' + esc(v.name) + '"' + (jaVoice && v.name === jaVoice.name ? ' selected' : '') +
        '>' + esc(v.name) + (NOVELTY.test(v.name) ? '（趣味音效）' : '') + '</option>';
    }).join('');
    $('#voiceNote').textContent = jaVoice && /kyoko|o-?ren/i.test(jaVoice.name)
      ? '想要更自然的音質：系統設定 →「輔助使用」→「朗讀」→「系統語音」，把 Kyoko 下載成加強版。'
      : '目前使用：' + (jaVoice ? jaVoice.name : '—');
  }
  if ('speechSynthesis' in window) {
    pickVoice();
    speechSynthesis.onvoiceschanged = pickVoice;      // 語音清單常常是非同步載入的
  }
  function speak(text) {
    if (!('speechSynthesis' in window) || !text) return;
    speechSynthesis.cancel();
    var u = new SpeechSynthesisUtterance(text);
    u.lang = 'ja-JP';
    u.rate = 0.88;
    u.pitch = 1;
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
      return '<div class="cj-row"><span class="cj-label">' + esc(f.label) + '<em>' + esc(f.note) + '</em></span>' +
        '<span class="cj-form">' + esc(cell.disp) + sub + '</span></div>';
    }).join('');
    return '<div class="conj"><div class="cj-head">' + esc(head) + '</div><div class="cj-grid">' + rows + '</div></div>';
  }

  /* =========================================================
     分頁
     ========================================================= */
  function showView(name, scroll) {
    var tab = $('.tab[data-view="' + name + '"]');
    if (!tab) return;
    $$('.tab').forEach(function (x) { x.classList.remove('active'); });
    $$('.view').forEach(function (x) { x.classList.remove('active'); });
    tab.classList.add('active');
    $('#view-' + name).classList.add('active');
    if (name === 'today') renderToday();
    if (name === 'card') refreshCardDeck();
    if (name === 'quiz') updatePoolNote();
    if (name === 'dict') setTimeout(function () { $('#dictInput').focus(); }, 50);
    if (scroll) window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  $$('.tab').forEach(function (t) {
    t.addEventListener('click', function () { location.hash = t.dataset.view; showView(t.dataset.view, true); });
  });
  window.addEventListener('hashchange', function () {
    showView(location.hash.replace('#', '') || 'today', true);
  });

  function updateProgress() {
    var st = S.levelCounts(VOCAB, store);
    var pct = VOCAB.length ? Math.round(st.studied / VOCAB.length * 100) : 0;
    $('#progressFill').style.width = pct + '%';
    $('#progressText').textContent = st.studied + ' / ' + VOCAB.length;
  }

  /* =========================================================
     今日
     ========================================================= */
  var sess = null;

  function renderToday() {
    var day = S.today();
    if (store.daily.date !== day) { store.daily = { date: day, newDone: 0, reviewDone: 0 }; save(); }

    var q = S.buildQueue(VOCAB, store, day);
    $('#dueCount').textContent = q.review.length;
    $('#newCount').textContent = q.fresh.length;
    $('#newPerDay').value = String(store.settings.newPerDay);

    var streak = S.currentStreak(store, day);
    $('#streakBox').innerHTML = streak > 0
      ? '🔥 連續學習 <b>' + streak + '</b> 天'
      : '🌱 今天開始新的紀錄吧';

    var total = q.review.length + q.fresh.length;
    $('#startSession').disabled = total === 0;
    $('#startSession').textContent = total ? '開始今天的練習（' + total + ' 張）→' : '今天的份都做完了 ✓';
    $('#todayHint').textContent = total === 0
      ? (store.daily.newDone + store.daily.reviewDone > 0
          ? '今天完成了 ' + (store.daily.newDone + store.daily.reviewDone) + ' 張卡，明天再來。'
          : '沒有到期的複習了。想多練可以調高每日新字量，或去單字卡／測驗自由練習。')
      : '答對的字會依熟練度自動延後再出現，答錯的明天會再考你。';

    var st = S.levelCounts(VOCAB, store);
    $('#masteredText').innerHTML = '已學 <b>' + st.studied + '</b> ・ 已熟 <b>' + st.mastered + '</b> ・ 未學 ' + st.untouched;
    var max = Math.max.apply(null, st.levels.concat([st.untouched, 1]));
    var bars = [{ n: '未學', c: st.untouched, cls: 'none' }].concat(st.levels.map(function (c, i) {
      return { n: S.LV_NAME[i], c: c, cls: i >= S.MASTER_LV ? 'high' : i === 0 ? 'new' : 'mid' };
    }));
    $('#levelBars').innerHTML = bars.map(function (b) {
      return '<div class="lvbar"><div class="lvbar-track"><div class="lvbar-fill ' + b.cls +
        '" style="height:' + (b.c / max * 100) + '%"></div></div>' +
        '<span class="lvbar-n">' + b.c + '</span><span class="lvbar-l">' + b.n + '</span></div>';
    }).join('');
  }

  $('#furiMode').addEventListener('change', function (e) {
    store.settings.furi = e.target.value;
    applyFuri(); save(); renderList(false); if (sess) showCard();
  });
  $('#voiceSel').addEventListener('change', function (e) {
    store.settings.voice = e.target.value;
    save(); pickVoice();
  });
  $('#voiceTest').addEventListener('click', function () {
    speak('日本語の勉強を続けています。');
  });

  $('#newPerDay').addEventListener('change', function (e) {
    store.settings.newPerDay = parseInt(e.target.value, 10);
    save(); renderToday();
  });

  $('#startSession').addEventListener('click', function () {
    var day = S.today();
    var q = S.buildQueue(VOCAB, store, day);
    var cards = S.interleave(q.review, q.fresh);
    if (!cards.length) return;
    sess = { cards: cards, pos: 0, day: day, stats: { again: 0, hard: 0, good: 0 }, graded: 0, requeued: {} };
    $('#todayHome').hidden = true; $('#todayDone').hidden = true; $('#todaySession').hidden = false;
    showCard();
  });

  function showCard() {
    var c = sess.cards[sess.pos];
    if (!c) return finishSession();
    var v = c.v;

    $('#sessTag').textContent = c.isNew ? '新字' : S.LV_NAME[lvOf(v.id)] + ' 複習';
    $('#sessTag').className = 'sess-tag' + (c.isNew ? ' is-new' : '');
    $('#sessKana').textContent = '';
    $('#sessWord').textContent = v.w;
    $('#sessReveal').hidden = true;
    $('#sessShow').hidden = false;
    $('#gradeBtns').hidden = true;

    $('#sessProgress').textContent = (sess.pos + 1) + ' / ' + sess.cards.length;
    $('#sessBar').style.width = (sess.pos / sess.cards.length * 100) + '%';

    /* 預告下次複習間隔 */
    var lv = Math.max(0, lvOf(v.id));
    $('#gAgain').textContent = '1 天';
    $('#gHard').textContent = '1 天';
    $('#gGood').textContent = S.INTERVALS[Math.min(S.MAX_LV, lv + 1)] + ' 天';
  }

  function revealCard() {
    if (!sess || !$('#sessReveal').hidden) return;
    var v = sess.cards[sess.pos].v;
    $('#sessKana').textContent = v.w === v.k ? '' : v.k;
    $('#sessPos').textContent = v.p;
    $('#sessMean').textContent = v.m;
    $('#sessEx').innerHTML = v.ex.map(function (e, i) {
      return '<div class="ex"><span class="ex-no">' + '①②③'.charAt(i) + '</span>' +
        '<div><div class="ja" data-plain="' + esc(e[0]) + '">' + ruby(e[2], e[0]) + '</div>' +
        '<div class="zh">' + esc(e[1]) + '</div></div></div>';
    }).join('');
    $('#sessConj').innerHTML = conjHTML(v);
    $('#sessReveal').hidden = false;
    $('#sessShow').hidden = true;
    $('#gradeBtns').hidden = false;
    speak(v.k);
  }

  function gradeCard(g) {
    if (!sess || $('#sessReveal').hidden) return;
    var c = sess.cards[sess.pos], id = c.v.id;

    if (c.isNew && !sess.requeued[id]) store.daily.newDone++;
    else if (!c.isNew && !sess.requeued[id]) store.daily.reviewDone++;

    store.srs[id] = S.grade(store.srs[id], g, sess.day);
    sess.stats[g]++;
    sess.graded++;

    /* 答「不會」的字，這一輪結束前會再出現一次 */
    if (g === 'again' && !sess.requeued[id]) {
      sess.requeued[id] = true;
      sess.cards.push({ v: c.v, isNew: false, repeat: true });
    }

    S.touchStreak(store, sess.day);
    save(); updateProgress();
    sess.pos++;
    if (sess.pos >= sess.cards.length) finishSession(); else showCard();
  }

  function finishSession() {
    var s = sess ? sess.stats : { again: 0, hard: 0, good: 0 };
    var total = sess ? sess.graded : 0;
    $('#todaySession').hidden = true; $('#todayDone').hidden = false;
    $('#doneStats').innerHTML =
      '<div class="dstat good"><b>' + s.good + '</b><span>會</span></div>' +
      '<div class="dstat hard"><b>' + s.hard + '</b><span>模糊</span></div>' +
      '<div class="dstat again"><b>' + s.again + '</b><span>不會</span></div>';
    var pct = total ? Math.round(s.good / total * 100) : 0;
    $('#doneLine').textContent = '這一輪 ' + total + ' 張卡，直接答對 ' + pct + '%　' +
      (pct >= 80 ? 'すごい！保持下去 🎉' : pct >= 50 ? '不錯，答錯的明天會再出現 💪' : '不熟的字會密集回來找你 🌱');
    var streak = S.currentStreak(store, S.today());
    if (streak > 0) $('#doneLine').textContent += '　🔥 連續 ' + streak + ' 天';
    sess = null;
    renderList(false);
  }

  $('#sessShow').addEventListener('click', revealCard);
  $('#sessCard').addEventListener('click', function (e) {
    if (e.target.closest('.ex')) {
      var jaEl = e.target.closest('.ex').querySelector('.ja');
      speak(jaEl.dataset.plain || jaEl.textContent); return;
    }
    if ($('#sessReveal').hidden) revealCard();
  });
  $('#gradeBtns').addEventListener('click', function (e) {
    var b = e.target.closest('.grade'); if (b) gradeCard(b.dataset.g);
  });
  $('#sessQuit').addEventListener('click', function () {
    sess = null;
    $('#todaySession').hidden = true; $('#todayHome').hidden = false;
    renderToday();
  });
  $('#doneAgain').addEventListener('click', function () {
    $('#todayDone').hidden = true; $('#todayHome').hidden = false;
    renderToday();
    if (!$('#startSession').disabled) $('#startSession').click();
  });
  $('#doneBack').addEventListener('click', function () {
    $('#todayDone').hidden = true; $('#todayHome').hidden = false;
    renderToday();
  });

  document.addEventListener('keydown', function (e) {
    if (!$('#view-today').classList.contains('active') || !sess) return;
    var tag = document.activeElement && document.activeElement.tagName;
    if (tag === 'INPUT' || tag === 'SELECT') return;
    if (e.key === ' ') { e.preventDefault(); revealCard(); }
    else if (e.key === '1') gradeCard('again');
    else if (e.key === '2') gradeCard('hard');
    else if (e.key === '3') gradeCard('good');
    else if (e.key === 's' || e.key === 'S') speak(sess.cards[sess.pos].v.k);
  });

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
      if (filter.hideLearned && isMastered(v.id)) return false;
      if (q) {
        var hay = (v.w + v.k + v.m + v.p + v.ex.map(function (e) { return e.join(''); }).join('')).toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
    if (filter.sort === 'kana') list.sort(function (a, b) { return a.k.localeCompare(b.k, 'ja'); });
    else if (filter.sort === 'level') list.sort(function (a, b) { return lvOf(a.id) - lvOf(b.id); });
    else if (filter.sort === 'random') {
      if (!randomOrder) {
        randomOrder = {};
        shuffleArr(VOCAB.map(function (v) { return v.id; })).forEach(function (id, i) { randomOrder[id] = i; });
      }
      list.sort(function (a, b) { return randomOrder[a.id] - randomOrder[b.id]; });
    }
    return list;
  }

  function lvBadge(id) {
    var lv = lvOf(id);
    if (lv < 0) return '<span class="lv-chip none">未學</span>';
    var r = rec(id);
    return '<span class="lv-chip' + (lv >= S.MASTER_LV ? ' high' : '') + '" title="下次複習：' + esc(r.due || '') + '">' +
      esc(S.LV_NAME[lv]) + '</span>';
  }

  function wordHTML(v) {
    var isFav = fav.has(v.id);
    var ex = v.ex.map(function (e, i) {
      return '<div class="ex"><span class="ex-no">' + '①②③'.charAt(i) + '</span>' +
        '<div><div class="ja" data-plain="' + esc(e[0]) + '">' + ruby(e[2], e[0]) + '</div>' +
        '<div class="zh">' + esc(e[1]) + '</div></div></div>';
    }).join('');
    var hasConj = /^動詞/.test(v.p) || /形容詞$/.test(v.p);
    return '<article class="word' + (isMastered(v.id) ? ' learned' : '') + '" data-id="' + esc(v.id) + '">' +
      '<div class="w-actions">' +
        '<button class="act speak-btn" title="發音">🔊</button>' +
        '<button class="act fav-btn' + (isFav ? ' on-fav' : '') + '" title="收藏">' + (isFav ? '★' : '☆') + '</button>' +
        '<button class="act learn-btn' + (isMastered(v.id) ? ' on-learn' : '') + '" title="標記為已熟／取消">✓</button>' +
      '</div>' +
      '<div class="w-head"><div class="w-kana">' + esc(v.k) + '</div>' +
        '<div class="w-head-line"><span class="w-main">' + esc(v.w) + '</span>' +
        '<span class="w-pos">' + esc(v.p) + '</span>' + lvBadge(v.id) + '</div></div>' +
      '<div class="w-mean' + ($('#hideMeaning').checked ? ' masked' : '') + '">' + esc(v.m) + '</div>' +
      (ex ? '<div class="w-ex">' + ex + '</div>' : '') +
      (hasConj ? '<button class="conj-toggle">▸ 活用變化</button><div class="conj-box" hidden></div>' : '') +
    '</article>';
  }

  function renderList(reset) {
    if (reset !== false) shown = PAGE;
    var list = getFiltered();
    $('#wordList').innerHTML = list.slice(0, shown).map(wordHTML).join('');
    var st = S.levelCounts(VOCAB, store);
    $('#countText').textContent = '顯示 ' + Math.min(shown, list.length) + ' / ' + list.length + ' 個單字' +
      (fav.size ? '　★ ' + fav.size : '') + '　已熟 ' + st.mastered;
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
      if (isMastered(v.id)) delete store.srs[v.id];
      else store.srs[v.id] = { lv: S.MAX_LV, due: S.addDays(S.today(), S.INTERVALS[S.MAX_LV]), seen: 1, right: 1, last: S.today() };
      save(); updateProgress(); renderList(false); return;
    }
    if (e.target.closest('.conj-toggle')) {
      var btn = e.target.closest('.conj-toggle'), box = art.querySelector('.conj-box');
      if (box.hidden) { if (!box.innerHTML) box.innerHTML = conjHTML(v); box.hidden = false; btn.textContent = '▾ 活用變化'; }
      else { box.hidden = true; btn.textContent = '▸ 活用變化'; }
      return;
    }
    if (e.target.classList.contains('masked')) { e.target.classList.remove('masked'); return; }
    var exEl = e.target.closest('.ex');
    if (exEl) { var ja = exEl.querySelector('.ja'); speak(ja.dataset.plain || ja.textContent); }
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
    if (empty) { $('#cardCounter').textContent = '0 / 0'; $('#cardConj').hidden = true; return; }
    if (deckPos >= deck.length) deckPos = 0;

    var v = deck[deckPos], reverse = $('#cardReverse').checked;
    $('#flashcard').classList.remove('flipped');
    $('#cardCounter').textContent = (deckPos + 1) + ' / ' + deck.length;

    if (!reverse) {
      $('#fKana').textContent = '';
      $('#fWord').textContent = v.w;
      $('#bMean').textContent = v.m;
    } else {
      $('#fKana').textContent = v.p;
      $('#fWord').textContent = v.m;
      $('#bMean').textContent = v.w;
    }
    $('#bSub').textContent = v.w === v.k ? '' : v.k;
    $('#bPos').textContent = v.p;
    $('#bEx').innerHTML = v.ex.map(function (e) {
      return '<p class="ex-ja">' + ruby(e[2], e[0]) + '</p><p class="ex-zh">' + esc(e[1]) + '</p>';
    }).join('');

    var fb = $('#cardFav'), lb = $('#cardLearned');
    fb.classList.toggle('on-fav', fav.has(v.id));
    fb.textContent = fav.has(v.id) ? '★ 已收藏' : '☆ 收藏';
    lb.classList.toggle('on-learn', isMastered(v.id));
    lb.textContent = isMastered(v.id) ? '✓ 已熟' : '✓ 標記已熟';

    var cj = $('#cardConj'), html = conjHTML(v);
    cj.innerHTML = html; cj.hidden = !html;
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
    if (isMastered(v.id)) delete store.srs[v.id];
    else store.srs[v.id] = { lv: S.MAX_LV, due: S.addDays(S.today(), S.INTERVALS[S.MAX_LV]), seen: 1, right: 1, last: S.today() };
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
     查字典
     ========================================================= */
  var IS_DESKTOP = !!(window.__TAURI__ && window.__TAURI__.event);

  function dictLocal(q) {
    var s = q.trim().toLowerCase();
    if (!s) return [];
    var exact = [], partial = [];
    VOCAB.forEach(function (v) {
      if (v.w === q || v.k === q) exact.push(v);
      else if (v.w.indexOf(q) >= 0 || v.k.indexOf(q) >= 0 || v.m.toLowerCase().indexOf(s) >= 0) partial.push(v);
    });
    return exact.concat(partial).slice(0, 8);
  }

  function renderDict(q) {
    var local = dictLocal(q);
    $('#dictLocal').innerHTML = local.length
      ? '<div class="dict-sec"><div class="dict-sec-title">本站單字' +
        '<span class="dict-badge">離線 ・ 有例句與活用表</span></div>' +
        '<div class="word-list">' + local.map(wordHTML).join('') + '</div></div>'
      : '';

    var exactHit = local.some(function (v) { return v.w === q || v.k === q; });
    $('#dictCredit').hidden = true;
    $('#dictRemote').innerHTML = '<div class="dict-sec"><div class="dict-sec-title">中文維基詞典</div>' +
      '<div class="dict-msg">查詢中…</div></div>';

    window.Dict.lookup(q).then(function (r) {
      var head = '<div class="dict-sec"><div class="dict-sec-title">中文維基詞典' +
        (r.cached ? '<span class="dict-badge cached">來自本機快取</span>' : '') + '</div>';
      var body;
      if (r.status === 'ok') {
        body = '<div class="dict-entry"><div class="dict-head">' +
          '<span class="dict-word">' + esc(q) + '</span>' +
          (r.data.pron ? '<span class="dict-pron">' + esc(r.data.pron) + '</span>' : '') +
          '<button class="mini-btn dict-speak">🔊</button></div>' +
          r.data.senses.map(function (se) {
            return '<div class="dict-sense">' + (se.pos ? '<span class="dict-pos">' + esc(se.pos) + '</span>' : '') +
              '<ul class="dict-defs">' + se.defs.map(function (d) { return '<li>' + esc(d) + '</li>'; }).join('') + '</ul></div>';
          }).join('') + '</div>';
        var url = window.Dict.pageUrl(q);
        $('#dictCredit').innerHTML = '釋義取自<b>中文維基詞典</b>，授權 CC BY-SA 4.0。' +
          (IS_DESKTOP ? '<br>原文網址：<span class="dict-url">' + esc(url) + '</span>'
                      : '<br><a href="' + esc(url) + '" target="_blank" rel="noopener">在維基詞典查看原文 ↗</a>');
        $('#dictCredit').hidden = false;
      } else if (r.status === 'notfound') {
        body = '<div class="dict-msg">維基詞典裡沒有「' + esc(q) + '」的日語條目。' +
          (exactHit ? '' : '<br>可以試試換成辭書形（例如「沸かした」→「沸かす」）。') + '</div>';
      } else if (r.status === 'rate') {
        body = '<div class="dict-msg warn">查詢太頻繁，維基詞典暫時擋下了請求。<br>請等幾秒再試一次。</div>';
      } else {
        body = '<div class="dict-msg warn">連不上維基詞典' +
          (navigator.onLine ? '。' : '（目前離線）。') + '<br>本站的 941 個單字仍可正常查詢。</div>';
      }
      $('#dictRemote').innerHTML = head + body + '</div>';
    });
  }

  function runDict(q) {
    q = (q || '').trim();
    if (!q) return;
    $('#dictInput').value = q;
    renderDict(q);
  }
  $('#dictGo').addEventListener('click', function () { runDict($('#dictInput').value); });
  $('#dictInput').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') runDict($('#dictInput').value);
  });
  $('#dictRemote').addEventListener('click', function (e) {
    if (e.target.closest('.dict-speak')) speak($('#dictInput').value.trim());
  });
  $('#dictLocal').addEventListener('click', function (e) {
    var art = e.target.closest('.word'); if (!art) return;
    var v = VOCAB.filter(function (x) { return x.id === art.dataset.id; })[0];
    if (!v) return;
    if (e.target.closest('.speak-btn')) { speak(v.k); return; }
    if (e.target.closest('.conj-toggle')) {
      var btn = e.target.closest('.conj-toggle'), box = art.querySelector('.conj-box');
      if (box.hidden) { if (!box.innerHTML) box.innerHTML = conjHTML(v); box.hidden = false; btn.textContent = '▾ 活用變化'; }
      else { box.hidden = true; btn.textContent = '▸ 活用變化'; }
      return;
    }
    var exEl = e.target.closest('.ex');
    if (exEl) { var ja = exEl.querySelector('.ja'); speak(ja.dataset.plain || ja.textContent); }
  });
  $('#toDict').addEventListener('click', function () {
    var q = $('#search').value.trim();
    location.hash = 'dict'; showView('dict', true);
    if (q) runDict(q);
  });

  /* =========================================================
     測驗
     ========================================================= */
  var quiz = { dir: 'ja2zh', num: 10, scope: 'all', qs: [], i: 0, right: 0, wrong: [], answered: false };

  function quizPool() {
    var pool;
    if (quiz.scope === 'filter') pool = getFiltered();
    else if (quiz.scope === 'fav') pool = VOCAB.filter(function (v) { return fav.has(v.id); });
    else if (quiz.scope === 'unlearned') pool = VOCAB.filter(function (v) { return !isMastered(v.id); });
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
    return shuffleArr(pool).slice(0, Math.min(quiz.num, pool.length)).map(function (v) {
      var correct = answerOf(v), opts;
      if (quiz.dir === 'group') opts = ['第一類（五段）', '第二類（一段）', '第三類（サ変・カ変）'];
      else {
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
      (ex ? '<p class="ex-ja" style="margin:8px 0 0">' + ruby(ex[2], ex[0]) + '</p><p class="ex-zh" style="margin:0">' + esc(ex[1]) + '</p>' : '');
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
      ? '<div class="dim" style="margin-bottom:4px">答錯的單字（已加入收藏 ★，並排進明天的複習）</div>' +
        quiz.wrong.map(function (w) {
          return '<div class="wrong-item"><b>' + esc(w.v.w) + '</b>' +
            (w.v.w === w.v.k ? '' : '<span class="k">' + esc(w.v.k) + '</span>') + '　' + esc(w.v.m) +
            '<br><span class="dim">你選了：' + esc(w.chosen) + '　正解：' + esc(w.correct) + '</span></div>';
        }).join('')
      : '<div style="text-align:center;color:var(--green);font-weight:600">全部答對，太厲害了！</div>';
    /* 測驗答錯的字，直接餵回 SRS 明天再考 */
    quiz.wrong.forEach(function (w) {
      fav.add(w.v.id);
      store.srs[w.v.id] = S.grade(store.srs[w.v.id], 'again', S.today());
    });
    if (quiz.wrong.length) { save(); updateProgress(); renderList(false); }
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
    if (!confirm('確定要清除所有學習進度（熟練度、收藏、連續天數、測驗紀錄）嗎？此動作無法復原。')) return;
    fav.clear();
    store.srs = {}; store.order = [];
    store.quiz = { rounds: 0, right: 0, total: 0 };
    store.streak = { days: 0, last: null };
    store.daily = { date: null, newDone: 0, reviewDone: 0 };
    save(); updateProgress(); renderList(); renderCard(); renderToday(); updatePoolNote();
  });

  /* ---------- 桌面版（Tauri）原生選單 ---------- */
  if (window.__TAURI__ && window.__TAURI__.event) {
    window.__TAURI__.event.listen('menu:goto', function (e) {
      location.hash = e.payload; showView(e.payload, true);
    });
    window.__TAURI__.event.listen('menu:toggle-theme', function () { $('#themeBtn').click(); });
    document.documentElement.classList.add('is-desktop');
  }

  /* ---------- 啟動 ---------- */
  S.ensureOrder(store, VOCAB);
  save();
  applyFuri();
  $('#furiMode').value = store.settings.furi;
  $('#totalWords').textContent = VOCAB.length;
  updateProgress();
  renderToday();
  renderList();
  refreshCardDeck();
  updatePoolNote();
  showView((location.hash || '#today').replace('#', ''), false);
})();
