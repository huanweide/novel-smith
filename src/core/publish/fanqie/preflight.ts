// ============================================================
// 番茄小说发布 · 发布前体检（纯函数，零 IO，可单测）
// ============================================================
//
// 为什么要有这一层：
//   番茄的处罚逻辑是「提醒/驳回后仍不整改」才升级（见 2026-02 治理公告）。
//   所以在**发出去之前**就把不合规的稿子拦住，比发出去被驳回再改要安全得多。
//
// 每一項都给「实测数字 + 可执行建议」，不做黑箱评分：
//   - 字数：1000 字是签约作品硬门槛，1800-2600 是最佳区间
//   - 段落：超过 120 字的段落在手机上是一堵墙
//   - AI 味：直接复用 humanize 的规则引擎（本地、可解释、带证据）
//   - 对话：番茄重对话推进，通篇叙述+念稿腔对话是最容易被读者划走的
//   - 重复：连续段落同一开头 = 模板感
//   - 标点：连续感叹号/问号、全半角混用会被判格式问题

import { analyzeText } from "../../humanize";
import { countWords, formatChapterTitle, formatForPlatform } from "../pipeline";
import {
  FANQIE_BEST_WORDS,
  FANQIE_MAX_PARAGRAPH,
  FANQIE_MIN_WORDS,
  type PreflightItem,
  type PreflightResult,
  type PreflightStats,
} from "./types";

function splitParagraphs(text: string): string[] {
  return (text || "")
    .split(/\n+/)
    .map((p) => p.trim())
    .filter(Boolean);
}

