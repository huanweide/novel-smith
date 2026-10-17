#!/usr/bin/env node

/**
 * Novel Smith 版本自动管理
 *
 * 用法：
 *   node scripts/bump-version.js "修复了什么" "改了什么"
 *   node scripts/bump-version.js --patch "修复了什么" "改了什么"
 *   node scripts/bump-version.js --minor "新增了什么"
 *   node scripts/bump-version.js --major "重磅更新"
 *   node scripts/bump-version.js --title "标题" --items "功能:改A,改B" --items "修复:修C"
 *
 * 自动做的事：
 *   1. 从 changelog-meta.ts 读取当前版本号（v3.1.115 起 LATEST_VERSION 唯一住处）
 *   2. 按规则 bump（--patch → 0.8.4, --minor → 0.9.0, --major → 1.0.0）
 *   3. 在 changelog-data.ts 的 VERSIONS 数组最前面插入新版本条目
 *   4. 更新 changelog-meta.ts 的 LATEST_VERSION
 *   5. 更新 changelog-meta.ts 的 CHANGELOG_BRIEF
 *   6. 写入文件
 *   7. 同步 README.md / README_EN.md 顶部的「当前版本」行（防版本漂移）
 *
 * 注意：package.json 的 version 与 CHANGELOG.md 条目仍需手动同步（本脚本不碰）。
 */

const fs = require("fs");
const path = require("path");

const META_PATH = path.join(__dirname, "..", "src", "lib", "changelog-meta.ts");
const DATA_PATH = path.join(__dirname, "..", "src", "lib", "changelog-data.ts");

// ─── 参数解析 ─────────────────────────────────────────────────

const args = process.argv.slice(2);

/** 解析 --key value 和位置参数 */
function parseArgs(rawArgs) {
  const opts = { bump: "patch", title: "", sections: [], items: [] };

  let i = 0;
  while (i < rawArgs.length) {
    const arg = rawArgs[i];
    if (arg === "--patch") { opts.bump = "patch"; i++; }
    else if (arg === "--minor") { opts.bump = "minor"; i++; }
    else if (arg === "--major") { opts.bump = "major"; i++; }
    else if (arg === "--title" && rawArgs[i + 1]) { opts.title = rawArgs[i + 1]; i += 2; }
    else if (arg === "--items" && rawArgs[i + 1]) { opts.items.push(rawArgs[i + 1]); i += 2; }
    else { opts.sections.push(arg); i++; }
  }

  return opts;
}

function getToday() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

// ─── 版本号计算 ───────────────────────────────────────────────

function bumpVersion(current, type) {
  const match = current.match(/^v?(\d+)\.(\d+)\.(\d+)$/);
  if (!match) {
    console.error(`❌ 无法解析版本号: ${current}`);
    process.exit(1);
  }
  let [, major, minor, patch] = match.map(Number);
  switch (type) {
    case "major": major++; minor = 0; patch = 0; break;
    case "minor": minor++; patch = 0; break;
    case "patch": patch++; break;
  }
  return `v${major}.${minor}.${patch}`;
}

// ─── 智能解析 sections 文本 ──────────────────────────────────

/**
 * 把自由文本解析为 sections 结构。
 *
 * 输入格式（支持多种）：
 *   "📋 大纲系统:改了一键生成,现在支持4/8/12章自选"
 *   "🐛 修复:修复了SSE卡死"
 *   "大纲改了一键生成"  （无前缀时默认 🔧）
 */
function parseSections(rawSections, title) {
  const sections = [];

  for (const raw of rawSections) {
    // 尝试匹配 "🏷 角色系统:项目1,项目2,项目3" 格式
    const match = raw.match(/^(.{1,4}?)\s+(.+?)[：:]\s*(.+)$/);
    if (match) {
      const [, emoji, label, itemsStr] = match;
      const items = itemsStr.split(/[,，、]/).map(s => s.trim()).filter(Boolean);
      sections.push({ label: `${emoji} ${label}`, items });
    } else {
      // 无格式 → 单条
      const labelMatch = raw.match(/^(.{1,4}?)\s+(.+)$/);
      if (labelMatch) {
        sections.push({ label: labelMatch[1] + " " + labelMatch[2], items: [] });
      } else {
        sections.push({ label: "🔧 改动", items: [raw] });
      }
    }
  }

  // 如果什么都没有，用一个默认的
  if (sections.length === 0) {
    sections.push({ label: "🔧 改动", items: ["未指定具体改动"] });
  }

  return sections;
}

