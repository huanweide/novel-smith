/**
 * M1 语料回归闸门：把 Downloads 下所有大txt/epub 跑一遍 parseToNovel，
 * 打印一行摘要（编码/章数/健康度），用于人工核对分章正确率。
 * 这是「拿真实小说迭代分章器」这条判据的自动化形态——语料是现成的，
 * 每次改splitter/parser 都该跑一遍，看有没有大批量退化。
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { parseToNovel } from "../src/lib/import/parsers";
import { checkHealth } from "../src/lib/import/types";

const ROOTS = [
  "C:/Users/Administrator/Downloads",
  "C:/Users/Administrator/Downloads/Telegram Desktop",
  "C:/Users/Administrator/Downloads/Telega Desktop",
];

function walk(dir: string, depth = 0): string[] {
  if (depth > 2) return [];
  const out: string[] = [];
  let entries: string[] = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = join(dir, e);
    try {
      const st = statSync(p);
      if (st.isDirectory()) out.push(...walk(p, depth + 1));
      else if (/\.(txt|epub)$/i.test(e) && st.size > 200_000) out.push(p);
    } catch {
      /* 跳过无权限项 */
    }
  }
  return out;
}

async function main() {
  const files = Array.from(new Set(ROOTS.flatMap((r) => walk(r)))).sort();
  console.log(`语料：${files.length} 个文件（>200KB 的 txt/epub）\n`);

  let bad = 0;
  for (const f of files) {
    try {
      const r = await parseToNovel(readFileSync(f), { fileName: f });
      const h = checkHealth(r);
      const name = f.split(/[\\/]/).pop()!.slice(0, 24);
      const warn = h.warnings.filter((w) => !w.includes("BOM")).length;
      const flag = r.chapters.length === 0 ? "✗空" : warn > 2 ? "△" : "✓";
      if (flag !== "✓") bad++;
      console.log(
        `${flag} ${name.padEnd(26)} ${(r.chapters.length + "章").padStart(6)} ` +
        `${String(h.totalWords).padStart(8)}字 章均${String(h.avgWords).padStart(6)} ` +
        `${String(r.encoding ?? "-").padEnd(10)} 告警${warn}`,
      );
      if (flag !== "✓") {
        for (const w of h.warnings.slice(0, 3)) console.log(`     · ${w.slice(0, 90)}`);
      }
    } catch (e) {
      bad++;
      console.log(`✗ ${f.split(/[\\/]/).pop()!.slice(0, 24)} 解析异常：${(e as Error).message.slice(0, 70)}`);
    }
  }
  console.log(`\n合计：${files.length - bad} 正常/ ${bad} 需人工确认`);
}

void main();