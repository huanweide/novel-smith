/**
 * 模拟编辑审稿 —— 提示词与结构化解析（纯逻辑层，不依赖 LLM，便于单测）
 *
 * 设计原则（对齐用户要求）：
 * 1. 系统预设多种角色（番茄/起点/晋江/公众号编辑 + 爽文读者），用户可在 UI 自由编辑、保存自定义。
 * 2. 提示词「不机械」：明确禁止套公式（如「必须出现装逼打脸」「三章一个小高潮」），
 *    要求像真人编辑一样指出具体位置、具体改法，能过稿而非挑刺。
 * 3. 输出结构化 JSON，便于前端展示 + 一键复制给微调 AI + 直接应用修改。
 */

import type { PublishPlatform } from "@/core/publish/pipeline";

export type EditorRoleId = "fanqie" | "qidian" | "jjwxc" | "wechat" | "reader" | "custom";

export interface ReviewChapterInput {
  /** 章节标记，如 "章1"，与 LLM 返回 suggestions[].chapterRef 对应 */
  ref: string;
  nodeId: string;
  title: string;
  content: string;
}

export type Severity = "high" | "medium" | "low";

export interface ReviewSuggestion {
  nodeId?: string;
  chapterTitle?: string;
  chapterRef: string;
  location: string;
  issue: string;
  severity: Severity;
  suggestion: string;
  /** 给微调 AI 的精确改写指令（可直接粘进「微调指令」框） */
  rewriteHint: string;
}

export interface ReviewDimension {
  key: string;
  label: string;
  score: number;
  comment: string;
}

export interface ReviewResult {
  overall: string;
  verdict: string;
  dimensions: ReviewDimension[];
  suggestions: ReviewSuggestion[];
  /** 一键复制给微调 AI 的完整指令（已按章节分组） */
  promptForTune: string;
}

export interface EditorRole {
  id: EditorRoleId;
  label: string;
  /** 角色人设基底（编辑视角的身份描述） */
  persona: string;
}

// ─── 角色预设 ───────────────────────────────────────────────
export const EDITOR_ROLES: EditorRole[] = [
  {
    id: "fanqie",
    label: "番茄小说责编",
    persona:
      "你是一位番茄小说的签约责编，每天看几百份投稿，一眼就能判断哪份能留住读者、哪份三屏就被划走。",
  },
  {
    id: "qidian",
    label: "起点中文网主编",
    persona:
      "你是一位起点中文网的主编，负责签人和培养长期爆款，最看重「能不能让人追更」「有没有长期钩子」。",
  },
  {
    id: "jjwxc",
    label: "晋江文学城编辑",
    persona:
      "你是一位晋江文学城的资深编辑，最在意人物和情感关系是否抓人，文笔细腻但不矫情，标签感要明确。",
  },
  {
    id: "wechat",
    label: "公众号内容主编",
    persona:
      "你是一位公众号内容主编，深谙手机端碎片化阅读下「前 30 秒定生死」的规律，开头一句话就要有共鸣或冲突。",
  },
  {
    id: "reader",
    label: "爽文老读者",
    persona:
      "你不是编辑，而是一位真实的爽文老读者——追更、打分、催更的那种。你用「我会不会追更」「这段我会不会划走」的标准来评价，说话直白、带读者视角，不端着。",
  },
  {
    id: "custom",
    label: "自定义（我的预设）",
    persona: "",
  },
];

// ─── 各平台编辑口味（注入到系统提示，让审稿按目标平台标准判断）───
const PLATFORM_TASTE: Record<string, string> = {
  fanqie:
    "目标平台是「番茄小说」：读者滑屏即走，前 3 屏必须抓住人；节奏要快、信息密度高、少铺垫；金手指/核心冲突尽早亮相；快不等于糙，对话和场景要干净利落。",
  qidian:
    "目标平台是「起点中文网」：世界观和人物要立得住，前几章要埋下长期追读钩子（悬念/秘密/目标）；允许稍慢的铺陈，但每章要有「想看下一章」的牵引。",
  jjwxc:
    "目标平台是「晋江文学城」：情感和人物关系张力是核心；开头要有「人」和「关系」的钩子，文笔细腻不矫情；甜/虐/爽等标签感应明确。",
  wechat:
    "目标平台是「微信公众号」：碎片化阅读，开头一句话就要有共鸣或冲突；段落极短；关键是前 30 秒抓住手机读者。",
  general:
    "不套用任何平台规矩，按「好故事」的通用标准审：人物动机清晰、冲突明确、节奏得当、文从字顺。",
};