// ─── 从 .ts 文件提取当前数据 ──────────────────────────────

function readCurrentVersion(fileContent) {
  const latMatch = fileContent.match(/export const LATEST_VERSION\s*=\s*"([^"]+)"/);
  if (!latMatch) {
    console.error("❌ 找不到 LATEST_VERSION");
    process.exit(1);
  }
  return latMatch[1];
}

// ─── 生成新的 changelog-meta.ts 内容 ────────────────────

function generateNewMeta(metaContent, newVersion, briefItems) {
  // 替换 LATEST_VERSION
  let result = metaContent.replace(
    /export const LATEST_VERSION\s*=\s*"[^"]+"/,
    `export const LATEST_VERSION = "${newVersion}"`
  );
  if (!result.includes(`LATEST_VERSION = "${newVersion}"`)) {
    throw new Error("LATEST_VERSION 替换失败（文件结构变了？），终止 bump");
  }

  // 替换 CHANGELOG_BRIEF
  const briefItemsStr = briefItems.map(item => `  "${item}",`).join("\n");
  result = result.replace(
    /export const CHANGELOG_BRIEF\s*=\s*\[[\s\S]*?\];/,
    `export const CHANGELOG_BRIEF = [\n${briefItemsStr}\n];`
  );
  if (!result.includes(`"${briefItems[0]}",`)) {
    throw new Error("CHANGELOG_BRIEF 替换失败，终止 bump");
  }

  return result;
}

// ─── 在 changelog-data.ts 的 VERSIONS 数组最前面插入条目 ──
//
// 行尾陷阱：changelog-data.ts 是 CRLF 行尾（Windows 编辑器历史遗留），
// 正则里写死 \n 会匹配不上，而 String.replace 不匹配时静默返回原串——
// 表现就是「bump 成功但 VERSIONS 没插入」。所以：① 正则兼容 \r?\n；
// ② 插入后校验，没插进去直接 throw，不许静默写回。

