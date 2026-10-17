/**
 * 导入前史资产 · 三卡一键预填（M4）
 *
 * M3 提炼出的草稿只有「名字 + 客观出现证据」，字段基本是空的。
 * 这个模块用 LLM 把草稿补成真正能用的角色卡 / 世界书条目：
 * 外貌、性格（主导/驱动/矛盾/习惯/面具）、动机、关系、故事线。
 *
 * ## 为什么规则填不了、只能靠 LLM
 * 「矛盾」「驱动」这类字段天生是叙事判断，规则只能编。
 * 但**编**比**留空**更坏——一旦 approved，一张编出来的性格卡会持续污染每一次生成。
 * 所以本模块的两条铁律：
 *  1. **只写原文能证实的**，prompt 里明确禁止虚构，原文没写就留空字符串；
 *  2. **预填完仍保持 pending**，作者扫一眼才采纳——LLM 也会错，
 *     把「允许 LLM 直接 approved」做成默认，等于把闸门交给概率。
 *
 * 并发刻意压低（默认 4）：一本书可能提炼出 40 个角色，
 * 打满并发会把配额烧穿，而这张卡作者可能根本不会采纳。
 */

import { prisma } from "@/lib/prisma";
import { getSettings, recordLlmCall } from "@/lib/llm";
import { parseAIJson } from "@/lib/json-parser";
import { asArray } from "@/lib/utils";

export interface PrefillOptions {
  projectId: string;
  /** 要预填的角色卡 id；空 = 全部导入提炼出的 pending 角色卡 */
  characterIds?: string[];
  /** 要预填的世界书 id；空 = 全部 pending 世界书条目 */
  loreIds?: string[];
  /** 同时预填伏笔的 developmentHint，默认关（伏笔那句话本身就是提示词，LLM 大概率只是复述） */
  includeCommitments?: boolean;
  concurrency?: number;
  /** 预填后自动采纳（approved）。默认 false —— 保持待审。 */
  autoApprove?: boolean;
}

export interface PrefillResult {
  characters: { id: string; name: string; ok: boolean; error?: string; filled: string[] }[];
  lore: { id: string; title: string; ok: boolean; error?: string }[];
  commitments: { id: string; ok: boolean; error?: string }[];
  skipped: string[];
}

// ─── LLM 调用 ─────────────────────────────────────────────

async function callLLM(
  system: string,
  prompt: string,
  model: string,
  baseUrl: string,
  apiKey: string,
  projectId: string,
  maxTokens = 2048,
): Promise<{ raw: string } | { error: string }> {
  if (apiKey.length < 10 && !baseUrl.includes("localhost") && !baseUrl.includes("127.0.0.1")) {
    return { error: "API Key 未配置" };
  }
  const url = baseUrl.endsWith("/v1") ? `${baseUrl}/chat/completions` : `${baseUrl}/v1/chat/completions`;
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: prompt },
        ],
        temperature: 0.2,
        max_tokens: maxTokens,
        stream: false,
      }),
    });
    if (!r.ok) {
      const body = await r.text().catch(() => "");
      return { error: `LLM ${r.status}: ${body.slice(0, 180)}` };
    }
    const data = (await r.json().catch(() => null)) as any;
    const usage = data?.usage;
    recordLlmCall({
      model,
      role: "assistant",
      promptTokens: usage?.prompt_tokens ?? 0,
      completionTokens: usage?.completion_tokens ?? 0,
      totalTokens: usage?.total_tokens ?? 0,
      baseURL: baseUrl,
      projectId,
    });
    const raw = data?.choices?.[0]?.message?.content;
    if (!raw) return { error: "LLM 返回空内容" };
    return { raw };
  } catch (e) {
    return { error: (e instanceof Error ? e.message : String(e)).slice(0, 180) };
  }
}

// ─── 提示词 ───────────────────────────────────────────────

const CHAR_SYSTEM = `你是一个中文长篇小说的角色档案整理员。
铁律：
1. 只使用【原文片段】中能直接读到的信息。原文没写的字段，一律返回空字符串 ""，绝不虚构、绝不"合理推测"。
2. 不要写"未知""待补充""可能"这类占位文本，没信息就空字符串。
3. 性格必须拆成结构化五要素，来源只能是原文里的言行描写，不是你对这个名字的想象。
4. 输出严格 JSON，不要任何解释文字、不要 markdown 代码块。`;

