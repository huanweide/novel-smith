/**
 * 轻判定层（仿 JEV 结构）—— 不生成文字，只做一次封闭选择
 *
 * JEV 的结构拆开就四段，这里一段不少地照搬：
 *   ① State：把处境压成 ≤300 字（不是整个世界，够判就行）
 *   ② Question：封闭候选（Choice），不给开放式问法
 *   ③ 一次判定：temperature 0、maxTokens 8、只要「字母+一位把握」
 *   ④ Harness 分流：置信度 ≥ 阈值才采信；超时/低把握一律退回规则
 *
 * 为什么不直接调 JEV：它未对国内开放。但**结构可以复刻**——
 * 用的仍是项目里那套 DeepSeek，只是不给它展开的机会：
 * 不解释、不思考、不写句子，只吐一个字母。慢的是"写"，不是"判"。
 *
 * 一条底线：这层永远不是必需的。任何异常（超时/解析失败/模型不通）
 * 都返回 null，调用方退回确定性规则——判定层不能成为新的故障点。
 */

import { createLLMClient, getEffectiveConfig } from "@/core/llm/client";

/** 判定超时：超过就当作"没判"，走规则。宁可快而略粗，不要慢而准。 */
export const DECISION_TIMEOUT_MS = 1200;

export interface DecisionAnswer {
  /** 选中项（原样返回 options 里的字符串） */
  choice: string;
  /** 0-1；模型自报的把握，缺省 0.7 */
  confidence: number;
  /** 原始回复，便于排查 */
  raw: string;
  ms: number;
}

/** State 压扁：只留判断需要的，别把世界塞进去 */
export function buildStateBrief(input: {
  place?: string;
  present?: string[];
  items?: string[];
  time?: string;
}): string {
  const parts: string[] = [];
  if (input.time) parts.push(input.time);
  if (input.place) parts.push(`在${input.place}`);
  if (input.present?.length) parts.push(`在场：${input.present.slice(0, 5).join("、")}`);
  if (input.items?.length) parts.push(`身上：${input.items.slice(0, 6).join("、")}`);
  return parts.join("；").slice(0, 300) || "（无额外信息）";
}

/** 组装判定提示：只要一个字母 + 一位把握，禁止解释 */
export function buildDecisionPrompt(state: string, question: string, options: string[]): string {
  const letters = options.map((o, i) => `${String.fromCharCode(65 + i)}. ${o}`).join("\n");
  return [
    "你是判定器。只回「字母+一位数字」，例如 A7，不要任何解释。",
    `处境：${state}`,
    `问题：${question}`,
    letters,
  ].join("\n");
}

/** 解析回复：容忍 A / a / A7 / "A 7" / 多余标点；取不到就返回 null */
export function parseChoiceReply(
  raw: string,
  options: string[]
): { choice: string; confidence: number } | null {
  if (!raw || options.length === 0) return null;
  const m = raw.trim().match(/([A-Za-z])\s*([0-9])?/);
  if (!m) return null;
  const idx = m[1].toUpperCase().charCodeAt(0) - 65;
  if (idx < 0 || idx >= options.length) return null;
  const digit = m[2] ? Number(m[2]) : NaN;
  const confidence = Number.isFinite(digit) ? Math.min(0.95, Math.max(0.5, digit / 10)) : 0.7;
  return { choice: options[idx], confidence };
}

const cache = new Map<string, DecisionAnswer | null>();
const CACHE_MAX = 200;

/**
 * 问一次判定。失败/超时返回 null（调用方走规则），绝不抛错、绝不拖慢。
 */
export async function askChoice(
  state: string,
  question: string,
  options: string[]
): Promise<DecisionAnswer | null> {
  if (options.length < 2 || options.length > 4) return null;
  const key = `${state}|${question}|${options.join("|")}`;
  if (cache.has(key)) return cache.get(key) ?? null;

  const started = Date.now();
  // 超时用 AbortController 真正掐断请求，而不是 Promise.race 假装超时：
  // 后者会让请求在后台继续生成（费钱、占连接），只把结果丢掉。
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), DECISION_TIMEOUT_MS);
  try {
    const config = await getEffectiveConfig();
    const client = createLLMClient(config);
    const answer = await client.chat({
      model: config.writerModel,
      messages: [{ role: "user", content: buildDecisionPrompt(state, question, options) }],
      temperature: 0,
      maxTokens: 8,
      role: "judge",
      signal: ctrl.signal,
    } as any);

    if (!answer || typeof (answer as any).content !== "string") {
      cache.set(key, null);
      return null;
    }
    const parsed = parseChoiceReply((answer as any).content, options);
    const result: DecisionAnswer | null = parsed
      ? { ...parsed, raw: (answer as any).content.slice(0, 20), ms: Date.now() - started }
      : null;
    if (cache.size >= CACHE_MAX) cache.clear();
    cache.set(key, result);
    return result;
  } catch {
    // 超时/网络/解析失败一律当作"没判"——判定层不能成为新的故障点
    cache.set(key, null);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Harness 分流：只有"明确不行"才拦，且要模型自己够有把握。
 * 阈值 0.75 的依据：低把握的拦截最容易误伤（玩家会感到被管），
 * 而漏判的代价只是正文里演一次失败——两害相权，宁漏不错。
 */
export const BLOCK_CONFIDENCE = 0.75;

export async function askFeasibility(
  brief: Parameters<typeof buildStateBrief>[0],
  actionText: string
): Promise<{ block: boolean; reason?: string } | null> {
  const state = buildStateBrief(brief);
  const options = ["做得到", "做得到但会失败或付出代价", "做不到"];
  const res = await askChoice(state, `玩家想做：${actionText.slice(0, 60)}。这件事在此处境下成立吗？`, options);
  if (!res) return null;
  if (res.choice === "做不到" && res.confidence >= BLOCK_CONFIDENCE) {
    return { block: true, reason: "此处在眼下的条件里做不到" };
  }
  return { block: false };
}
