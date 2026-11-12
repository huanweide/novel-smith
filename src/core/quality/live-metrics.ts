/**
 * R5 · 实时演算指标（纯本地、零 LLM、零网络）
 *
 * 挂在 `write-generation.ts` 流式循环已有的「每 ~200 字符扫描」hook 上。
 * 目的：写到一半就能看到字数、节奏、对话密度、设定命中，而不是等整章写完才算。
 * 这些指标**只做展示**，不改正文、不改生成参数、不触发任何模型调用，
 * 因此不会破坏 `write-generation.ts:448-452` 的章末富化同步语义。
 */

export interface LiveMetricsInput {
  /** 一致性基线里的事实主体（角色/地点名），用于算「本章呼应了哪些设定」 */
  factSubjects?: string[];
  /** 复用既有 `scanForbiddenWordsEnhanced` 的结果，本模块不重复实现扫描器 */
  forbiddenMatches?: Array<{ pattern?: string } | unknown>;
}

export interface LiveMetrics {
  wordCount: number;
  paragraphCount: number;
  dialogueRatio: number;
  longParagraphRatio: number;
  factHits: number;
  factMisses: string[];
  forbiddenHits: number;
  pacingHint: string;
}

const LONG_PARAGRAPH_CHARS = 250;

export function computeLiveMetrics(text: string, input: LiveMetricsInput = {}): LiveMetrics {
  const t = String(text ?? "");
  const wordCount = Array.from(t.replace(/\s/g, "")).length;
  // 中文小说正文用单换行分段（空行只是额外留白），按任意连续换行切才符合真实排版
  const paragraphs = t.split(/\n+/).map((p) => p.trim()).filter(Boolean);
  const paragraphCount = paragraphs.length;

  // 对话占比：中文引号内的字符数 / 总字符数
  const quoted = t.match(/["“][^"”]*["”]/g) || [];
  const quotedChars = quoted.reduce((s, q) => s + Array.from(q).length, 0);
  const dialogueRatio = wordCount > 0 ? Math.round((quotedChars / wordCount) * 1000) / 1000 : 0;

  const longCount = paragraphs.filter((p) => Array.from(p).length > LONG_PARAGRAPH_CHARS).length;
  const longParagraphRatio = paragraphCount > 0
    ? Math.round((longCount / paragraphCount) * 1000) / 1000
    : 0;

  const lower = t.toLowerCase();
  const subjects = Array.from(new Set((input.factSubjects || []).map((s) => String(s).trim()).filter(Boolean)));
  const hits = subjects.filter((s) => lower.includes(s.toLowerCase()));
  const factMisses = subjects.filter((s) => !hits.includes(s));

  const forbiddenHits = Array.isArray(input.forbiddenMatches) ? input.forbiddenMatches.length : 0;

  let pacingHint = "";
  if (wordCount >= 200 && paragraphCount > 0) {
    if (longParagraphRatio >= 0.5) pacingHint = "长段落偏多，读起来可能发闷，可考虑拆段。";
    else if (dialogueRatio < 0.05 && wordCount > 600) pacingHint = "对白偏少，可考虑加一段人物交锋。";
    else if (factMisses.length > 0 && wordCount > 800) pacingHint = `还有 ${factMisses.length} 个关键设定本章未呼应。`;
  }

  return {
    wordCount,
    paragraphCount,
    dialogueRatio,
    longParagraphRatio,
    factHits: hits.length,
    factMisses,
    forbiddenHits,
    pacingHint,
  };
}
