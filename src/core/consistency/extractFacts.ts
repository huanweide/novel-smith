/**
 * 一致性事实基线（v1.6.51 新功能支柱）
 *
 * 从已归档章节摘要（ChapterSummary）+ 角色卡（CharacterCard）+ 世界书缓存（Project.globalPrompt）
 * 抽取"事实清单"——每条描述一个主体(subject)的某个属性(attribute)的确定值(value)，
 * 落库到 ConsistencyFact，供生成时注入提示词、打长篇小说前后不一致痛点。
 *
 * 设计要点：
 *  - parseFactsFromLLM 是纯函数，独立单测（LLM 返回的 JSON 常有 code fence / 前后废话，必须容错）。
 *  - extractConsistencyFacts 幂等：先 deleteMany 再 createMany，重复抽取不会堆积。
 */

import { prisma } from "@/lib/prisma";
import { completeText } from "@/core/llm/client";
import { safeParseAIArray } from "@/lib/json-parser";
import { asArray } from "@/lib/utils";

export type ConsistencyCategory = "character" | "world" | "plot" | "relationship";

export interface RawFact {
  category: ConsistencyCategory;
  subject: string;
  attribute: string;
  value: string;
  source: string;
  confidence: number;
}

const CATEGORIES: ConsistencyCategory[] = [
  "character",
  "world",
  "plot",
  "relationship",
];

/**
 * 事实去重（Next-3 护栏）：同一 (subject, attribute) 只保留首条，避免 LLM 单次抽取
 * 重复输出同一事实导致基线堆积重复行。key 大小写不敏感、忽略首尾空格；同时归一化
 * subject/attribute/value 首尾空格。纯函数，单测锁死。
 */
export function dedupeFacts(facts: RawFact[]): RawFact[] {
  const seen = new Set<string>();
  const out: RawFact[] = [];
  for (const f of facts) {
    const key = JSON.stringify([
      f.subject.trim().toLowerCase(),
      f.attribute.trim().toLowerCase(),
    ]);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      ...f,
      subject: f.subject.trim(),
      attribute: f.attribute.trim(),
      value: f.value.trim(),
    });
  }
  return out;
}

/**
 * 「旧事实失效不删除」的注入层实现（阶段 C1）。
 *
 * dedupeFacts 只管**单次抽取内**的重复；跨章累积后，同一 (subject, attribute) 会有多版
 * （李富贵：账房 → 杀人凶手）。旧实现全量注入，模型同时看到两版互相矛盾的设定。
 *
 * 取「时序语义」而不引图数据库：用已有的 createdAt / confidence / source 三个字段，
 * 每个键只保留最新最可信的一条**用于注入**；旧条原样留在库里，不删、不改，历史可追溯。
 * 优先级：作者手填(manual) > createdAt 更新 > confidence 更高 > 先到的（全同保守保留）。
 */
type FactLike = {
  subject: string;
  attribute: string;
  confidence?: number | null;
  source?: string | null;
  createdAt?: Date | string | null;
};

/** a 是否应当取代 b（纯比较，不修改入参） */
function preferFact(a: FactLike, b: FactLike): boolean {
  const aManual = a.source === "manual";
  const bManual = b.source === "manual";
  if (aManual !== bManual) return aManual; // 作者手填永不被自动抽取顶掉
  const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
  const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
  if (ta !== tb) return ta > tb;
  const ca = Number(a.confidence ?? 1);
  const cb = Number(b.confidence ?? 1);
  return ca > cb; // 全同返回 false → 保留先到的，行为可预测
}

export function collapseSupersededFacts<T extends FactLike>(
  facts: T[],
): { kept: T[]; supersededCount: number } {
  const best = new Map<string, T>();
  let supersededCount = 0;
  for (const f of facts) {
    const key = JSON.stringify([
      String(f.subject ?? "").trim().toLowerCase(),
      String(f.attribute ?? "").trim().toLowerCase(),
    ]);
    const cur = best.get(key);
    if (!cur) {
      best.set(key, f);
      continue;
    }
    supersededCount++;
    if (preferFact(f, cur)) best.set(key, f);
  }
  return { kept: Array.from(best.values()), supersededCount };
}

/**
 * 从 LLM 返回文本中解析事实清单数组。容错策略：
 *  1. 剥掉 ```json ... ``` 代码围栏
 *  2. 截取第一个 [ 到最后一个 ] 之间的内容（容忍前后废话）
 *  3. JSON.parse 失败整体返回空（不抛，避免一次坏响应炸掉整轮）
 */
export function parseFactsFromLLM(text: string): RawFact[] {
  const parsed = safeParseAIArray(text);
  if (!parsed) return [];

  const facts: RawFact[] = [];
  for (const item of parsed) {
    const f = normalizeFact(item);
    if (f) facts.push(f);
  }
  return facts;
}

