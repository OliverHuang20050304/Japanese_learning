/* ============================================================
   日中查詢 — 兩層查找
   第一層：本站 941 個單字（離線、有校對過的中文與例句）
   第二層：中文維基詞典 API（免費、有 CORS、中文釋義）

   維基詞典有速率限制，連續請求會回 429，
   因此這裡做了「最小間隔佇列」與「本地快取」。
   ============================================================ */
(function (global) {
  'use strict';

  var API = 'https://zh.wiktionary.org/w/api.php';
  var PAGE = 'https://zh.wiktionary.org/wiki/';
  var CACHE_KEY = 'n4-dict-cache';
  var CACHE_MAX = 400;              // 最多快取幾個詞
  var CACHE_TTL = 90 * 86400000;    // 90 天
  var MIN_GAP = 1200;               // 兩次請求至少間隔（毫秒）

  /* ---------- 快取 ---------- */
  function loadCache() {
    try { return JSON.parse(localStorage.getItem(CACHE_KEY)) || {}; }
    catch (e) { return {}; }
  }
  function saveCache(c) {
    try {
      var keys = Object.keys(c);
      if (keys.length > CACHE_MAX) {                 // 超量就丟掉最舊的
        keys.sort(function (a, b) { return c[a].t - c[b].t; })
            .slice(0, keys.length - CACHE_MAX)
            .forEach(function (k) { delete c[k]; });
      }
      localStorage.setItem(CACHE_KEY, JSON.stringify(c));
    } catch (e) { /* 空間不足就算了 */ }
  }
  var cache = loadCache();

  /* ---------- 請求佇列（節流） ---------- */
  var queue = Promise.resolve(), lastAt = 0;
  function throttled(fn) {
    queue = queue.then(function () {
      var wait = Math.max(0, MIN_GAP - (Date.now() - lastAt));
      return new Promise(function (r) { setTimeout(r, wait); }).then(function () {
        lastAt = Date.now();
        return fn();
      });
    }, function () { lastAt = Date.now(); return fn(); });
    return queue;
  }

  /* ---------- 解析維基詞典的純文字內容 ---------- */
  /* 中文維基詞典的標題簡繁混用，兩種都要認 */
  var POS_MAP = {
    '名詞': '名詞', '名词': '名詞', '動詞': '動詞', '动词': '動詞',
    '形容詞': '形容詞', '形容词': '形容詞',   // 維基的「形容詞」不分 い／な，不擅自斷定
    '形容動詞': 'な形容詞', '形容动词': 'な形容詞',
    '副詞': '副詞', '副词': '副詞', '助詞': '助詞', '助词': '助詞',
    '感嘆詞': '感嘆詞', '感歎詞': '感嘆詞', '感叹词': '感嘆詞',
    '接續詞': '接續詞', '接続詞': '接續詞', '接续词': '接續詞',
    '連體詞': '連體詞', '連体詞': '連體詞', '连体词': '連體詞',
    '代詞': '代名詞', '代名詞': '代名詞', '代词': '代名詞',
    '數詞': '數詞', '数词': '數詞',
    '専有名詞': '專有名詞', '專有名詞': '專有名詞', '专有名词': '專有名詞',
    '接頭詞': '接頭詞', '接头词': '接頭詞', '接尾詞': '接尾詞', '接尾词': '接尾詞',
    '成語': '成語', '成语': '成語'
  };
  /* 從「静か【しずか】（形动）」這種行抓詞性 */
  var INLINE_POS = [
    [/形[容]?动|形[容]?動/, 'な形容詞'], [/[（(]名[）)]|名词|名詞/, '名詞'],
    [/自動詞|他動詞|自动词|他动词|[（(]動[）)]|动词|動詞/, '動詞'],
    [/形容詞|形容词/, '形容詞'], [/副詞|副词/, '副詞']
  ];

  /* 維基的發音欄會用長音符寫平假名（けーざい），還原成一般寫法（けいざい） */
  var VOWEL_ROW = {
    あ: 'あ', い: 'い', う: 'う', え: 'い', お: 'う'   // 長音要補的字：え段→い、お段→う
  };
  var ROWS = {
    あ: 'あかさたなはまやらわがざだばぱゃ',
    い: 'いきしちにひみりぎじぢびぴ',
    う: 'うくすつぬふむゆるぐずづぶぷゅ',
    え: 'えけせてねへめれげぜでべぺ',
    お: 'おこそとのほもよろをごぞどぼぽょ'
  };
  function normKana(k) {
    if (/[ァ-ヶ]/.test(k)) return k;                    // 片假名保留長音符
    return k.replace(/(.)ー/g, function (m, c) {
      for (var row in ROWS) if (ROWS[row].indexOf(c) >= 0) return c + VOWEL_ROW[row];
      return c;
    });
  }

  var HAS_JP = /[ぁ-んァ-ヶー]/;          // 含假名 → 是例句或詞條行，不是中文釋義
  var HAS_LATIN = /[A-Za-z]/;             // 羅馬字拼音同理

  /* 從一段內文裡挑出「純中文的釋義行」。
     維基詞典常見的排法是：釋義 → 日文例句 → 例句中譯，
     所以緊接在例句後面的中文行要當成例句翻譯排除掉。 */
  function pickDefs(chunk, skipFirst) {
    var lines = chunk.split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
    if (skipFirst) lines = lines.slice(1);
    var defs = [], prevWasExample = false;
    lines.forEach(function (ln) {
      var isExample = HAS_JP.test(ln) || HAS_LATIN.test(ln);
      if (isExample) { prevWasExample = true; return; }
      if (prevWasExample) { prevWasExample = false; return; }   // 這行是上一句例句的翻譯
      if (ln.length <= 40) defs.push(ln.replace(/^[·・*\-\s]+/, ''));
    });
    return defs.slice(0, 6);
  }

  function parseExtract(text) {
    if (!text) return null;
    var m = text.match(/(^|\n)==\s*日[語语]\s*==\n([\s\S]*?)(?=\n==[^=]|$)/);
    if (!m) return null;
    var body = m[2];
    var out = { pron: '', senses: [] };

    var parts = body.split(/\n===\s*([^=\n]+?)\s*===\n/);
    for (var i = 1; i < parts.length; i += 2) {
      var title = parts[i].trim();
      var chunk = (parts[i + 1] || '').split(/\n====/)[0];
      if (/^[發发]音/.test(title)) {
        var kana = chunk.match(/[ぁ-んァ-ヶー]{2,}/);
        var accent = chunk.match(/([頭中尾平][高板]型)/);
        out.pron = [kana ? normKana(kana[0]) : '', accent ? accent[1] : ''].filter(Boolean).join('　');
        continue;
      }
      var pos = POS_MAP[title];
      if (!pos) continue;
      var defs = pickDefs(chunk, true);
      if (defs.length) out.senses.push({ pos: pos, defs: defs });
    }

    /* 有些條目沒有分級標題，整段是平的，改用整段解析 */
    if (!out.senses.length) {
      var flat = body.split(/\n===/)[0];
      var head = flat.split('\n').map(function (s) { return s.trim(); }).filter(Boolean)[0] || '';
      var pos2 = '';
      for (var j = 0; j < INLINE_POS.length; j++) {
        if (INLINE_POS[j][0].test(head)) { pos2 = INLINE_POS[j][1]; break; }
      }
      var k = head.match(/[【（(]([ぁ-んァ-ヶー]{2,})[】）)]/);
      if (k && !out.pron) out.pron = k[1];
      var d2 = pickDefs(flat, true);
      if (d2.length) out.senses.push({ pos: pos2, defs: d2 });
    }
    return out.senses.length ? out : null;
  }

  /* ---------- 查詢 ---------- */
  function fetchWiktionary(word) {
    var url = API + '?action=query&format=json&origin=*&redirects=1' +
      '&prop=extracts&explaintext=1&titles=' + encodeURIComponent(word);
    return fetch(url).then(function (r) {
      if (r.status === 429) { var e = new Error('rate'); e.code = 429; throw e; }
      if (!r.ok) throw new Error('http ' + r.status);
      return r.json();
    }).then(function (j) {
      var pages = (j.query && j.query.pages) || {};
      var page = Object.keys(pages).map(function (k) { return pages[k]; })[0];
      if (!page || page.missing !== undefined) return null;
      return parseExtract(page.extract || '');
    });
  }

  function lookup(word) {
    word = (word || '').trim();
    if (!word) return Promise.resolve({ status: 'empty' });

    var hit = cache[word];
    if (hit && Date.now() - hit.t < CACHE_TTL) {
      return Promise.resolve({ status: hit.d ? 'ok' : 'notfound', data: hit.d, cached: true, word: word });
    }
    return throttled(function () { return fetchWiktionary(word); })
      .then(function (data) {
        cache[word] = { t: Date.now(), d: data };
        saveCache(cache);
        return { status: data ? 'ok' : 'notfound', data: data, word: word };
      })
      .catch(function (e) {
        return { status: e.code === 429 ? 'rate' : 'error', error: String(e.message || e), word: word };
      });
  }

  global.Dict = {
    lookup: lookup,
    parseExtract: parseExtract,
    pageUrl: function (w) { return PAGE + encodeURIComponent(w); },
    cacheSize: function () { return Object.keys(cache).length; },
    clearCache: function () { cache = {}; try { localStorage.removeItem(CACHE_KEY); } catch (e) {} }
  };
})(typeof window !== 'undefined' ? window : globalThis);