function charPrompt(name: string, evidence: string, chapterNumber: number): string {
  return `请根据下面信息整理角色卡。

角色名：${name}
首现章节：第 ${chapterNumber} 章
提炼证据：${evidence || "（无额外证据）"}

【原文片段】
${evidence || "（无）"}

输出 JSON，字段说明：
{
  "role": "protagonist|antagonist|supporting|mentor|love_interest|catalyst|comic_relief|background",
  "age": "年龄，原文没写则空字符串",
  "gender": "性别，原文没写则空字符串",
  "aliases": ["别名/称呼/外号，没有则空数组"],
  "appearance": "外貌，原文没描写的部位不要编，整段无描写则空字符串",
  "dominant": "性格主导特质",
  "drive": "性格驱动（他想要的/在追的）",
  "contradiction": "性格矛盾（自身的冲突）",
  "habits": ["行为习惯，3-5 条，原文没写则空数组"],
  "socialMask": "社交面具（对他人表现的样子）",
  "background": "背景经历，200 字以内，只写原文有的",
  "hiddenMotives": ["隐藏动机，原文没线索则空数组"],
  "abilities": ["能力/技能，原文没写则空数组"],
  "storyLine": "该角色在主线中的起落弧，150 字以内",
  "currentStatus": "结局状态：alive|dead|missing|unknown"
}`;
}

const LORE_SYSTEM = `你是一个中文长篇小说的设定整理员。
铁律：
1. 只使用【原文片段】中能直接读到的设定。原文没写的部分返回空字符串。
2. 不要复述"这是一个法宝"这类废话，直接写它是什么、有什么能力、谁拥有。
3. 控制在 200 Token 以内（这是注入写作上下文的设定条目，超了会挤占正文预算）。
4. 输出严格 JSON，不要解释文字。`;

function lorePrompt(name: string, category: string, evidence: string): string {
  return `请根据下面信息整理世界书条目。

词条名：${name}
分类：${category}
出现情况：${evidence}

【原文片段】
${evidence || "（无）"}

输出 JSON：
{
  "content": "设定正文，200 Token 以内",
  "keys": ["触发关键词，含词条名本身"],
  "insertionOrder": 50
}`;
}

// ─── 单条预填 ─────────────────────────────────────────────

export interface CharFill {
  role?: string;
  age?: string;
  gender?: string;
  aliases?: unknown;
  appearance?: string;
  dominant?: string;
  drive?: string;
  contradiction?: string;
  habits?: unknown;
  socialMask?: string;
  background?: string;
  hiddenMotives?: unknown;
  abilities?: unknown;
  storyLine?: string;
  currentStatus?: string;
}

const VALID_ROLES = new Set([
  "protagonist", "antagonist", "supporting", "mentor",
  "love_interest", "catalyst", "comic_relief", "background",
]);
const VALID_STATUS = new Set(["alive", "dead", "missing", "unknown"]);

/**
 * 占位文本黑名单。
 *
 * LLM 在证据不足时最典型的行为不是返回空串，而是回一句
 * 「未知」「待补充」「不详」——这些必须当"没填"处理，
 * 否则一张写着"矛盾：未知"的性格卡会 approved 进每一次生成的上下文，
 * 持续注入废话还占 token。
 */
const PLACEHOLDER_RE = /^(未知|待补充|待填|待定|不详|不详?|无|没有|空|none|null|n\/a|unknown|tbd|暂缺|略)$/i;

/** 把 LLM 返回的角色数据 sanitize 成可安全入库的结构 */
/**
 * 把 LLM 返回的角色数据 sanitize 成可安全入库的结构。
 * 导出以便单测直接钉住这些规则——这些是防「LLM 编造 / 返回脏类型」的第一道闸，
 * 一旦被改松，脏卡就会 approved 进生成上下文。
 */
