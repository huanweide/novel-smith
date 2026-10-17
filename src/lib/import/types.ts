/**
 * 导入小说 · 统一中间格式（M1 契约）
 *
 * 所有格式解析器（txt / markdown / epub / docx / pdf）**统一产出 ParsedNovel**，
 * 上层（切章节 → 落库 → 建前史资产）只认这一个结构。新增格式 = 新增一个 parser，
 * 不动任何下游代码。
 */

import type { Encoding } from "./encoding";

/** 单章 */
export interface ParsedChapter {
  /** 从 1 开始 */
  index: number;
  title: string;
  content: string;
  wordCount: number;
}

/** 整本解析结果 */
export interface ParsedNovel {
  /** 书名：优先元数据，其次文件名 */
  title?: string;
  chapters: ParsedChapter[];
  /** 实际解码编码（仅纯文本格式有意义） */
  encoding?: Encoding | null;
  /** 解析告警（未识别、疑似乱码、章数异常等）——一律往这里塞，不要静默失败 */
  warnings: string[];
}

/** 支持的输入格式 */
export type ImportFormat = "txt" | "markdown" | "epub" | "docx" | "pdf";

/**
 * 中文字数统计。
 * 约定：汉字按 1 计，连续拉丁字母/数字串按 1 个词计（跟大多数中文站点的字数口径一致），
 * 空白与标点不计。这样「2000 字一章」的直觉对得上。
 */
export function countWords(text: string): number {
  if (!text) return 0;
  const cjk = text.match(/[\u4e00-\u9fff\u3400-\u4dbf\u3040-\u30ff]/g)?.length ?? 0;
  const latin = text.match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g)?.length ?? 0;
  return cjk + latin;
}

/** 空结果工厂，避免各处手搓字面量导致字段漂移 */
export function emptyNovel(warnings: string[] = []): ParsedNovel {
  return { chapters: [], warnings };
}

/**
 * 章节健康度体检——给 CLI/UI 的「导入报告」用。
 * 判据是经验阈值，目的是在正确率掉下去时**第一时间暴露**，而不是等用户读完才发现。
 */
export interface NovelHealth {
  chapterCount: number;
  totalWords: number;
  avgWords: number;
  minWords: number;
  maxWords: number;
  /** 明显异常短的章（可能切错或章节本身是引子），下标列表 */
  suspiciousShort: number[];
  /**
   * 异常长的章（超过平均值 3 倍）。
   * 这类章**多半不是解析器漏切**，而是原书本身把几十万字塞进一个"章"里
   * （常见于网络作者为凑更早上架而合并发布）。仍需标出，因为阅读器里
   * 一个 9 万字的"章"体验极差，用户可能想手动拆开。
   */
  suspiciousLong: number[];
  /**
   * 前置附属页的章序号（扉页 / 作者简介 / 人物表 / 卷名页…）。
   * 它们不是正文，但**要保留**（很多书的人物表很值钱），只是不该参与
   * 异常短章统计。M2 落库时可据此打 kind=frontmatter 标记。
   */
  frontMatter: number[];
  /** 无正文的条目（卷名页），落库时标 volume */
  emptyNodes: number[];
  warnings: string[];
}

/**
 * 前置附属页：扉页 / 作者简介 / 作品导读 / 人物表 / 阅读顺序 / 卷名页……
 * 它们天生只有几十到几千字，**不是分章出错**，不该混进"异常短章"告警里。
 * 判据：标题不是「第N章/第N节/Chapter N」这种编号章节。
 */
const FRONT_MATTER_RE =
  /^(?:扉页|封面|书名页|版权|作者简介|作者的话|作品导读|内容简介|简介|序[章言幕言]?|自序|前言|引[子言]|主要人物|人物表|人物介绍|角色表|阅读顺序|阅读指南|目录|推荐语|获奖信息|修订记录|后记|跋|致谢|附录|插图)/;

/** 天生就短的独立篇（楔子/尾声/序章/番外…）——几百字是正常的，不算异常 */
const SHORT_NATURAL_RE = /^\s*(?:楔子|序章|序言|自序|引子|尾声|尾聲|终章|終章|后记|後記|跋|番外[0-9零一二三四五六七八九十]{0,3}|外传|外傳)\s*$/;

/** 是否「编号型正文章节」——只有它参与异常短章判定 */
function isNumberedChapter(title: string): boolean {
  const t = title.trim();
  if (FRONT_MATTER_RE.test(t)) return false;
  // 「第一卷」「第三部」是卷级节点（实测 epub 里往往只有 3 个字），
  // 不是正文章节，不参与短章统计——否则会刷出几十条"第N卷只有 3 字"的假警。
  if (/^\s*第\s*[0-9０-９零一二三四五六七八九十百千万两廿卅]{1,4}\s*[卷部篇集]\s*$/.test(t)) {
    return false;
  }
  return /^\s*第\s*[0-9０-９零一二三四五六七八九十百千万两廿卅]+\s*[章節节回幕折话話]/.test(t)
    || /^\s*(?:chapter|part|section)\s+[0-9ivxlcdm]+\b/i.test(t)
    || /^\s*(?:楔子|番外|外传|终章|尾声)\s*[0-9零一二三四五六七八九十]{0,3}\s*$/i.test(t);
}

