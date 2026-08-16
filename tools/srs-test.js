/* SRS 排程邏輯測試：node tools/srs-test.js */
const path = require('path');
global.window = {};
require(path.join(__dirname, '..', 'js', 'srs.js'));
const S = global.window.SRS;

let pass = 0, fail = 0;
function ok(cond, msg) { cond ? pass++ : (fail++, console.log('  ✗ ' + msg)); }
function eq(a, b, msg) { ok(a === b, msg + `（得到 ${JSON.stringify(a)}，應為 ${JSON.stringify(b)}）`); }

const D = '2026-08-16';

/* --- 日期工具 --- */
eq(S.addDays(D, 1), '2026-08-17', 'addDays 跨日');
eq(S.addDays(D, 16), '2026-09-01', 'addDays 跨月');
eq(S.addDays('2026-12-31', 1), '2027-01-01', 'addDays 跨年');
eq(S.daysBetween('2026-08-16', '2026-08-19'), 3, 'daysBetween');

/* --- 評分：連續答對，間隔要照表拉長 --- */
let r = null, day = D;
const wantIntervals = [1, 3, 7, 14, 30, 90];
wantIntervals.forEach((iv, i) => {
  r = S.grade(r, 'good', day);
  eq(r.lv, i + 1, `連續答對第 ${i + 1} 次的等級`);
  eq(r.due, S.addDays(day, iv), `Lv.${i + 1} 的下次複習日應為 +${iv} 天`);
  day = r.due;
});
r = S.grade(r, 'good', day);
eq(r.lv, 6, '等級不會超過上限 6');

/* --- 答錯要打回第一級 --- */
let r2 = { lv: 5, seen: 9, right: 9 };
r2 = S.grade(r2, 'again', D);
eq(r2.lv, 1, '答「不會」歸到 Lv.1');
eq(r2.due, '2026-08-17', '答「不會」明天再考');
eq(r2.lapse, 1, '記錄遺忘次數');

/* --- 模糊：不升級也不歸零 --- */
let r3 = S.grade({ lv: 3 }, 'hard', D);
eq(r3.lv, 3, '答「模糊」維持原等級');
eq(r3.due, '2026-08-17', '答「模糊」明天再考');

/* --- 到期判斷 --- */
ok(S.isDue({ due: '2026-08-15' }, D), '過期的要複習');
ok(S.isDue({ due: D }, D), '今天到期的要複習');
ok(!S.isDue({ due: '2026-08-17' }, D), '還沒到期的不複習');
ok(!S.isDue(null, D), '沒有紀錄不算到期');

/* --- 固定隨機順序 --- */
const vocab = Array.from({ length: 50 }, (_, i) => ({ id: 'w' + i }));
const st = { srs: {}, settings: { newPerDay: 10 } };
S.ensureOrder(st, vocab);
eq(st.order.length, 50, '學習順序涵蓋全部單字');
eq(new Set(st.order).size, 50, '學習順序沒有重複');
const first = st.order.slice();
S.ensureOrder(st, vocab);
eq(st.order.join(), first.join(), '再次呼叫不會重新洗牌（順序固定）');
ok(first.join() !== vocab.map(v => v.id).join(), '順序確實被打亂，不是原本的排列');

/* 新增單字要補在後面，不影響既有順序 */
const vocab2 = vocab.concat([{ id: '新1' }, { id: '新2' }]);
S.ensureOrder(st, vocab2);
eq(st.order.length, 52, '新增的字被加入順序');
eq(st.order.slice(0, 50).join(), first.join(), '既有順序不受新增影響');

/* --- 佇列 --- */
const st2 = { srs: {}, settings: { newPerDay: 10 }, order: first };
let q = S.buildQueue(vocab, st2, D);
eq(q.fresh.length, 10, '每日新字量預設 10');
eq(q.review.length, 0, '沒有紀錄就沒有複習');
eq(q.fresh[0].v.id, first[0], '新字照固定隨機順序取');

st2.srs[first[0]] = { lv: 2, due: '2026-08-10' };
st2.srs[first[1]] = { lv: 3, due: '2026-09-30' };
q = S.buildQueue(vocab, st2, D);
eq(q.review.length, 1, '只取到期的字來複習');
eq(q.review[0].v.id, first[0], '到期的是逾期那一個');
eq(q.fresh.length, 10, '已學過的字不會再被當成新字');
ok(!q.fresh.some(f => f.v.id === first[0] || f.v.id === first[1]), '新字不含已有紀錄的字');

/* 今天已學過的新字要從額度扣掉 */
st2.daily = { date: D, newDone: 4 };
eq(S.buildQueue(vocab, st2, D).fresh.length, 6, '當日剩餘新字額度');
st2.daily = { date: '2026-08-15', newDone: 9 };
eq(S.buildQueue(vocab, st2, D).fresh.length, 10, '隔天額度重置');

/* --- 交錯 --- */
const mix = S.interleave(
  Array.from({ length: 6 }, (_, i) => ({ id: 'r' + i, isNew: false })),
  Array.from({ length: 2 }, (_, i) => ({ id: 'n' + i, isNew: true })));
eq(mix.length, 8, '交錯後總數不變');
ok(mix[0].isNew === false, '複習排在最前面');
ok(mix.findIndex(x => x.isNew) < mix.length - 1, '新字被穿插在中間而非全擠在最後');
eq(S.interleave([], [{ id: 'a' }]).length, 1, '沒有複習時只出新字');
eq(S.interleave([{ id: 'a' }], []).length, 1, '沒有新字時只出複習');

/* --- 連續天數 --- */
const stk = {};
S.touchStreak(stk, '2026-08-14'); eq(stk.streak.days, 1, '第一天連續 1');
S.touchStreak(stk, '2026-08-15'); eq(stk.streak.days, 2, '隔天累加');
S.touchStreak(stk, '2026-08-15'); eq(stk.streak.days, 2, '同一天不重複累加');
S.touchStreak(stk, '2026-08-17'); eq(stk.streak.days, 1, '中斷後重新計算');
eq(S.currentStreak(stk, '2026-08-18'), 1, '昨天有學，連續仍成立');
eq(S.currentStreak(stk, '2026-08-20'), 0, '中斷超過一天顯示 0');

/* --- 統計 --- */
const stc = { srs: { w0: { lv: 1 }, w1: { lv: 4 }, w2: { lv: 6 } } };
const lc = S.levelCounts(vocab, stc);
eq(lc.studied, 3, '學過的字數');
eq(lc.untouched, 47, '未學的字數');
eq(lc.mastered, 2, '已熟（Lv≥4）的字數');

console.log(`\n通過 ${pass} 項${fail ? `，失敗 ${fail} 項` : '，全部通過 ✓'}`);
process.exit(fail ? 1 : 0);