function normalizeFact(item: unknown): RawFact | null {
  if (!item || typeof item !== "object") return null;
  const x = item as Record<string, unknown>;

  const subject = String(x.subject ?? x.name ?? "").trim();
  const attribute = String(x.attribute ?? x.key ?? "").trim();
  const value = String(x.value ?? x.fact ?? "").trim();
  if (!subject || !attribute || !value) return null;

  const rawCat = String(x.category ?? "").toLowerCase();
  const category: ConsistencyCategory = (CATEGORIES as string[]).includes(rawCat)
    ? (rawCat as ConsistencyCategory)
    : "world";

  let confidence = typeof x.confidence === "number" ? x.confidence : 1.0;
  confidence = Math.max(0, Math.min(1, confidence));

  return {
    category,
    subject,
    attribute,
    value,
    source: String(x.source ?? "").trim(),
    confidence,
  };
}

interface ExtractProjectShape {
  name: string;
  synopsis: string;
  globalPrompt: string;
  characters: Array<{ name: string; description?: string | null }>;
  chapterSummaries: Array<{
    chapterId: string;
    chapterTitle: string;
    summary: string;
    keyEvents?: unknown;
    characterStates?: unknown;
  }>;
}

/**
 * 聚集抽取上下文：角色卡 + 已归档章节摘要（世界书已并入 globalPrompt）。
 */
function buildExtractionContext(project: ExtractProjectShape): string {
  const parts: string[] = [];

  if (project.characters?.length) {
    parts.push(
      "【角色卡】\n" +
        project.characters
          .map((c) => `- ${c.name}: ${String(c.description ?? "").slice(0, 200)}`)
          .join("\n"),
    );
  }
  if (project.chapterSummaries?.length) {
    parts.push(
      "【已归档章节摘要】\n" +
        project.chapterSummaries
          // 章号用归档顺序（chapterId 是 UUID 不能直接展示）；keyEvents/characterStates 必须带上——
          // 关键物品的转移/交付记录在 keyEvents 里，持有状态在 characterStates 里，缺了它们物品轨迹就断
          .map((s, i) => {
            const events = asArray<string>(s.keyEvents)
              .filter(Boolean)
              .map((e) => `    · ${e}`)
              .join("\n");
            const states = s.characterStates ? `\n    角色状态: ${String(s.characterStates).slice(0, 300)}` : "";
            return `第${i + 1}章《${s.chapterTitle}》: ${s.summary}${events ? `\n    关键事件:\n${events}` : ""}${states}`;
          })
          .join("\n"),
    );
  }
  return parts.join("\n\n");
}

const EXTRACTION_SYSTEM = `你是一致性事实抽取器。从给定的小说设定与已写章节摘要中，抽取可被后续写作引用的"事实清单"。
每条事实描述一个主体(subject)的某个属性(attribute)的确定值(value)。
类别(category)限四选一：character(人物) / world(世界) / plot(情节) / relationship(关系)。
只抽取文中明确陈述或可高置信推断的事实，严禁编造。
返回 JSON 数组，每条字段：category, subject, attribute, value, source, confidence(0~1)。
输出压缩纪律：每条 value ≤60 字、不写解释性文字、不重复输出已知设定——条数会很多，超长截断=全部报废。

除常规设定外，以下两类"状态事实"必须抽取（缺失会导致后续章节物品位置/时间线前后矛盾）：
- 关键物品持有与位置：先识别故事里的关键物品（账册/钥匙/信物/武器等反复出现的道具），然后**逐章扫描**该物品在每章的持有者/位置，每章各出一条事实（attribute=第N章持有者/位置，value=谁/哪里）。物品即使只在某章被提及归属变化，也要单独成条——这些轨迹是冲突审计的原料，漏一条就审不出"物品凭空移动"。
- 时间流：subject=故事时间线，attribute=第N章，value=该章的时间标记（如"雨夜当晚""三日后"）。摘要句首的时间标记就是来源。`;

/**
 * 抽取并落库一致性事实基线（幂等）。
 * @returns 抽取到的条数与事实清单
 */
export async function extractConsistencyFacts(
  projectId: string,
  opts?: { model?: string },
): Promise<{ count: number; facts: RawFact[]; skipped?: boolean }> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      chapterSummaries: { orderBy: { createdAt: "asc" } },
      characters: true,
    },
  });
  if (!project) throw new Error(`Project ${projectId} not found`);

  const context = buildExtractionContext(project as unknown as ExtractProjectShape);
  const prompt =
    `【作品】${project.name}\n` +
    `【主线总纲】${project.synopsis || "（无）"}\n` +
    `【世界书/风格缓存】${project.globalPrompt || "（无）"}\n\n` +
    `${context}\n\n请输出事实清单 JSON 数组。`;

  const text = await completeText(EXTRACTION_SYSTEM, prompt, {
    temperature: 0.2,
    // 6000：抽取含物品轨迹/时间流后条数 50+（2500/4000 均实测截断 JSON 致解析为空）
    maxTokens: 6000,
    model: opts?.model,
  });

  const facts = parseFactsFromLLM(text);

  // 去重（Next-3 成本/频率护栏之一）：同一 (subject, attribute) 只保留首条，
  // 避免 LLM 在单次抽取里重复输出同一事实导致基线堆积重复行（详见 dedupeFacts）。
  const deduped = dedupeFacts(facts);

  // 防御（多章连贯稳定性）：本次抽取产出为空，说明 LLM 超时/返回空/解析失败，
  // 视为「抽取失败」。若仍按「先清后插」执行，会把前几章已累积的全部设定事实清零，
  // 导致后续章节失去一致性约束（角色年龄/关系/地点集体失忆、大面积 OOC）。
  // 故抽取为空时保留既有基线、不清空、不重建，仅返回 skipped 标记。
  if (deduped.length === 0) {
    return { count: 0, facts: [], skipped: true };
  }

  // 幂等：抽到了才「先清后插」，重复抽取不堆积。
  // 仅清除自动抽取的事实（source != "manual"），保留作者手动新增/编辑的事实，
  // 否则「手动重新抽取」会把作者在 Next-2 里手填的基线一并抹掉。
  await prisma.consistencyFact.deleteMany({ where: { projectId, source: { not: "manual" } } });
  if (deduped.length > 0) {
    await prisma.consistencyFact.createMany({
      data: deduped.map((f) => ({ projectId, ...f })),
    });
  }
  return { count: deduped.length, facts: deduped };
}