export function sanitizeCharFill(raw: CharFill): { data: Record<string, unknown>; filled: string[] } {
  const filled: string[] = [];
  const data: Record<string, unknown> = {};

  const putString = (key: string, v: unknown, label: string) => {
    if (typeof v !== "string") return;
    const t = v.trim();
    // 占位文本视为无信息
    if (!t || PLACEHOLDER_RE.test(t)) return;
    data[key] = t.slice(0, 2000);
    filled.push(label);
  };
  const putArr = (key: string, v: unknown, label: string) => {
    if (!Array.isArray(v)) return;
    const arr = v
      .filter((x): x is string => typeof x === "string")
      .map((x) => x.trim())
      .filter((x) => x && !PLACEHOLDER_RE.test(x))
      .slice(0, 12);
    if (arr.length === 0) return;
    data[key] = arr;
    filled.push(label);
  };

  if (raw.role && VALID_ROLES.has(raw.role)) data.role = raw.role;
  putString("age", raw.age, "年龄");
  putString("gender", raw.gender, "性别");
  putArr("aliases", raw.aliases, "别名");
  putString("appearance", raw.appearance, "外貌");

  // 性格：五要素合并成结构化对象
  // 走同一套占位文本过滤——「矛盾：未知」这类必须当没填，
  // 否则一张空壳性格卡 approved 后会持续注入「矛盾=未知」这种废话。
  const p: Record<string, unknown> = {};
  const putP = (key: string, v: unknown) => {
    if (typeof v !== "string") return;
    const t = v.trim();
    if (!t || PLACEHOLDER_RE.test(t)) return;
    p[key] = t.slice(0, 500);
  };
  putP("dominant", raw.dominant);
  putP("drive", raw.drive);
  putP("contradiction", raw.contradiction);
  putP("socialMask", raw.socialMask);
  if (Array.isArray(raw.habits)) {
    const h = raw.habits
      .filter((x): x is string => typeof x === "string")
      .map((x) => x.trim())
      .filter((x) => x && !PLACEHOLDER_RE.test(x));
    if (h.length) p.habits = h.slice(0, 8);
  }
  if (Object.keys(p).length > 0) {
    data.personality = p;
    filled.push("性格");
  }

  putString("background", raw.background, "背景");
  putArr("hiddenMotives", raw.hiddenMotives, "隐藏动机");
  putArr("abilities", raw.abilities, "能力");
  putString("storyLine", raw.storyLine, "故事线");
  if (raw.currentStatus && VALID_STATUS.has(raw.currentStatus)) {
    data.currentStatus = raw.currentStatus;
  }

  return { data, filled };
}

async function prefillOneCharacter(
  card: { id: string; name: string; background: string; reviewStatus: string; tags: unknown },
  model: string,
  baseUrl: string,
  apiKey: string,
  projectId: string,
): Promise<{ ok: boolean; error?: string; filled: string[] }> {
  const evidence = [card.background, ...asArray<string>(card.tags)].filter(Boolean).join(" | ");
  const res = await callLLM(
    CHAR_SYSTEM,
    charPrompt(card.name, evidence, 0),
    model, baseUrl, apiKey, projectId, 2048,
  );
  if ("error" in res) return { ok: false, error: res.error, filled: [] };

  let parsed: unknown;
  try {
    parsed = parseAIJson(res.raw);
  } catch (e) {
    return { ok: false, error: `返回不是合法 JSON：${(e as Error).message.slice(0, 80)}`, filled: [] };
  }
  const { data, filled } = sanitizeCharFill(parsed as CharFill);
  if (filled.length === 0) {
    return { ok: false, error: "原文证据不足，LLM 未填出任何字段", filled: [] };
  }

  await prisma.characterCard.update({
    where: { id: card.id },
    data: {
      ...data,
      // 关键：**不**覆盖 background（那是 M3 写的客观证据），
      // LLM 的背景只在 M3 没写出来时才填。
      ...(filled.includes("背景") && !card.background.includes("导入原文自动识别")
        ? {}
        : { background: (data.background as string) ?? card.background }),
      tags: [...asArray<string>(card.tags), "已预填"],
    },
  });
  return { ok: true, filled };
}