function insertVersionsEntry(dataContent, newEntry) {
  const eol = dataContent.includes("\r\n") ? "\r\n" : "\n";
  const entry = newEntry.replace(/\n/g, eol);
  const re = /(export const VERSIONS: VersionEntry\[\] = \[)(\r?\n)(\s*\{)/;
  if (!re.test(dataContent)) {
    throw new Error("VERSIONS 数组声明没匹配到（文件结构变了？），终止 bump，避免静默丢失插入");
  }
  const out = dataContent.replace(re, `$1$2${entry}$2$3`);
  if (!out.includes(`version: "${entry.match(/version: "([^"]+)"/)[1]}"`)) {
    throw new Error("VERSIONS 插入后校验失败，终止 bump");
  }
  return out;
}

// ─── 生成公告摘要 ───────────────────────────────────────

function generateBrief(sections) {
  const briefs = [];
  for (const s of sections.slice(0, 3)) {
    if (s.items.length > 0) {
      briefs.push(`${s.label}: ${s.items.slice(0, 2).join("，")}`);
    }
  }
  if (briefs.length === 0 && sections.length > 0) {
    briefs.push(sections[0].label);
  }
  return briefs;
}

// ─── 同步 README 版本行（根治版本漂移）──────────────────────
//
// 背景：此前 bump 只改 changelog-data.ts，README.md / README_EN.md 的版本号
// 长期停在旧版本（实测 README 停在 v3.1.60、英文停在 v3.1.57，而实际已 v3.1.92），
// 访客第一眼看到"落后几十个版本"直接损害可信度与 Star 意愿。
// 现在把 README 版本行同步纳入 bump 流程，从流程上杜绝复发。

function syncReadmeVersion(newVersion) {
  const targets = [
    {
      file: path.join(__dirname, "..", "README.md"),
      re: /\*\*当前版本：v[\d.]+\*\*/,
      replace: `**当前版本：${newVersion}**`,
    },
    {
      file: path.join(__dirname, "..", "README_EN.md"),
      re: /\*\*Current Version: v[\d.]+\*\*/,
      replace: `**Current Version: ${newVersion}**`,
    },
  ];

  const synced = [];
  const skipped = [];
  for (const t of targets) {
    if (!fs.existsSync(t.file)) {
      skipped.push(`${path.basename(t.file)}（文件不存在）`);
      continue;
    }
    const content = fs.readFileSync(t.file, "utf-8");
    if (!t.re.test(content)) {
      skipped.push(`${path.basename(t.file)}（未找到版本行，请手工检查格式）`);
      continue;
    }
    fs.writeFileSync(t.file, content.replace(t.re, t.replace), "utf-8");
    synced.push(path.basename(t.file));
  }
  return { synced, skipped };
}

// ═══════════════════════════════════════════════════════════════
// 主流程
// ═══════════════════════════════════════════════════════════════

const opts = parseArgs(args);

// 读取现有文件
const metaContent = fs.readFileSync(META_PATH, "utf-8");
const dataContent = fs.readFileSync(DATA_PATH, "utf-8");
const currentVersion = readCurrentVersion(metaContent);

// 计算新版本号
const newVersion = bumpVersion(currentVersion, opts.bump);
const date = getToday();

// 如果有 --items 参数，用它们覆盖 sections
let sections;
if (opts.items.length > 0) {
  sections = opts.items.map(raw => {
    const match = raw.match(/^(.+?)[：:]\s*(.+)$/);
    if (match) {
      return { label: match[1].trim(), items: match[2].split(/[,，、]/).map(s => s.trim()).filter(Boolean) };
    }
    return { label: "🔧 改动", items: [raw] };
  });
} else {
  sections = parseSections(opts.sections, opts.title);
}

// 生成公告摘要
const briefItems = generateBrief(sections);

// 标题默认为第一个 section 的 label
const title = opts.title || sections[0]?.label || "更新";

// 组装 VERSIONS 新条目
const sectionsStr = sections.map(s =>
  `      {\n        label: "${s.label}",\n        items: [\n${s.items.map(item => `          "${item}",`).join("\n")}\n        ],\n      },`
).join("\n");

const newEntry = `  {
    version: "${newVersion}",
    date: "${date}",
    title: "${title}",
    sections: [
${sectionsStr}
    ],
  },`;

// 生成新文件（meta 改版本号/摘要，data 插 VERSIONS 条目）
const newMeta = generateNewMeta(metaContent, newVersion, briefItems);
const newData = insertVersionsEntry(dataContent, newEntry);

// 写入
fs.writeFileSync(META_PATH, newMeta, "utf-8");
fs.writeFileSync(DATA_PATH, newData, "utf-8");

// 同步 README / README_EN 顶部的「当前版本」行（防版本漂移复发）
const { synced, skipped } = syncReadmeVersion(newVersion);

// ─── 输出 ─────────────────────────────────────────────────────

console.log(`\n✅ 版本已更新: ${currentVersion} → ${newVersion}`);
console.log(`📅 日期: ${date}`);
console.log(`📝 标题: ${title}`);
console.log(`📋 公告摘要:`);
briefItems.forEach((b, i) => console.log(`   ${i + 1}. ${b}`));
console.log(`\n📂 文件: ${META_PATH} + ${DATA_PATH}`);
if (synced.length > 0) console.log(`📄 README 版本行已同步: ${synced.join(" / ")}`);
if (skipped.length > 0) console.log(`⚠️  README 版本行未同步: ${skipped.join(" / ")}`);
console.log(`\n下一步（本脚本不碰的两处，记得手动同步）:`);
console.log(`   1. package.json 的 version → ${newVersion.replace(/^v/, "")}`);
console.log(`   2. CHANGELOG.md 顶部插入 ${newVersion} 完整条目`);
console.log(`   git add src/lib/changelog-meta.ts src/lib/changelog-data.ts package.json CHANGELOG.md`);
console.log(`   git commit -m "chore: bump to ${newVersion}"`);
console.log();
