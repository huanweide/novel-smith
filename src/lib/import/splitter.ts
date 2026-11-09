/**
 * 章节切分识别器（Import Novel · M1）
 *
 * 这是整个导入链的地基：分章错了，后面落库、目录、搜索、续写全错。
 * 所以设计取向是「宁可多切一次给人看，也不要默默切错」——所有可疑情况都进 warnings。
 *
 * 识别分三层，从强到弱：
 *   A. 卷/篇  —— 「第一卷」「卷二」「第三部」→ 结构级标题
 *   B. 章/节  —— 「第一章」「第 1 节」「Chapter 3」「序章」「楔子」「番外」→ 正文章节
 *   C. 兜底    —— 整段按空行/字数强切（仅在 A/B 全军覆没时启用，并在报告里明确警告）
 *
 * 关键取舍：标题行**独占一行且较短**才算数。正文里出现的「第一章」通常是叙述内容，
 * 不是标题——这是切分最常见的误判来源。
 */

import { countWords, type ParsedChapter, type ParsedNovel } from "./types";

export interface SplitOptions {
  /** 手动指定章节标题正则（覆盖内置识别器） */
  chapterRegex?: string;
  /** 标题行最大长度：超过则视为正文而非标题（默认 40） */
  maxTitleLength?: number;
  /** 是否把「卷」也切成独立节点（默认 false：卷作为章标题的一部分） */
  splitVolumes?: boolean;
  /** 兜底强切：整段超过此字数按段落边界切（默认 6000，0 = 禁用） */
  fallbackChunkWords?: number;
}

/** 卷/篇级标题（第X卷 / 第X部 / 第X篇 / 卷X） */
const VOLUME_RE =
  /^\s*(?:第\s*[0-9零一二三四五六七八九十百千万两]+\s*[卷部篇集]|[卷部篇集]\s*[0-9零一二三四五六七八九十百千万两]+|序[章言卷]|前[言序]|引[子言]|后[记谈番])\s*[·:：、.\-—]?\s*$/;

/**
 * 章/节级标题。按中文网文真实写法穷举，顺序有意义：
 * 数字在前会把「第 1 章」里的空格吃掉；显式章/节/回/幕/折 更稳。
 */
const CHAPTER_RE = new RegExp(
  [
    // 第一章 / 第 1 章 / 第一節 / 第十二回 / 第三节 ……（数字不限语言）
    "^\\s*第\\s*[0-9０-９零一二三四五六七八九十百千万两廿卅]+\\s*[章節节回幕折话話]\\s*[:：、.．\\-—]?\\s*.*$",
    // 中文数字 + 章（无"第"）："第一章"已被上行覆盖，这里处理"一、"/"1."这类
    "^\\s*[0-9０-９零一二三四五六七八九十百千万两]+\\s*[、．.·]\\s*\\S.{0,30}$",
    // 序章 / 楔子 / 尾声 / 后记 / 番外 / 终章 / 外传（常见独立成篇）
    // 尾部标题必须"可选"：允许「番外」光杆，也允许「番外 后续」「番外一：某某」，
    // 但最多 20 字——再长就该交给下面的句子防线判定为正文。
    "^\\s*(?:序[章言]|楔子|尾[声音]|终[章局]?|后记|跋|番外[0-9零一二三四五六七八九十]{0,3}|外[传傳])\\s*(?:[:：、.．\\-—·]\\s*)?(?:\\S.{0,20})?$",
    // English: Chapter 1 / CHAPTER I / Part 2
    "^\\s*(?:chapter|part|section)\\s+[0-9ivxlcdm]+\\b.*$",
  ].join("|"),
  "i",
);

/** 引言独立成章的最低字数：低于此值并回第一章 */
const MIN_PREAMBLE_WORDS = 80;

/**
 * 句子结束符——中文正文句子几乎必以它结尾，章节标题极少以它结尾。
 * 「番外内容。」「楔子有感。」这类正文句正是靠这道防线挡掉的，
 * 比逐个收紧标题正则更有效（新增识别项时也不会漏）。
 */
const SENTENCE_END_RE = /[。！？!?…]["'』」）)]?\s*$/;

/** 判断是否章节标题；返回命中的标题文本或 null */
function matchTitle(line: string, maxLen: number): string | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  // 标题必须短：长行几乎一定是正文
  if (trimmed.length > maxLen) return null;
  // 以句末标点结尾 → 是正文句子，不是标题
  if (SENTENCE_END_RE.test(trimmed)) return null;
  if (CHAPTER_RE.test(trimmed)) return trimmed;
  return null;
}

function isVolume(line: string): boolean {
  return VOLUME_RE.test(line.trim());
}