/**
 * 读取项目的一致性事实基线。
 */
export async function getConsistencyFacts(projectId: string) {
  return prisma.consistencyFact.findMany({
    where: { projectId },
    orderBy: [{ category: "asc" }, { subject: "asc" }, { attribute: "asc" }],
  });
}

export interface BaselineReport {
  /** 可注入 systemPrompt 的文本块（与 getConsistencyBaselineText 返回值逐字一致） */
  text: string;
  /** 全部事实（含被剔除的），供上下文质量审计检测空值/乱码 */
  facts: Awaited<ReturnType<typeof getConsistencyFacts>>;
  /** 因「来源命中摘要标题」被剔除的条数——阶段2-① 的真实清理结果（语义不含同键合并） */
  droppedFactCount: number;
  /** 因同 (subject,attribute) 有更新版本而**未注入**的旧事实条数——阶段 C1（旧条仍在库里） */
  supersededFactCount: number;
  /** 已归档章节摘要标题（小写），供审计归因 */
  summaryTitles: string[];
}

/**
 * 生成基线文本 + 清理诊断（阶段2-②）。
 *
 * 「被总结的内容就不放进去」——来源命中某章摘要标题的事实，已随章节摘要注入上下文，
 * 此处剔除，避免同一信息在摘要与基线间重复占用 token。
 * 作者手填（source=manual）与无来源事实保守保留，永不误删。
 *
 * 抽成 report 版是为了让预览/审计层拿到「剔除了几条」与「全部事实」，
 * 不重复实现剔除逻辑（避免两处判定漂移）。getConsistencyBaselineText 复用本函数。
 */
export async function getConsistencyBaselineReport(projectId: string): Promise<BaselineReport> {
  const [facts, summaries] = await Promise.all([
    getConsistencyFacts(projectId),
    prisma.chapterSummary.findMany({ where: { projectId } }).catch(() => [] as any[]),
  ]);
  const summaryTitles = (summaries as any[])
    .map((s) => String((s as any).chapterTitle ?? "").trim().toLowerCase())
    .filter(Boolean);
  const titleSet = new Set(summaryTitles);

  if (facts.length === 0) {
    return { text: "", facts, droppedFactCount: 0, supersededFactCount: 0, summaryTitles };
  }

  const afterSummary = facts.filter((f) => {
    if (f.source === "manual") return true; // 作者手填事实始终保留
    if (!f.source) return true; // 无来源信息，conservative 保留
    return !titleSet.has(String(f.source).trim().toLowerCase());
  });
  // droppedFactCount 保持阶段2-① 的原语义：只统计「摘要内已含」的剔除，不混入同键合并数
  const dropped = facts.length - afterSummary.length;

  // 阶段 C1：同键多版只注入最新的一条，旧条留库不删
  const { kept, supersededCount } = collapseSupersededFacts(afterSummary);
  if (kept.length === 0) {
    return { text: "", facts, droppedFactCount: dropped, supersededFactCount: supersededCount, summaryTitles };
  }

  const lines = kept.map(
    (f) => `- [${f.category}] ${f.subject} 的${f.attribute} = ${f.value}${f.source ? `（来源：${f.source}）` : ""}`,
  );
  const header =
    dropped > 0
      ? `【一致性事实基线——写作时务必严格遵守，前后不得矛盾】（已剔除 ${dropped} 条摘要内已含的重复事实）`
      : `【一致性事实基线——写作时务必严格遵守，前后不得矛盾】`;
  // superseded 不写进 text：省 token，且注入格式保持稳定；审计层从 report 字段读取
  return {
    text: `${header}\n${lines.join("\n")}`,
    facts,
    droppedFactCount: dropped,
    supersededFactCount: supersededCount,
    summaryTitles,
  };
}

/** 生成可注入提示词的一致性基线文本块（供 prompt 注入层调用）。 */
export async function getConsistencyBaselineText(projectId: string): Promise<string> {
  return (await getConsistencyBaselineReport(projectId)).text;
}
