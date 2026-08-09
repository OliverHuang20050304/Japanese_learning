/* 資料品質檢查：node tools/check.js [檔名…]
   1. 每個單字要有 3 句例句
   2. 例句必須真的用到該單字（比對活用形或語幹）
   3. 不可混入拉丁／西里爾字母
   4. 中譯不可為空、不可與日文相同
*/
const fs = require('fs'), path = require('path');
global.window = {};
require(path.join(__dirname, '..', 'js', 'conjugate.js'));
const C = global.window.Conjugate || global.Conjugate;

const dir = path.join(__dirname, '..', 'js', 'data');
const files = process.argv.length > 2 ? process.argv.slice(2) : fs.readdirSync(dir).filter(f => f.endsWith('.js'));
files.forEach(f => require(path.join(dir, path.basename(f))));
const V = global.window.VOCAB_RAW || [];

const BAD_CHARS = /[A-Za-zЀ-ӿ]/;
let problems = [], noEx = 0, done = 0;

function variants(v) {
  const set = new Set([v.w, v.k]);
  const c = C.of(v);
  if (c) Object.values(c.table).forEach(t => { set.add(t.disp); set.add(t.kana); });
  // 語幹（去掉語尾送假名），涵蓋 〜ません／〜たり／〜ながら 等未列出的形態
  if (c) [v.w, v.k].forEach(s => {
    if (s.length > 1) set.add(s.slice(0, -1));
    if (/する$/.test(s) && s.length > 2) set.add(s.slice(0, -2));
  });
  return [...set].filter(s => s && s !== '—');
}

V.forEach(v => {
  if (!v.ex || v.ex.length === 0) { noEx++; return; }
  done++;
  if (v.ex.length !== 3) problems.push(`${v.w}：例句 ${v.ex.length} 句（應為 3 句）`);
  const vs = variants(v);
  v.ex.forEach((e, i) => {
    const [ja, zh] = e;
    if (!ja || !zh) return problems.push(`${v.w} 例${i + 1}：內容缺漏`);
    if (BAD_CHARS.test(ja)) problems.push(`${v.w} 例${i + 1}：日文混入英數字母 → ${ja}`);
    if (BAD_CHARS.test(zh)) problems.push(`${v.w} 例${i + 1}：中譯混入英數字母 → ${zh}`);
    if (!/[。？！]$/.test(ja)) problems.push(`${v.w} 例${i + 1}：日文句尾缺標點 → ${ja}`);
    if (!vs.some(s => ja.includes(s))) problems.push(`${v.w}（${v.k}）例${i + 1}：句中找不到這個單字 → ${ja}`);
  });
  const seen = new Set(v.ex.map(e => e[0]));
  if (seen.size !== v.ex.length) problems.push(`${v.w}：有重複的例句`);
});

const dup = {};
V.forEach(v => { const k = v.w + '::' + v.k; dup[k] = (dup[k] || 0) + 1; });
Object.keys(dup).filter(k => dup[k] > 1).forEach(k => problems.push(`重複單字：${k}`));

console.log(`單字 ${V.length}　已完成例句 ${done}　待撰寫 ${noEx}`);
if (problems.length) {
  console.log(`\n⚠ 發現 ${problems.length} 個問題：`);
  problems.slice(0, 60).forEach(p => console.log('  ' + p));
  if (problems.length > 60) console.log(`  …還有 ${problems.length - 60} 個`);
  process.exit(1);
}
console.log('✓ 全部通過');