async function prefillOneLore(
  entry: { id: string; title: string; category: string; content: string; reviewStatus: string },
  model: string,
  baseUrl: string,
  apiKey: string,
  projectId: string,
): Promise<{ ok: boolean; error?: string }> {
  const res = await callLLM(
    LORE_SYSTEM,
    lorePrompt(entry.title, entry.category, entry.content),
    model, baseUrl, apiKey, projectId, 1024,
  );
  if ("error" in res) return { ok: false, error: res.error };

  let parsed: unknown;
  try {
    parsed = parseAIJson(res.raw);
  } catch (e) {
    return { ok: false, error: `返回不是合法 JSON：${(e as Error).message.slice(0, 80)}` };
  }
  const obj = (parsed ?? {}) as { content?: string; keys?: unknown };
  const content = typeof obj.content === "string" ? obj.content.trim() : "";
  if (!content) return { ok: false, error: "LLM 未给出设定内容" };

  const keys = Array.isArray(obj.keys)
    ? obj.keys.filter((k): k is string => typeof k === "string").map((k) => k.trim()).filter(Boolean)
    : [entry.title];

  await prisma.lorebookEntry.update({
    where: { id: entry.id },
    data: { content: content.slice(0, 1200), keys: [...new Set([entry.title, ...keys])].slice(0, 12) },
  });
  return { ok: true };
}

// ─── 主入口 ───────────────────────────────────────────────

/** 有并发上限的 map，避免把 LLM 配额一次打穿 */
export async function pMap<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = cursor++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]!);
    }
  });
  await Promise.all(workers);
  return out;
}

export async function prefillAssets(opts: PrefillOptions): Promise<PrefillResult> {
  const settings = await getSettings();
  const { model, baseUrl, apiKey } = settings;
  const concurrency = Math.max(1, Math.min(8, opts.concurrency ?? 4));

  const result: PrefillResult = { characters: [], lore: [], commitments: [], skipped: [] };

  if (!baseUrl) {
    result.skipped.push("未配置 LLM Base URL，无法预填");
    return result;
  }

  const reviewStatus = opts.autoApprove ? "approved" : "pending";

  // ─── 角色卡 ───
  // tags 是 Json 列，SQLite 下不支持 array_contains；先按状态取回再在内存里筛。
  const charsAll = await prisma.characterCard.findMany({
    where: {
      projectId: opts.projectId,
      reviewStatus: "pending",
      ...(opts.characterIds?.length ? { id: { in: opts.characterIds } } : {}),
    },
    select: { id: true, name: true, background: true, reviewStatus: true, tags: true },
    take: 200,
    orderBy: { createdAt: "asc" },
  });
  const chars = charsAll
    .filter((c) => opts.characterIds?.length || asArray<unknown>(c.tags).includes("导入提炼"))
    .slice(0, 60);

  const charResults = await pMap(chars, concurrency, async (c) => {
    const r = await prefillOneCharacter(c, model, baseUrl, apiKey, opts.projectId);
    return { ...r, card: c };
  });
  for (const r of charResults) {
    result.characters.push({
      id: r.card.id,
      name: r.card.name,
      ok: r.ok,
      error: r.error,
      filled: r.filled,
    });
  }

  // ─── 世界书 ───
  const lore = await prisma.lorebookEntry.findMany({
    where: {
      projectId: opts.projectId,
      reviewStatus: "pending",
      ...(opts.loreIds?.length ? { id: { in: opts.loreIds } } : {}),
    },
    select: { id: true, title: true, category: true, content: true, reviewStatus: true },
    take: 60,
    orderBy: { createdAt: "asc" },
  });

  const loreResults = await pMap(lore, concurrency, async (l) => {
    const r = await prefillOneLore(l, model, baseUrl, apiKey, opts.projectId);
    return { ...r, entry: l };
  });
  for (const r of loreResults) {
    result.lore.push({ id: r.entry.id, title: r.entry.title, ok: r.ok, error: r.error });
  }

  // ─── 统一处理采纳状态 ───
  // 预填成功才改 reviewStatus；失败的保持 pending 让作者看到"这条没填出来"。
  const okCharIds = result.characters.filter((c) => c.ok).map((c) => c.id);
  const okLoreIds = result.lore.filter((l) => l.ok).map((l) => l.id);
  if (okCharIds.length > 0 || okLoreIds.length > 0) {
    await prisma.$transaction([
      ...(okCharIds.length > 0
        ? [prisma.characterCard.updateMany({ where: { id: { in: okCharIds } }, data: { reviewStatus } })]
        : []),
      ...(okLoreIds.length > 0
        ? [prisma.lorebookEntry.updateMany({ where: { id: { in: okLoreIds } }, data: { reviewStatus } })]
        : []),
    ]);
  }

  return result;
}
