/**
 * 一致性冲突检测（v1.6.51.4 B 任务）
 *
 * 生成新章节后，把「新章正文」与已确立的「一致性事实基线」比对，找出前后矛盾，
 * 落库到 ConsistencyConflict 供作者逐条「已修正 / 忽略」处理。
 *
 * 设计要点（与 extractFacts.ts 同构）：
 *  - parseConflictsFromLLM 是纯函数，独立单测（LLM 返回常有 code fence / 前后废话，必须容错）。
 *  - detectConsistencyConflicts 在落库前先 deleteMany 同章 open 冲突，再 createMany，
 *    同一章重复检测不会堆积脏数据（幂等，按 nodeId 维度）。
 *  - 只标红、不自动改写：创作主权归作者。
 */

import { prisma } from "@/lib/prisma";
import { completeText } from "@/core/llm/client";
import { getConsistencyFacts } from "@/core/consistency/extractFacts";
import { safeParseAIArray } from "@/lib/json-parser";

export interface RawConflict {
  factId?: string | null;
  category: string;
  description: string;
  excerpt: string;
}

/**
 * 从 LLM 返回文本中解析冲突清单数组。容错策略同 parseFactsFromLLM：
 *  1. 剥掉 ```json ... ``` 代码围栏
 *  2. 截取第一个 [ 到最后一个 ] 之间的内容（容忍前后废话）
 *  3. JSON.parse 失败整体返回空（不抛，避免一次坏响应炸掉整轮）
 */
export function parseConflictsFromLLM(text: string): RawConflict[] {
  const parsed = safeParseAIArray(text);
  if (!parsed) return [];

  const conflicts: RawConflict[] = [];
  for (const item of parsed) {
    const c = normalizeConflict(item);
    if (c) conflicts.push(c);
  }
  return conflicts;
}

function normalizeConflict(item: unknown): RawConflict | null {
  if (!item || typeof item !== "object") return null;
  const x = item as Record<string, unknown>;

  const description = String(x.description ?? x.conflict ?? "").trim();
  if (!description) return null; // description 是冲突的核心，缺失即无效

  const category = String(x.category ?? "").trim();
  const excerpt = String(x.excerpt ?? "").trim();
  const factId = x.factId ? String(x.factId) : null;

  return { factId, category, description, excerpt };
}

const DETECTION_SYSTEM = `你是一致性冲突检测员。给定「已确立的事实基线」（写作时不可违背的设定）与「新写章节正文」，
请逐条比对正文是否推翻了基线中的任何事实。只报告真正的矛盾（正文明确说了与基线相反的内容），
不要报告正常的情节推进、不要报告基线上没有对应项的新信息。

判定准则（误报抑制——以下情形一律不算矛盾）：
1. 悬念反转与剧情设计不是矛盾：物品字迹变化、隐藏身份揭露、约定被打破、人物主动改变计划——这些是故事本身。
2. 状态类事实允许演进：位置/持有物/态度/关系温度以**正文（更新）**为准，正文比基线新就是正常推进；只有正文**自己内部**与基线的不可变属性相反（性别/外貌/死亡/既定历史事件/出身）才算矛盾。
3. 人物行动方式变化不算矛盾：基线说"被引至某地"，正文写"主动前往"——到达同一地点即一致。
返回 JSON 数组，每条字段：
- factId：若冲突对应基线中某条事实，填该事实的 id（[id] 方括号内的值）；无关则省略
- category：冲突所属类别（与基线类别一致，或留空）
- description：人话说明矛盾（例如「正文说主角左眼是黑色，但基线记的是灰色」）
- excerpt：正文中引发冲突的原文摘录（尽量短）
若无矛盾，返回空数组 []。`;

/**
 * 检测并落库一致性冲突（按 nodeId 幂等）。
 * @returns 检测到的冲突清单（已落库）
 */
export async function detectConsistencyConflicts(
  projectId: string,
  nodeId: string,
  chapterContent: string,
): Promise<RawConflict[]> {
  // 无基线可比对则直接返回（避免空对空误报）
  const facts = await getConsistencyFacts(projectId);
  if (facts.length === 0) return [];

  const baselineText = facts
    .map((f) => `- [${f.id}] [${f.category}] ${f.subject} 的${f.attribute} = ${f.value}`)
    .join("\n");

  const prompt =
    `【已确立的一致性事实基线（写作时不可违背）】\n${baselineText}\n\n` +
    `【新写章节正文】\n${chapterContent}\n\n` +
    `请比对正文与上述基线，找出任何前后矛盾，输出冲突 JSON 数组。`;

  const text = await completeText(DETECTION_SYSTEM, prompt, {
    temperature: 0.2,
    maxTokens: 1500,
  });

  const conflicts = parseConflictsFromLLM(text);

  // 幂等：清除本章已有 open 冲突，再写入本次检测结果（避免重复检测堆积）
  await prisma.consistencyConflict.deleteMany({
    where: { projectId, nodeId, status: "open" },
  });
  if (conflicts.length > 0) {
    await prisma.consistencyConflict.createMany({
      data: conflicts.map((c) => ({
        projectId,
        nodeId,
        factId: c.factId ?? null,
        category: c.category,
        description: c.description,
        excerpt: c.excerpt,
        status: "open",
      })),
    });
  }
  return conflicts;
}

