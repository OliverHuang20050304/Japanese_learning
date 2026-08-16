/* 產生例句的假名標註（建置期工具，執行結果直接寫回 js/data/*.js）
   用 kuromoji 斷詞取得讀音，對齊漢字後輸出括號記法：
     朝[あさ]は元気[げんき]に挨拶[あいさつ]をしましょう。
   執行期只需解析這個字串，不必載入辭典。

   用法：node tools/furigana.mjs [--dry]
*/
import kuromoji from 'kuromoji';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { NUM, PHRASE } from './furigana-fixes.mjs';

const require = createRequire(import.meta.url);
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dataDir = path.join(root, 'js', 'data');
const DRY = process.argv.includes('--dry');

const KANJI = /[一-龯々〆]/;
const kata2hira = (s) => s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/* 把「漢字表記」與「讀音」對齊，切成 {t 文字, r 讀音} 的片段 */
function align(surface, reading) {
  if (!KANJI.test(surface)) return [{ t: surface, r: null }];
  if (!reading) return null;
  const segs = surface.match(/[一-龯々〆]+|[^一-龯々〆]+/g);
  let pattern = '^';
  for (const s of segs) pattern += KANJI.test(s[0]) ? '(.+?)' : escapeRe(kata2hira(s));
  pattern += '$';
  const m = kata2hira(reading).match(new RegExp(pattern));
  if (!m) return null;
  let gi = 1;
  return segs.map((s) => (KANJI.test(s[0]) ? { t: s, r: m[gi++] } : { t: s, r: null }));
}

function toBracket(parts) {
  return parts.map((p) => (p.r ? `${p.t}[${p.r}]` : p.t)).join('');
}

const NUMCHAR = /^[一二三四五六七八九十百千万何]+$/;
const COUNTER = /^(人|時|分|日|時間|週間|か月|年|年間|日間|回|階|杯|冊|個|歳|枚|匹|台|本|点|足|度|番|緒|倍|面|円)$/;

/* kuromoji 會把「三十分」拆成三/十/分，各自的讀音串起來會錯，
   這裡先把數字與量詞合併成一個單位，再查修正表。 */
function mergeNumbers(parts) {
  const out = [];
  for (const p of parts) {
    const prev = out[out.length - 1];
    if (prev && prev.r && p.r && NUMCHAR.test(prev.t) && (NUMCHAR.test(p.t) || COUNTER.test(p.t))) {
      prev.t += p.t; prev.r += p.r; prev.merged = true;
    } else out.push({ ...p });
  }
  for (const p of out) if (p.r && NUM[p.t]) p.r = NUM[p.t];
  return out;
}

function applyPhraseFixes(s) {
  let out = s;
  for (const [from, to] of PHRASE) out = out.split(from).join(to);
  return out;
}

/* 讀出每個資料檔的單字（保留檔案歸屬，之後照原檔寫回） */
function loadFile(file) {
  const g = { window: {} };
  const src = readFileSync(path.join(dataDir, file), 'utf8');
  new Function('window', src)(g.window);
  return { entries: g.window.VOCAB_RAW || [], header: src.split('\n')[0] };
}

const tokenizer = await new Promise((res, rej) =>
  kuromoji.builder({ dicPath: path.join(root, 'node_modules', 'kuromoji', 'dict') })
    .build((err, tk) => (err ? rej(err) : res(tk))));

const files = readdirSync(dataDir).filter((f) => f.endsWith('.js')).sort();
let total = 0, annotated = 0, noKanji = 0;
const unresolved = [], mismatches = [];

for (const file of files) {
  const { entries, header } = loadFile(file);

  for (const v of entries) {
    for (const ex of v.ex) {
      const ja = ex[0];
      total++;
      const tokens = tokenizer.tokenize(ja);
      let acc = [], bad = false;
      for (const t of tokens) {
        const parts = align(t.surface_form, t.reading);
        if (parts === null) { acc.push({ t: t.surface_form, r: null }); if (KANJI.test(t.surface_form)) bad = true; }
        else acc.push(...parts);
      }
      let out = applyPhraseFixes(toBracket(mergeNumbers(acc)));
      /* 完整性：把所有 [..] 拿掉必須還原成原句 */
      if (out.replace(/\[[^\]]*\]/g, '') !== ja) {
        unresolved.push(`${v.w}：還原後與原句不符 → ${out}`);
        ex[2] = ja;
        continue;
      }
      if (bad) unresolved.push(`${v.w}：有漢字取不到讀音 → ${ja}`);
      if (!KANJI.test(ja)) noKanji++; else annotated++;
      ex[2] = out;

      /* 交叉檢查：把字典的「漢字↔假名」也做一次對齊，比對同一組漢字的讀音 */
      if (v.w !== v.k && KANJI.test(v.w) && ja.includes(v.w)) {
        const want = align(v.w, v.k);
        if (want) {
          const wantMap = new Map(want.filter((x) => x.r).map((x) => [x.t, x.r]));
          for (const [, kanji, read] of out.matchAll(/([一-龯々〆]+)\[([^\]]+)\]/g)) {
            if (wantMap.has(kanji) && wantMap.get(kanji) !== read) {
              mismatches.push(`${v.w}（${v.k}）：句中 ${kanji}[${read}]，字典為 ${kanji}[${wantMap.get(kanji)}] ← ${ja}`);
            }
          }
        }
      }
    }
  }

  if (!DRY) {
    const q = (s) => JSON.stringify(s);
    const body = entries.map((v) =>
      `{w:${q(v.w)},k:${q(v.k)},p:${q(v.p)},m:${q(v.m)},ex:[\n` +
      v.ex.map((e) => `["${e[0]}",${q(e[1])},${q(e[2])}]`).join(',\n') + `]}`).join(',\n');
    writeFileSync(path.join(dataDir, file),
      `${header}\n(window.VOCAB_RAW=window.VOCAB_RAW||[]).push(\n${body}\n);\n`);
  }
}

console.log(`例句共 ${total} 句：含漢字並已標註 ${annotated}，全假名不需標註 ${noKanji}`);
if (unresolved.length) {
  console.log(`\n⚠ 無法標註 ${unresolved.length} 句：`);
  unresolved.slice(0, 20).forEach((x) => console.log('  ' + x));
} else console.log('✓ 每一句都完整標註，且移除標註後都能還原成原句');
if (mismatches.length) {
  console.log(`\n⚠ 與字典讀音不一致 ${mismatches.length} 處（需人工確認）：`);
  mismatches.slice(0, 30).forEach((x) => console.log('  ' + x));
} else console.log('✓ 標註讀音與字典讀音一致');