/** 清理正文里的多余空行（保留段落结构，去掉连续 3 个以上空行） */
function tidyContent(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

/**
 * 兜底强切：一整段没有章节标题时，按段落边界切成若干「章」。
 * 目的是让用户至少能读，而不是拿到一个几万字的巨型章节。
 */
function fallbackSplit(body: string, chunkWords: number): { title: string; content: string }[] {
  const paras = body.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  if (chunkWords <= 0 || paras.length <= 1) return [{ title: "正文", content: body }];

  const out: { title: string; content: string }[] = [];
  let buf: string[] = [];
  let count = 0;
  for (const p of paras) {
    buf.push(p);
    count += countWords(p);
    if (count >= chunkWords) {
      out.push({ title: `第 ${out.length + 1} 节`, content: buf.join("\n\n") });
      buf = [];
      count = 0;
    }
  }
  if (buf.length) out.push({ title: `第 ${out.length + 1} 节`, content: buf.join("\n\n") });
  return out;
}

/**
 * 主入口：把纯文本切成章节。
 *
 * 算法：按行扫描，遇标题行开新章；当前章标题若与上一个卷标题接近则拼上（体现层级）。
 * 卷标题单独记下来，遇到第一个章时作为该章的卷前缀。
 */
export function splitChapters(rawText: string, opts: SplitOptions = {}): ParsedNovel {
  const maxTitleLength = opts.maxTitleLength ?? 40;
  const fallbackChunkWords = opts.fallbackChunkWords ?? 6000;
  const warnings: string[] = [];

  const customRe = opts.chapterRegex ? new RegExp(opts.chapterRegex) : null;
  const lines = rawText.replace(/\r\n?/g, "\n").split("\n");

  const chapters: { title: string; body: string[] }[] = [];
  let current: { title: string; body: string[] } | null = null;
  let pendingVolume = "";
  let sawAnyTitle = false;
  // 首个章节标题之前的内容（书名/简介/作者的话）：独立收集，
  // 若整本都没识别到标题，就拿它（连同正文）做兜底强切——不能提前塞进 current，
  // 否则 chapters 永远 ≥1，兜底强切分支永远不会触发。
  const preamble: string[] = [];

  const push = (title: string, body: string[]) => {
    if (body.length === 0) return;
    chapters.push({ title, body });
  };

  for (const line of lines) {
    const trimmed = line.trim();

    // 卷级标题：记下来，等下一章时做前缀
    if (isVolume(trimmed)) {
      if (current) {
        push(current.title, current.body);
        current = null;
      }
      pendingVolume = trimmed;
      sawAnyTitle = true;
      continue;
    }

    let title: string | null = null;
    if (customRe) {
      if (customRe.test(trimmed) && trimmed.length <= maxTitleLength && !SENTENCE_END_RE.test(trimmed)) {
        title = trimmed;
      }
    } else {
      title = matchTitle(trimmed, maxTitleLength);
    }

    if (title) {
      if (current) push(current.title, current.body);
      const fullTitle = pendingVolume && opts.splitVolumes
        ? `${pendingVolume} ${title}`
        : title;
      current = { title: fullTitle, body: [] };
      pendingVolume = "";
      sawAnyTitle = true;
    } else if (current) {
      current.body.push(line);
    } else if (trimmed) {
      // 标题之前的内容 → 引言区
      preamble.push(line);
    }
  }
  if (current) push(current.title, current.body);

  let result: ParsedChapter[];

  if (chapters.length === 0) {
    // 一个章节标题都没匹配上 → 对「引言+全文」兜底强切 + 明确警告
    warnings.push(
      "未匹配到任何章节标题（第一章/第1章/Chapter 等），已按段落强切为若干节——请人工确认分章，或手动指定章节正则",
    );
    const whole = [preamble.join("\n"), rawText].filter(Boolean).join("\n\n");
    result = fallbackSplit(tidyContent(whole), fallbackChunkWords).map((c, i) => ({
      index: i + 1,
      title: c.title,
      content: tidyContent(c.content),
      wordCount: countWords(c.content),
    }));
  } else {
    result = chapters.map((c, i) => {
      const content = tidyContent(c.body.join("\n"));
      return { index: i + 1, title: c.title, content, wordCount: countWords(content) };
    });
    // 标题前的引言（书名/作者的话/内容简介）→ 有实质篇幅才作独立「前言」首章。
    // 只有十几字的通常是文件名残留或一行版权声明，单独成章反而是噪声，
    // 这种情况下并回第一章开头——内容不丢，但不产生一个 10 字章。
    if (preamble.length > 0) {
      const pre = tidyContent(preamble.join("\n"));
      if (pre && countWords(pre) >= MIN_PREAMBLE_WORDS) {
        result = [{ index: 1, title: "前言", content: pre, wordCount: countWords(pre) },
          ...result.map((c, i) => ({ ...c, index: i + 2 }))];
      } else if (pre && result.length > 0) {
        const first = result[0]!;
        const merged = `${pre}\n\n${first.content}`.trim();
        result[0] = {
          ...first,
          content: merged,
          wordCount: countWords(merged),
        };
      }
    }
    if (!sawAnyTitle) warnings.push("分章依据不足，建议手动指定章节正则");
  }

  return { chapters: result, warnings };
}