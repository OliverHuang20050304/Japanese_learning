/* ============================================================
   SRS — 間隔重複排程引擎
   每個單字記錄「熟練度等級」與「下次複習日」，
   答對就拉長間隔、答錯就打回重來，只在快忘記時才複習到它。
   ============================================================ */
(function (global) {
  'use strict';

  /* 各等級答對後，隔幾天再考 */
  var INTERVALS = [0, 1, 3, 7, 14, 30, 90];
  var MAX_LV = INTERVALS.length - 1;          // 6
  var MASTER_LV = 4;                          // 到這一級視為「已熟」
  var LV_NAME = ['新字', 'Lv.1', 'Lv.2', 'Lv.3', 'Lv.4', 'Lv.5', 'Lv.6'];

  /* ---------- 日期工具（一律用當地時間的 YYYY-MM-DD） ---------- */
  function today(d) {
    d = d || new Date();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + m + '-' + day;
  }
  function addDays(dateStr, n) {
    var p = dateStr.split('-');
    var d = new Date(+p[0], +p[1] - 1, +p[2]);
    d.setDate(d.getDate() + n);
    return today(d);
  }
  function daysBetween(a, b) {
    var pa = a.split('-'), pb = b.split('-');
    var da = new Date(+pa[0], +pa[1] - 1, +pa[2]);
    var db = new Date(+pb[0], +pb[1] - 1, +pb[2]);
    return Math.round((db - da) / 86400000);
  }

  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  /* ---------- 評分 ----------
     g: 'again' 不會 ｜ 'hard' 模糊 ｜ 'good' 會            */
  function grade(rec, g, day) {
    rec = rec ? Object.assign({}, rec) : { lv: 0, seen: 0, right: 0 };
    day = day || today();
    rec.seen = (rec.seen || 0) + 1;
    rec.last = day;

    if (g === 'again') {
      rec.lv = 1;                       // 打回第一級，明天再考
      rec.due = addDays(day, 1);
      rec.lapse = (rec.lapse || 0) + 1;
    } else if (g === 'hard') {
      rec.lv = Math.max(1, rec.lv);     // 不升級，但也不歸零
      rec.due = addDays(day, 1);
      rec.right = (rec.right || 0) + 1;
    } else {
      rec.lv = Math.min(MAX_LV, (rec.lv || 0) + 1);
      rec.due = addDays(day, INTERVALS[rec.lv]);
      rec.right = (rec.right || 0) + 1;
    }
    return rec;
  }

  /* ---------- 學習佇列 ---------- */
  function isDue(rec, day) {
    return !!rec && !!rec.due && rec.due <= (day || today());
  }

  /* 確保每個單字都在固定的隨機學習順序裡（新增的字補在後面） */
  function ensureOrder(state, vocab) {
    var ids = vocab.map(function (v) { return v.id; });
    var valid = {};
    ids.forEach(function (id) { valid[id] = 1; });

    var order = (state.order || []).filter(function (id) { return valid[id]; });
    var inOrder = {};
    order.forEach(function (id) { inOrder[id] = 1; });

    var missing = ids.filter(function (id) { return !inOrder[id]; });
    if (missing.length) order = order.concat(shuffle(missing));

    state.order = order;
    return order;
  }

  /* 產生今天要練的卡片：到期複習 + 若干新字 */
  function buildQueue(vocab, state, day) {
    day = day || today();
    var byId = {};
    vocab.forEach(function (v) { byId[v.id] = v; });
    ensureOrder(state, vocab);

    var review = [];
    Object.keys(state.srs || {}).forEach(function (id) {
      if (byId[id] && isDue(state.srs[id], day)) review.push({ v: byId[id], isNew: false });
    });
    // 逾期越久的排越前面
    review.sort(function (a, b) {
      return (state.srs[a.v.id].due < state.srs[b.v.id].due) ? -1 : 1;
    });

    var limit = state.settings && state.settings.newPerDay;
    limit = (limit === undefined) ? 10 : limit;
    var learnedToday = (state.daily && state.daily.date === day) ? (state.daily.newDone || 0) : 0;
    var room = Math.max(0, limit - learnedToday);

    var fresh = [];
    for (var i = 0; i < state.order.length && fresh.length < room; i++) {
      var id = state.order[i];
      if (byId[id] && !(state.srs || {})[id]) fresh.push({ v: byId[id], isNew: true });
    }
    return { review: review, fresh: fresh };
  }

  /* 把複習與新字交錯排列，避免一開始連續 10 個新字 */
  function interleave(review, fresh) {
    if (!fresh.length) return review.slice();
    if (!review.length) return fresh.slice();
    var out = [], step = review.length / fresh.length, next = 0, fi = 0;
    for (var i = 0; i < review.length; i++) {
      out.push(review[i]);
      if (fi < fresh.length && i >= next) { out.push(fresh[fi++]); next += step; }
    }
    while (fi < fresh.length) out.push(fresh[fi++]);
    return out;
  }

  /* ---------- 連續學習天數 ---------- */
  function touchStreak(state, day) {
    day = day || today();
    var s = state.streak || { days: 0, last: null };
    if (s.last === day) { state.streak = s; return s; }
    if (s.last && daysBetween(s.last, day) === 1) s.days = (s.days || 0) + 1;
    else s.days = 1;
    s.last = day;
    state.streak = s;
    return s;
  }
  /* 只讀：中斷超過一天就顯示為 0 */
  function currentStreak(state, day) {
    var s = state.streak;
    if (!s || !s.last) return 0;
    var gap = daysBetween(s.last, day || today());
    return (gap === 0 || gap === 1) ? (s.days || 0) : 0;
  }

  /* ---------- 統計 ---------- */
  function levelCounts(vocab, state) {
    var c = [0, 0, 0, 0, 0, 0, 0], untouched = 0;
    vocab.forEach(function (v) {
      var r = (state.srs || {})[v.id];
      if (!r) untouched++; else c[Math.min(MAX_LV, r.lv || 0)]++;
    });
    return { levels: c, untouched: untouched, studied: vocab.length - untouched,
             mastered: c.slice(MASTER_LV).reduce(function (a, b) { return a + b; }, 0) };
  }

  global.SRS = {
    INTERVALS: INTERVALS, MAX_LV: MAX_LV, MASTER_LV: MASTER_LV, LV_NAME: LV_NAME,
    today: today, addDays: addDays, daysBetween: daysBetween, shuffle: shuffle,
    grade: grade, isDue: isDue, ensureOrder: ensureOrder, buildQueue: buildQueue,
    interleave: interleave, touchStreak: touchStreak, currentStreak: currentStreak,
    levelCounts: levelCounts
  };
})(typeof window !== 'undefined' ? window : globalThis);