const COMMON_RULES = `你是真人编辑，不是机器质检。务必遵守以下原则：
1. 不要套公式，不要硬塞固定桥段要求（严禁提出「必须出现装逼打脸」「三章必一个小高潮」「每章必须留钩子」这类机械套路），那会毁掉创作多样性。
2. 基于文本实际内容判断，指出「具体位置」（如：开头第 2 段 / 第 3 章中段 / 某句对话），并给出「具体改法」，尽量附一句改写示例。
3. 对确实写得好的地方也要肯定，不要只挑刺。
4. 目标是帮作者过稿、变得更好，而不是证明你厉害。
5. 每个修改建议都必须给出可直接粘进「微调指令」框的 rewriteHint 精确改写指令。`;

/**
 * 组装系统提示词（角色人设 + 平台口味 + 通用不机械规则）。
 * UI 把这段作为可编辑的初始值；用户改完随请求体发给后端。
 */
export function getRoleSystem(roleId: EditorRoleId | string, platform: string): string {
  if (roleId === "custom") {
    return "你是一位资深网文编辑，负责给作者做一审。请基于文本实际内容给出具体、可落地的修改建议，不要套公式、不要机械挑刺。";
  }
  const role = EDITOR_ROLES.find((r) => r.id === roleId) ?? EDITOR_ROLES[0];
  const taste = PLATFORM_TASTE[platform] ?? PLATFORM_TASTE.general;
  return `${role.persona}\n\n${taste}\n\n${COMMON_RULES}`;
}

// ─── 组装发给 LLM 的用户提示 ───────────────────────────────
export function buildReviewUserPrompt(chapters: ReviewChapterInput[]): string {
  const chapterBlocks = chapters
    .map((c) => `【${c.ref}】标题：${c.title}\n正文：\n${c.content}`)
    .join("\n\n");

  return `请逐章审读以下作品（章节以【章N】标记，N 即章序号，与你要返回的 chapterRef 对应）。

${chapterBlocks}

请输出一份结构化一审意见，包含：
1) 六个维度评分(0-100)与一句点评：能否签约(sign)、开头钩子(hook)、爽点密度(satisfy)、节奏(pacing)、人设吸引力(character)、文笔流畅度(writing)。
2) 具体可落地的修改建议：每条指明 location（位置）、issue（问题）、severity（high/medium/low）、suggestion（怎么改，人话）、rewriteHint（给微调 AI 的精确改写指令，可直接粘进「微调指令」框，例如「把第 2 段主角的内心独白删掉，改成一句动作描写，让冲突直接展现」）。

请严格只输出如下 JSON（不要 markdown 代码块、不要任何额外解释）：
{
  "overall": "总体一审意见（人话 2-4 句）",
  "verdict": "签约潜力高 | 可投但需打磨 | 暂不建议投",
  "dimensions": [
    {"key":"sign","label":"能否签约","score":80,"comment":"..."},
    {"key":"hook","label":"开头钩子","score":70,"comment":"..."},
    {"key":"satisfy","label":"爽点密度","score":65,"comment":"..."},
    {"key":"pacing","label":"节奏","score":75,"comment":"..."},
    {"key":"character","label":"人设吸引力","score":70,"comment":"..."},
    {"key":"writing","label":"文笔流畅度","score":80,"comment":"..."}
  ],
  "suggestions": [
    {"chapterRef":"章1","location":"开头第2段","issue":"...","severity":"high","suggestion":"...","rewriteHint":"..."}
  ]
}`;
}