/** 对话占比：统计被引号包住的字符数 / 总字数（中文引号与英文引号都认） */
function dialogueRatio(text: string): number {
  const total = countWords(text);
  if (total === 0) return 0;
  const matches = (text || "").match(/[「“"][^」”"]{1,400}[」”"]/g) || [];
  const inDialogue = matches.reduce((sum, m) => sum + countWords(m), 0);
  return Math.min(1, inDialogue / total);
}

export interface PreflightInput {
  title: string;
  content: string;
  /** 章节序号（1 起），用于标题格式校验 */
  chapterOrder: number;
}

/**
 * 体检一章稿子。
 *
 * pass=false 时**禁止发布**（不是建议，是硬拦截）：字数不足 1000 会被平台直接拦，
 * 发出去只是白跑一趟还会留下「更新失败」记录。
 */
export function preflightChapter(input: PreflightInput): PreflightResult {
  const content = input.content || "";
  const title = (input.title || "").trim();
  const words = countWords(content);
  const paragraphs = splitParagraphs(content);
  const items: PreflightItem[] = [];

  // 1. 字数（硬门槛）
  const wordsOk = words >= FANQIE_MIN_WORDS;
  const wordsBest = words >= FANQIE_BEST_WORDS.min && words <= FANQIE_BEST_WORDS.max;
  items.push({
    id: "words",
    label: "章节字数",
    level: wordsOk ? (wordsBest ? "ok" : "warn") : "block",
    pass: wordsOk,
    detail: `${words} 字（门槛 ${FANQIE_MIN_WORDS}，最佳 ${FANQIE_BEST_WORDS.min}-${FANQIE_BEST_WORDS.max}）`,
    hint: wordsOk
      ? wordsBest
        ? undefined
        : words < FANQIE_BEST_WORDS.min
          ? "偏短：补一段场景或对话推进，别靠回忆凑"
          : "偏长：把后半段拆到下一章，番茄读者吃短章"
      : `差 ${FANQIE_MIN_WORDS - words} 字才到平台门槛，低于这个数发出去会被直接拦`,
  });

  // 2. 段落长度
  const longParas = paragraphs.filter((p) => p.length > FANQIE_MAX_PARAGRAPH);
  const longRatio = paragraphs.length > 0 ? longParas.length / paragraphs.length : 0;
  const paraOk = longRatio <= 0.3;
  items.push({
    id: "paragraph",
    label: "段落长度",
    level: paraOk ? "ok" : "warn",
    pass: paraOk,
    detail: `${paragraphs.length} 段，超 ${FANQIE_MAX_PARAGRAPH} 字的 ${longParas.length} 段（${Math.round(longRatio * 100)}%）`,
    hint: paraOk ? undefined : "粘贴前先跑「按番茄排版」自动切长段，手机会好读很多",
  });

  // 3. AI 味（复用本地规则引擎，带证据）
  // 两个判据一起看：
  //   · aiScore（0-100）：句子机械度、AI 高频词、排比句式综合分；
  //   · hitsPerK（每千字命中数）：实测「通篇同一种套话」的稿子 aiScore 只有 45，
  //     但每千字命中 28 处——密度才是「一个味道」的直接证据。
  // 人类稿通常 < 8 处/千字；AI 稿普遍 15+。
  const report = analyzeText(content);
  const hitsPerK = words > 0 ? (report.hits.length / words) * 1000 : 0;
  const aiBlock = report.score >= 60 || hitsPerK >= 18;
  const aiClean = report.score < 30 && hitsPerK < 8;
  const aiLevel: PreflightItem["level"] = aiBlock ? "block" : aiClean ? "ok" : "warn";
  const aiOk = !aiBlock;
  items.push({
    id: "aiTrace",
    label: "AI 痕迹",
    level: aiLevel,
    pass: aiOk,
    detail: `AI 痕迹 ${report.score}/100（${report.levelLabel}），每千字命中 ${hitsPerK.toFixed(1)} 处，共 ${report.hits.length} 处`,
    hint: aiOk
      ? undefined
      : report.byRule
          .slice(0, 3)
          .map((r) => `${r.ruleName}×${r.count}`)
          .join("、") + " —— 去「过审自检」面板逐条改掉再发",
  });

  // 4. 对话占比
  const dRatio = dialogueRatio(content);
  const dialogueSane = dRatio >= 0.12 && dRatio <= 0.75;
  items.push({
    id: "dialogue",
    label: "对话推进",
    level: dialogueSane ? "ok" : "warn",
    pass: dialogueSane,
    detail: `对话占比 ${Math.round(dRatio * 100)}%（番茄健康区间 12%-75%）`,
    hint:
      dRatio < 0.12
        ? "通篇叙述容易闷：至少让两个角色开口说话，把信息藏在对话里"
        : dRatio > 0.75
          ? "几乎全是对话：补一点动作与环境，否则读起来像剧本"
          : undefined,
  });

  // 5. 段落开头重复（模板感）
  const heads = paragraphs.map((p) => p.slice(0, 4)).filter((h) => h.length >= 2);
  const headCount = new Map<string, number>();
  for (const h of heads) headCount.set(h, (headCount.get(h) || 0) + 1);
  const worstHead = Array.from(headCount.entries()).sort((a, b) => b[1] - a[1])[0];
  const repeatBad = !!worstHead && worstHead[1] >= 4;
  items.push({
    id: "repeat",
    label: "段落开头",
    level: repeatBad ? "warn" : "ok",
    pass: !repeatBad,
    detail: worstHead ? `最高重复「${worstHead[0]}…」出现 ${worstHead[1]} 次` : "无重复开头",
    hint: repeatBad ? "同一开头连着出现像模板：换主语、换句式，或把其中两段并成一段" : undefined,
  });

  // 6. 标点格式
  const repeatedPunct = (content.match(/[！!？?]{2,}/g) || []).length;
  const halfWidthComma = (content.match(/[a-zA-Z0-9]{1},[a-zA-Z0-9]{1}/g) || []).length;
  const punctOk = repeatedPunct <= 3 && halfWidthComma === 0;
  items.push({
    id: "punctuation",
    label: "标点格式",
    level: punctOk ? "ok" : "warn",
    pass: punctOk,
    detail: `连用感叹/问号 ${repeatedPunct} 处，半角逗号夹中文 ${halfWidthComma} 处`,
    hint: punctOk ? undefined : "中文正文用全角标点；感叹号连用最多留一个",
  });

  // 7. 标题
  const titleOk = !!title && title.length <= 30 && !/^第\s*0\s*章/.test(title);
  items.push({
    id: "title",
    label: "章节标题",
    level: titleOk ? "ok" : "warn",
    pass: titleOk,
    detail: title ? `「${title}」${title.length} 字` : "标题为空",
    hint: titleOk ? undefined : "标题建议「第N章 具体事件」，不超过 30 字",
  });

  const stats: PreflightStats = {
    words,
    paragraphs: paragraphs.length,
    avgParagraphChars: paragraphs.length > 0 ? Math.round(words / paragraphs.length) : 0,
    longParagraphRatio: longRatio,
    dialogueRatio: dRatio,
    aiScore: report.score,
    aiLevel: report.levelLabel,
    hitsPerK,
  };

  // 质量分：60 分起步，按各项扣分，最后按字数是否在最佳区间加分
  let score = 100;
  for (const it of items) {
    if (it.level === "block") score -= 35;
    else if (it.level === "warn") score -= 8;
  }
  if (!wordsBest) score -= 5;
  score = Math.max(0, Math.min(100, score));

  return {
    pass: items.every((it) => it.level !== "block"),
    score,
    items,
    stats,
    checkedAt: new Date().toISOString(),
  };
}

export interface ChapterPreflightRow {
  nodeId: string;
  /** 章节序号（1 起） */
  chapterOrder: number;
  title: string;
  /** 排版后的正文（番茄口径）。默认不返回，避免整本书正文塞进诊断响应 */
  content?: string;
  wordCount: number;
  preflight: PreflightResult;
}

/**
 * 批量体检一本书的所有章节（工作台「发布与过检」面板与发布台共用同一份判据）。
 *
 * 为什么放在这里而不是各页面各写一套：番茄的规矩只应该有一个实现。
 * 之前工作台只做字数诊断、发布台才有深度体检，用户要在两个页面看两套结论——
 * 同一条内容两处判断不一致，比没有检查更糟。
 *
 * @param withContent 是否返回排版后的正文；诊断场景不要开（整本书正文体积很大）
 */
export function preflightChapters(
  nodes: Array<{ id: string; order: number; title?: string | null; content?: string | null }>,
  options: { withContent?: boolean } = {},
): ChapterPreflightRow[] {
  return (nodes || [])
    .filter((n) => n && (n.content || "").trim())
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((n, i) => {
      const chapterOrder = i + 1;
      const title = formatChapterTitle(n.title, chapterOrder - 1, "fanqie");
      const content = formatForPlatform(n.content || "", "fanqie");
      return {
        nodeId: n.id,
        chapterOrder,
        title,
        ...(options.withContent ? { content } : {}),
        wordCount: countWords(content),
        preflight: preflightChapter({ title, content, chapterOrder }),
      };
    });
}
