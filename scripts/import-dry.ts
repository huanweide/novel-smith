#!/usr/bin/env node
/**
 * import:dry —— 分章体检 CLI（M1 质量闸门）
 *
 * 用法：
 *   npm run import:dry -- <file>            # 人读报告
 *   npm run import:dry -- <file> --json     # 机器可读，便于回归比对
 *
 * 存在意义：导入的地基是「分章正确率」。先让这个 CLI 用真实小说 txt 把切分迭代对，
 * 再做 UI——否则 UI 写完才发现分章错位，整套返工。
 */

import { readFileSync, existsSync } from "node:fs";
import { basename } from "node:path";
import { parseToNovel, detectFormat, guessTitle } from "../src/lib/import/parsers";
import { checkHealth } from "../src/lib/import/types";

function parseArgs(argv: string[]) {
  const file = argv.find((a) => !a.startsWith("--"));
  const flags = new Set(argv.filter((a) => a.startsWith("--")));
  return {
    file,
    json: flags.has("--json"),
    encoding: argv.includes("--gbk") ? "gbk" : undefined,
    regex: argv.includes("--regex")
      ? argv[argv.indexOf("--regex") + 1]
      : undefined,
    show: argv.includes("--show") ? Number(argv[argv.indexOf("--show") + 1] || 3) : 0,
  };
}

async function main() {
  const { file, json, encoding, regex, show } = parseArgs(process.argv.slice(2));

  if (!file) {
    console.error("用法：npm run import:dry -- <文件路径> [--json] [--gbk] [--regex <正则>] [--show <N>]");
    process.exit(1);
  }
  if (!existsSync(file)) {
    console.error(`文件不存在：${file}`);
    process.exit(1);
  }

  const buf = readFileSync(file);
  const format = detectFormat(file);
  const novel = await parseToNovel(buf, {
    encoding,
    chapterRegex: regex,
    fileName: basename(file),
  });
  const health = checkHealth(novel);

  if (json) {
    console.log(
      JSON.stringify(
        {
          file,
          format,
          title: novel.title ?? guessTitle(file),
          encoding: novel.encoding,
          health,
          chapters: novel.chapters.map((c) => ({
            index: c.index,
            title: c.title,
            wordCount: c.wordCount,
            head: c.content.slice(0, 60),
          })),
        },
        null,
        2,
      ),
    );
    return;
  }

  // ── 人读报告 ──
  console.log("══════════════════════════════════════");
  console.log(`书名    : ${novel.title ?? guessTitle(file)}`);
  console.log(`文件    : ${basename(file)}  (${format ?? "未知格式"})`);
  console.log(`编码    : ${novel.encoding ?? "—"}`);
  console.log(`章节数  : ${health.chapterCount}`);
  console.log(`总字数  : ${health.totalWords.toLocaleString()}`);
  console.log(`平均/章 : ${health.avgWords.toLocaleString()}  (最短 ${health.minWords} / 最长 ${health.maxWords})`);
  console.log("══════════════════════════════════════");

  const listEnd = health.chapterCount > 30 ? 30 : health.chapterCount;
  console.log("\n章节清单（前 " + listEnd + " 章）：");
  novel.chapters.slice(0, listEnd).forEach((c) => {
    const flag = health.suspiciousShort.includes(c.index)
      ? " ⚠字数偏少"
      : health.suspiciousLong.includes(c.index)
        ? " ⚠字数偏长"
        : "";
    console.log(`  ${String(c.index).padStart(4)}. ${c.title}  (${c.wordCount} 字)${flag}`);
  });
  if (health.chapterCount > listEnd) {
    console.log(`  ... 其余 ${health.chapterCount - listEnd} 章省略`);
  }

  if (show > 0) {
    console.log("\n─── 正文预览 ───");
    for (const c of novel.chapters.slice(0, show)) {
      console.log(`\n【${c.title}】`);
      console.log(c.content.slice(0, 300).replace(/^/gm, "  "));
    }
  }

  if (health.warnings.length) {
    console.log("\n⚠ 告警：");
    for (const w of health.warnings) console.log(`  · ${w}`);
  } else {
    console.log("\n✓ 无告警");
  }
}

main().catch((e) => {
  console.error("解析失败：", e);
  process.exit(1);
});