// ─── 解析 LLM 返回的 JSON，并把 chapterRef 映射回 nodeId/title ──
export function parseReviewJson(raw: string, chapters: ReviewChapterInput[]): Omit<ReviewResult, "promptForTune"> {
  let text = (raw || "").trim();
  // 去掉可能的 ```json ... ``` 包裹
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  // 兜底：截取第一个 { 到最后一个 }
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first >= 0 && last > first) text = text.slice(first, last + 1);

  let obj: any = {};
  try {
    obj = JSON.parse(text);
  } catch {
    obj = {};
  }

  const refMap = new Map<string, ReviewChapterInput>();
  for (const c of chapters) refMap.set(c.ref, c);

  const dimensions: ReviewDimension[] = Array.isArray(obj.dimensions)
    ? obj.dimensions
        .filter((d: any) => d && typeof d.label === "string")
        .map((d: any) => ({
          key: String(d.key ?? d.label ?? "dim"),
          label: String(d.label),
          score: Math.max(0, Math.min(100, Number(d.score) || 0)),
          comment: String(d.comment ?? ""),
        }))
    : [];

  const suggestions: ReviewSuggestion[] = Array.isArray(obj.suggestions)
    ? obj.suggestions
        .filter((s: any) => s && typeof s !== "string")
        .map((s: any) => {
          const ref = String(s.chapterRef ?? s.ref ?? "");
          const mapped = refMap.get(ref);
          const sev = ["high", "medium", "low"].includes(s.severity) ? s.severity : "medium";
          return {
            nodeId: mapped?.nodeId,
            chapterTitle: mapped?.title,
            chapterRef: ref,
            location: String(s.location ?? ""),
            issue: String(s.issue ?? ""),
            severity: sev as Severity,
            suggestion: String(s.suggestion ?? ""),
            rewriteHint: String(s.rewriteHint ?? s.suggestion ?? ""),
          };
        })
    : [];

  return {
    overall: String(obj.overall ?? ""),
    verdict: String(obj.verdict ?? ""),
    dimensions,
    suggestions,
  };
}

// ─── 组装「复制给微调 AI」的完整指令（按章节分组）────────────
export function buildPromptForTune(suggestions: ReviewSuggestion[]): string {
  if (suggestions.length === 0) return "";
  const byChapter = new Map<string, ReviewSuggestion[]>();
  for (const s of suggestions) {
    const key = s.chapterTitle || s.chapterRef || "章节";
    const arr = byChapter.get(key) ?? [];
    arr.push(s);
    byChapter.set(key, arr);
  }

  const lines: string[] = [
    "请按以下审稿意见改写对应章节，保持原文文风、人称、视角与专有名词不变，只做指定修改，输出完整改写后全文：",
    "",
  ];
  for (const [chapter, items] of byChapter) {
    lines.push(`【${chapter}】`);
    items.forEach((it, i) => {
      lines.push(
        `${i + 1}. 位置：${it.location}｜问题：${it.issue}｜改法：${it.suggestion}`,
      );
      if (it.rewriteHint) lines.push(`   （微调指令：${it.rewriteHint}）`);
    });
    lines.push("");
  }
  return lines.join("\n").trim();
}

// ─── 应用修改：把审稿意见转成「改写整章」的提示词 ──────────
export function buildApplySystem(): string {
  return "你是 novel-smith 的改写执行编辑，只按编辑意见精确修改，不擅自发挥、不重写全文。";
}

export function buildApplyUserPrompt(
  content: string,
  suggestions: Array<{ location?: string; issue?: string; suggestion?: string; rewriteHint?: string }>,
): string {
  const items = suggestions
    .map((s, i) => {
      const parts = [`位置：${s.location || "（未指定，按上下文判断）"}`, `问题：${s.issue || "—"}`, `改法：${s.suggestion || "—"}`];
      if (s.rewriteHint) parts.push(`微调指令：${s.rewriteHint}`);
      return `${i + 1}. ${parts.join("；")}`;
    })
    .join("\n");

  return `下面是某一章的现有正文，以及针对它的几条审稿修改意见。
请按意见改写好这一章的【完整全文】，要求：
- 严格保持原文的人称、视角、文风、专有名词、整体结构；
- 只改动意见指出的地方，没要求改的保持原样；
- 不要删减无关内容，不要重写全文，不要加「以下是改写稿」等开场白；
- 直接输出改写后的完整章节正文。

【现有正文】
${content}

【修改意见】
${items}

请输出改写后的完整正文：`;
}
