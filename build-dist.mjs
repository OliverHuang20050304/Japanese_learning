/* 把要打包進桌面版的前端檔案複製到 dist/
   只收 index.html、css/、js/，不含 .git、tools/、src/ 的 PDF 等 */
import { cp, rm, mkdir, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(root, 'dist');
const ITEMS = ['index.html', 'css', 'js'];

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

for (const item of ITEMS) {
  const from = path.join(root, item);
  if (!existsSync(from)) throw new Error(`缺少 ${item}`);
  await cp(from, path.join(dist, item), { recursive: true });
}

async function walk(dir) {
  let n = 0, bytes = 0;
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { const r = await walk(p); n += r.n; bytes += r.bytes; }
    else { n++; bytes += (await stat(p)).size; }
  }
  return { n, bytes };
}
const { n, bytes } = await walk(dist);
console.log(`dist/ 完成：${n} 個檔案，${(bytes / 1024).toFixed(0)} KB`);
