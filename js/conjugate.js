/* ============================================================
   活用引擎 — 由「辭書形 + 動詞類別」即時生成各種型態
   動詞：ます／ない／た／て／可能／意向／使役／受身／使役受身／條件ば／命令／禁止
   形容詞：い形・な形 的 て形・否定・過去・條件
   ============================================================ */
(function (global) {
  'use strict';

  /* 五段動詞：語尾在各行的變化 */
  var ROW = {
    'う': { a: 'わ', i: 'い', e: 'え', o: 'お', te: 'って', ta: 'った' },
    'く': { a: 'か', i: 'き', e: 'け', o: 'こ', te: 'いて', ta: 'いた' },
    'ぐ': { a: 'が', i: 'ぎ', e: 'げ', o: 'ご', te: 'いで', ta: 'いだ' },
    'す': { a: 'さ', i: 'し', e: 'せ', o: 'そ', te: 'して', ta: 'した' },
    'つ': { a: 'た', i: 'ち', e: 'て', o: 'と', te: 'って', ta: 'った' },
    'ぬ': { a: 'な', i: 'に', e: 'ね', o: 'の', te: 'んで', ta: 'んだ' },
    'ぶ': { a: 'ば', i: 'び', e: 'べ', o: 'ぼ', te: 'んで', ta: 'んだ' },
    'む': { a: 'ま', i: 'み', e: 'め', o: 'も', te: 'んで', ta: 'んだ' },
    'る': { a: 'ら', i: 'り', e: 'れ', o: 'ろ', te: 'って', ta: 'った' }
  };

  /* 特殊：て形不規則、ます形不規則、否定不規則 */
  var TE_EXC = { 'いく': ['って', 'った'], 'ゆく': ['って', 'った'] };
  var MASU_EXC = { 'いらっしゃる': 'いらっしゃい', 'くださる': 'ください', 'なさる': 'なさい', 'おっしゃる': 'おっしゃい', 'ござる': 'ござい' };
  var NAI_EXC = { 'ある': 'ない' };
  /* 敬語動詞的命令形 */
  var IMP_EXC = { 'くださる': 'ください', 'いらっしゃる': 'いらっしゃい', 'なさる': 'なさい', 'おっしゃる': 'おっしゃい' };
  /* ある 為存在動詞，可能・命令・受身・使役受身實際上不使用 */
  var DEFECTIVE = { 'ある': ['potential', 'imperative', 'passive', 'causPass', 'causative'] };

  var FORMS = [
    { key: 'dict', label: '辭書形', note: '原形' },
    { key: 'masu', label: 'ます形', note: '禮貌' },
    { key: 'nai', label: 'ない形', note: '否定' },
    { key: 'ta', label: 'た形', note: '過去' },
    { key: 'te', label: 'て形', note: '連接' },
    { key: 'potential', label: '可能形', note: '能夠' },
    { key: 'volitional', label: '意向形', note: '打算' },
    { key: 'causative', label: '使役形', note: '讓／使' },
    { key: 'passive', label: '受身形', note: '被動' },
    { key: 'causPass', label: '使役受身形', note: '被迫' },
    { key: 'ba', label: '條件形（ば）', note: '如果' },
    { key: 'imperative', label: '命令形', note: '命令' },
    { key: 'prohibitive', label: '禁止形', note: '不准' }
  ];

  /* 把假名活用結果貼回漢字表記：w 與 k 共用同樣的送假名 */
  function withKanji(w, k, cut, tail) {
    // cut = 從語尾切掉幾個假名，tail = 接上去的字串
    var stem = cut > 0 ? w.slice(0, w.length - cut) : w;
    return stem + tail;
  }

  function conjugateVerb(w, k, group) {
    var out = {}, r, base, kb, i;

    function set(key, tail, cut) {
      cut = cut === undefined ? 1 : cut;
      out[key] = { kana: k.slice(0, k.length - cut) + tail, disp: withKanji(w, k, cut, tail) };
    }

    if (group === 3) {
      if (k === 'くる' || w === '来る') {
        var pairs = { dict: 'くる', masu: 'きます', nai: 'こない', ta: 'きた', te: 'きて',
          potential: 'こられる', volitional: 'こよう', causative: 'こさせる', passive: 'こられる',
          causPass: 'こさせられる', ba: 'くれば', imperative: 'こい', prohibitive: 'くるな' };
        var dpairs = { dict: '来る', masu: '来ます', nai: '来ない', ta: '来た', te: '来て',
          potential: '来られる', volitional: '来よう', causative: '来させる', passive: '来られる',
          causPass: '来させられる', ba: '来れば', imperative: '来い', prohibitive: '来るな' };
        FORMS.forEach(function (f) { out[f.key] = { kana: pairs[f.key], disp: dpairs[f.key] }; });
        return out;
      }
      // する 及 〜する 複合動詞
      var tails = { dict: 'する', masu: 'します', nai: 'しない', ta: 'した', te: 'して',
        potential: 'できる', volitional: 'しよう', causative: 'させる', passive: 'される',
        causPass: 'させられる', ba: 'すれば', imperative: 'しろ', prohibitive: 'するな' };
      FORMS.forEach(function (f) {
        out[f.key] = { kana: k.slice(0, k.length - 2) + tails[f.key], disp: withKanji(w, k, 2, tails[f.key]) };
      });
      return out;
    }

    if (group === 2) {
      var t2 = { dict: 'る', masu: 'ます', nai: 'ない', ta: 'た', te: 'て',
        potential: 'られる', volitional: 'よう', causative: 'させる', passive: 'られる',
        causPass: 'させられる', ba: 'れば', imperative: 'ろ', prohibitive: 'るな' };
      FORMS.forEach(function (f) { set(f.key, t2[f.key]); });
      return out;
    }

    /* 第一類（五段） */
    var last = k.charAt(k.length - 1);
    r = ROW[last] || ROW['る'];
    var te = TE_EXC[k] ? TE_EXC[k][0] : r.te;
    var ta = TE_EXC[k] ? TE_EXC[k][1] : r.ta;

    set('dict', last);
    set('masu', (MASU_EXC[k] ? MASU_EXC[k].slice(k.length - 1) : r.i) + 'ます');
    if (NAI_EXC[k]) out.nai = { kana: NAI_EXC[k], disp: NAI_EXC[k] };
    else set('nai', r.a + 'ない');
    set('ta', ta);
    set('te', te);
    set('potential', r.e + 'る');
    set('volitional', r.o + 'う');
    set('causative', r.a + 'せる');
    set('passive', r.a + 'れる');
    // す結尾的五段動詞不用短縮的「〜さされる」，要用「〜させられる」
    set('causPass', last === 'す' ? r.a + 'せられる' : r.a + 'される');
    set('ba', r.e + 'ば');
    if (IMP_EXC[k]) out.imperative = { kana: IMP_EXC[k], disp: withKanji(w, k, 1, IMP_EXC[k].slice(k.length - 1)) };
    else set('imperative', r.e);
    set('prohibitive', last + 'な');
    (DEFECTIVE[k] || []).forEach(function (key) { out[key] = { kana: '—', disp: '—' }; });
    return out;
  }

  var I_ADJ_FORMS = [
    { key: 'dict', label: '辭書形', note: '原形' },
    { key: 'desu', label: 'です形', note: '禮貌' },
    { key: 'nai', label: '否定形', note: '不…' },
    { key: 'ta', label: '過去形', note: '…了' },
    { key: 'tanai', label: '過去否定', note: '（過去）不…' },
    { key: 'te', label: 'て形', note: '連接' },
    { key: 'ba', label: '條件形（ば）', note: '如果' },
    { key: 'adv', label: '副詞形', note: '修飾動詞' }
  ];

  function conjugateAdj(w, k, type) {
    var out = {};
    if (type === 'い') {
      var stem = w.slice(0, w.length - 1);          // 去掉い
      var kstem = k.slice(0, k.length - 1);
      var good = (k === 'いい' || k === 'よい');     // いい 為不規則
      var gs = good ? 'よ' : null;
      function put(key, tail, kanaTail) {
        out[key] = { disp: (good ? (w === 'いい' ? 'よ' : stem) : stem) + tail,
                     kana: (good ? 'よ' : kstem) + (kanaTail === undefined ? tail : kanaTail) };
      }
      out.dict = { disp: w, kana: k };
      if (good) out.desu = { disp: w + 'です', kana: k + 'です' };   // いいです（不說「よいです」）
      else put('desu', 'いです');
      put('nai', 'くない');
      put('ta', 'かった');
      put('tanai', 'くなかった');
      put('te', 'くて');
      put('ba', 'ければ');
      put('adv', 'く');
      return out;
    }
    // な形容詞
    out.dict = { disp: w + 'な', kana: k + 'な' };
    out.desu = { disp: w + 'です', kana: k + 'です' };
    out.nai = { disp: w + 'じゃない', kana: k + 'じゃない' };
    out.ta = { disp: w + 'だった', kana: k + 'だった' };
    out.tanai = { disp: w + 'じゃなかった', kana: k + 'じゃなかった' };
    out.te = { disp: w + 'で', kana: k + 'で' };
    out.ba = { disp: w + 'なら', kana: k + 'なら' };
    out.adv = { disp: w + 'に', kana: k + 'に' };
    return out;
  }

  var NA_ADJ_FORMS = I_ADJ_FORMS.map(function (f) {
    if (f.key === 'dict') return { key: 'dict', label: '辭書形', note: '＋な' };
    if (f.key === 'nai') return { key: 'nai', label: '否定形', note: '不…' };
    if (f.key === 'te') return { key: 'te', label: 'て形（で）', note: '連接' };
    if (f.key === 'ba') return { key: 'ba', label: '條件形（なら）', note: '如果' };
    if (f.key === 'adv') return { key: 'adv', label: '副詞形（に）', note: '修飾動詞' };
    return f;
  });

  global.Conjugate = {
    FORMS: FORMS,
    I_ADJ_FORMS: I_ADJ_FORMS,
    NA_ADJ_FORMS: NA_ADJ_FORMS,
    verb: conjugateVerb,
    adj: conjugateAdj,
    /* 給任一單字產生活用表；不是動詞／形容詞就回 null */
    of: function (v) {
      if (/^動詞/.test(v.p)) {
        var g = v.p === '動詞I' ? 1 : v.p === '動詞II' ? 2 : 3;
        return { kind: 'verb', group: g, forms: FORMS, table: conjugateVerb(v.w, v.k, g) };
      }
      if (v.p === 'い形容詞') return { kind: 'い形容詞', forms: I_ADJ_FORMS, table: conjugateAdj(v.w, v.k, 'い') };
      if (v.p === 'な形容詞') return { kind: 'な形容詞', forms: NA_ADJ_FORMS, table: conjugateAdj(v.w, v.k, 'な') };
      return null;
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