export function checkHealth(novel: ParsedNovel): NovelHealth {
  const chapters = novel.chapters;
  const totalWords = chapters.reduce((s, c) => s + c.wordCount, 0);
  const counts = chapters.map((c) => c.wordCount);
  const minWords = counts.length ? Math.min(...counts) : 0;
  const maxWords = counts.length ? Math.max(...counts) : 0;
  const avgWords = chapters.length ? Math.round(totalWords / chapters.length) : 0;

  const warnings = [...novel.warnings];

  if (chapters.length === 0) {
    warnings.push("未识别出任何章节——可能格式不支持或章节样式特殊");
  }
  if (chapters.length === 1) {
    warnings.push("只切出 1 章——多半是章节标题格式没匹配上，建议手动指定分隔规则");
  }

  /**
   * 典型章节字数基准：**中位数**，不是均值。
   * 均值会被超长章抬高 → 短章阈值跟着变宽 → 真漏切检不出来；
   * 反过来一堆短章又会压低均值 → 正常短章被误报。中位数两种情况都稳。
   */
  const sortedCounts = [...counts].sort((a, b) => a - b);
  const median = sortedCounts.length
    ? sortedCounts.length % 2 === 1
      ? sortedCounts[(sortedCounts.length - 1) / 2]!
      : Math.round(
        (sortedCounts[sortedCounts.length / 2 - 1]! + sortedCounts[sortedCounts.length / 2]!) / 2,
      )
    : 0;

  // 异常短章：低于典型值的 1/5，且至少 20 字（更短的多半是标题残留）
  // 两条豁免，否则一本好书会刷几十条假警淹没真问题：
  //   1) 前置附属页（扉页/简介/人物表…）天生短；
  //   2) **每卷重开编号**的书（第N章在每卷都从一开始），卷末章天然只有一两千字。
  //      判据：编号回退过（本章编号 ≤ 上一章编号）→ 说明是卷尾，本来就该短。
  const suspiciousShort: number[] = [];
  const numberOf = (title: string): number | null => {
    const t = title.trim();
    const cn = t.match(/^\s*第\s*([0-9０-９零一二三四五六七八九十百千万两廿卅]+)\s*[章節节回幕折话話]/);
    if (!cn) return null;
    const v = parseInt(cn[1]!.replace(/[０-９]/g, (d) => String(d.charCodeAt(0) - 0xff10)), 10);
    if (!Number.isNaN(v)) return v;
    // 中文数字
    const digits: Record<string, number> = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
    const s = cn[1]!;
    if (s === "十") return 10;
    if (s.startsWith("十")) return 10 + (digits[s[1]!] ?? 0);
    if (s.endsWith("十")) return (digits[s[0]!] ?? 0) * 10;
    if (s.includes("十")) {
      const [a, b] = s.split("十");
      return (digits[a!] ?? 1) * 10 + (digits[b!] ?? 0);
    }
    return digits[s] ?? null;
  };
  let prevNum: number | null = null;
  for (const c of chapters) {
    if (!isNumberedChapter(c.title)) continue;
    // 楔子/尾声/后记 天生几百字，属正常体裁，不报
    if (SHORT_NATURAL_RE.test(c.title.trim())) continue;
    const n = numberOf(c.title);
    // 编号回退 = 新卷开始，本章是卷尾章，不算异常
    const volumeTail = n !== null && prevNum !== null && n <= prevNum;
    if (n !== null) prevNum = n;
    if (volumeTail) continue;
    if (c.wordCount > 0 && c.wordCount < Math.max(20, median / 5)) {
      suspiciousShort.push(c.index);
    }
  }
  if (suspiciousShort.length > 0) {
    warnings.push(
      `${suspiciousShort.length} 章字数明显偏少（第 ${suspiciousShort.slice(0, 10).join("、")}${suspiciousShort.length > 10 ? "…" : ""} 章），请人工确认分章是否正确`,
    );
  }

  // 异常长章：超过典型值 3 倍（同样用中位数，理由见上）
  const suspiciousLong: number[] = [];
  chapters.forEach((c) => {
    if (median > 0 && c.wordCount > Math.max(20_000, median * 3)) {
      suspiciousLong.push(c.index);
    }
  });
  if (suspiciousLong.length > 0) {
    warnings.push(
      `${suspiciousLong.length} 章字数异常长（第 ${suspiciousLong.slice(0, 10).join("、")}${suspiciousLong.length > 10 ? "…" : ""} 章），多半是原书把多章合并发布（而非分章失败），如影响阅读可在导入后手动拆章`,
    );
  }

  // 空章（0 字）：来自 epub 的卷名页（xxx篇/xxx卷，只有标题没正文）。
  // 不是解析失败，但落库时不该当正文章节——M2 要标成 volume。
  const emptyNodes: number[] = [];
  chapters.forEach((c) => {
    if (c.wordCount === 0) emptyNodes.push(c.index);
  });
  if (emptyNodes.length > 0) {
    warnings.push(
      `${emptyNodes.length} 个条目无正文（多为卷名页，如「第一篇」），导入后将作为卷级节点处理而非正文章节`,
    );
  }

  // 前置附属页清单（供 M2落库标记，统计时排除）
  const frontMatter = chapters.filter((c) => !isNumberedChapter(c.title)).map((c) => c.index);

  return {
    chapterCount: chapters.length,
    totalWords,
    avgWords,
    minWords,
    maxWords,
    suspiciousShort,
    suspiciousLong,
    frontMatter,
    emptyNodes,
    warnings,
  };
}