const AUDIT_SYSTEM = `你是全书事实审计员。给定同一本小说的「全部基线事实」（来自各章摘要，按来源章排序），
找出**事实之间的互相矛盾**——即作者/AI 在不同章节写出了不可共存的内容。

重点检查（按危害排序）：
1. 同一物品/人物的**状态轨迹断裂**：如「账册 A 章在林振山处 → C 章在林舟身上 → D 章又在办公室」且中间没有任何交接情节——物品凭空移动。
2. **时间线跳跃或倒流**：时间标记序列出现无过渡的大跳（同夜→三日后→又回到当晚）、或后章时间早于前章。
3. **不可变属性冲突**：同一人物的年龄/外貌/出身/生死在不同章相反。
4. **既定事件被推翻**：后章叙述与前章已发生的既定事件相反。

不算矛盾（勿报）：
- 状态正常演进（位置移动、态度变化、关系升温——有交接/过渡即可）
- 悬念反转（字迹变化、身份揭露、约定被打破——故事设计）
- 同一事实的复述差异（表述不同但语义一致）

返回 JSON 数组，每条字段：
- aId / bId：两条互相矛盾事实的 id
- description：人话说明矛盾（含两边各自的陈述与来源章）
若无矛盾，返回空数组 []。`;

/**
 * 全书基线互审（P1 一致性深水区新增）：
 * detectConsistencyConflicts 只做「单章正文 vs 当时基线」，抓不到跨章累积矛盾
 * （如账册在 3/6/7/8/9 章间位置跳变——每次单章检测时基线本身已过时）。
 * 本函数把全部基线事实交给 LLM 互审，找出事实之间的互相矛盾，
 * 落库 ConsistencyConflict（nodeId="audit" 哨兵，重审幂等清旧建新）。
 */
export async function auditBaselineConflicts(
  projectId: string,
): Promise<{ total: number; audits: Array<{ aId: string; bId: string; description: string }> }> {
  const facts = await getConsistencyFacts(projectId);
  if (facts.length < 2) return { total: 0, audits: [] };

  // 事实按 source（来源章）排序，让 LLM 能看到状态轨迹的时序
  const factsText = facts
    .map((f) => `- [${f.id}] (${f.source || "来源不明"}) [${f.category}] ${f.subject} 的${f.attribute} = ${f.value}`)
    .join("\n");

  const prompt = `【全部基线事实（按来源排序）】\n${factsText}\n\n请审计以上事实之间的互相矛盾，输出 JSON 数组。`;

  const text = await completeText(AUDIT_SYSTEM, prompt, {
    temperature: 0.2,
    maxTokens: 2000,
  });

  const parsed = safeParseAIArray(text) as Array<Record<string, unknown>> | null;
  const audits: Array<{ aId: string; bId: string; description: string }> = [];
  // 后过滤（D 实测抓出）：审计 LLM 会在找不到矛盾时硬凑条目并自述「无矛盾/不矛盾/无冲突/一致」——
  // 这类条目对用户是纯噪声（8 条"矛盾"8 条自认无矛盾），落库前按自述丢弃
  const selfNoConflict = /(无矛盾|不矛盾|没有矛盾|无冲突|不冲突|不构成矛盾|构成矛盾|语义一致|表述一致|一致，无|本身不矛盾)/;
  for (const item of parsed || []) {
    if (!item || typeof item !== "object") continue;
    const aId = String(item.aId ?? "").trim();
    const bId = String(item.bId ?? "").trim();
    const description = String(item.description ?? "").trim();
    if (!aId || !bId || !description) continue;
    if (selfNoConflict.test(description)) continue;
    audits.push({ aId, bId, description });
  }

  // 幂等：清旧 audit 冲突再写入（哨兵 nodeId="audit"）
  await prisma.consistencyConflict.deleteMany({
    where: { projectId, nodeId: "audit", status: "open" },
  });
  if (audits.length > 0) {
    const byId = new Map(facts.map((f) => [f.id, f]));
    await prisma.consistencyConflict.createMany({
      data: audits.map((a) => ({
        projectId,
        nodeId: "audit",
        factId: byId.has(a.aId) ? a.aId : byId.has(a.bId) ? a.bId : null,
        category: byId.get(a.aId)?.category || byId.get(a.bId)?.category || "",
        description: a.description,
        excerpt: "",
        status: "open",
      })),
    });
  }
  return { total: facts.length, audits };
}
