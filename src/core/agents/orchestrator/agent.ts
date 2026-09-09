/**
 * Agent 调度器 —— 多智能体协作编排
 *
 * 四个 Agent 的职责：
 *   Agent A（架构师）→ 生成小说总体大纲
 *   Agent B（导演）  → 拆解为分章细纲
 *   Agent C（主笔）  → 撰写具体文本
 *   Agent D（审校）  → 检查OOC/逻辑/世界观冲突
 *
 * 工作流：A → B → C → D → (不通过则回到C)
 *
 * 这里实现了单章生成的完整流水线。
 * 注意：Agent B 的职责被简化合并进 A（一次性拆好章节），
 * 实际运行时 A 负责大纲+拆章，C 负责写，D 负责审。
 *
 * 拆分说明（v3.1.100）：提示词模板 → ./prompts；审校/摘要解析 → ./review-parser、./summary-parser；
 * 上下文装配 → ./prompt-context。本文件只保留调度编排。
 */

import type {
  Project,
  CharacterCard,
  LorebookEntry,
  StoryNode,
  StoryBeat,
  PromptContext,
  ChapterOutline,
  ChapterSummary,
  ReviewLog,
  ReviewIssueType,
  EventImportances,
  EventCategory,
} from "@/core/types";
import type { LLMClient } from "@/core/llm/client";
import type { LLMConfig } from "@/core/types";
import { getDefaultClient, getDefaultLLMConfig, getEffectiveConfig, createLLMClient, buildProjectOverrides } from "@/core/llm/client";
import { assemblePrompt, getDistantFloors } from "@/core/assembly/engine";
import { summarizeDistantFloor } from "@/core/assembly/distant-summary";
import { matchLoreEntries } from "@/core/assembly/trigger";
import {  safeJoin, asArray } from "@/lib/utils";
import { countTokens } from "@/core/assembly/tokenizer";
import { scoreAndClassifyEvents, classifyEventCategory } from "@/core/distillation";
import { injectOptimizedMemory, DEFAULT_BUDGET } from "@/lib/memory-injector";
import type { TieredMemory } from "@/lib/memory-classifier";
import { toolRegistry } from "../tool-registry";
import type { ToolSchema, ToolContext, ToolResult } from "../tool-registry";
import { formatStorylines, filterActiveStorylines } from "@/core/pipeline/outline-context";
import { safeParseAIJson } from "@/lib/json-parser";
import { SYSTEM_PROMPTS } from "./prompts";
import { parseReviewResponse } from "./review-parser";
import { parseSummaryResponse } from "./summary-parser";

export class AgentOrchestrator {
  private client: LLMClient;
  private config: LLMConfig;

  /**
   * @param client  可选——LLM 客户端，不传则用 getDefaultClient() 兜底
   * @param config  可选——LLM 配置（模型名等），不传则用 getDefaultLLMConfig() 兜底
   *
   * ⚠️ 推荐使用静态工厂 AgentOrchestrator.fromSettings() 替代直接 new，
   *    确保模型名/API Key 从全局设置页动态读取。
   */
  constructor(client?: LLMClient, config?: LLMConfig) {
    this.client = client || getDefaultClient();
    this.config = config || getDefaultLLMConfig();
  }

  /**
   * 从全局设置创建调度器——模型名、API Key、Base URL 全部从 AppSettings 表读取。
   * 这是推荐的初始化方式，用户在设置页改了模型会即时生效。
   */
  static async fromSettings(
    overrides?: Partial<LLMConfig>,
    /** F5 项目配置中心：项目级 llmConfig 覆盖（Json），非空字段覆盖全局设置 */
    projectLlmConfig?: Record<string, unknown> | null,
  ): Promise<AgentOrchestrator> {
    const merged: Partial<LLMConfig> = { ...overrides, ...buildProjectOverrides(projectLlmConfig) };
    const config = await getEffectiveConfig(merged);
    const client = createLLMClient(config);
    return new AgentOrchestrator(client, config);
  }

  /**
   * Agent A：生成小说总体大纲
   */
  async generateOutline(
    project: Project,
    characters: CharacterCard[],
    loreEntries: LorebookEntry[],
    styleDescription = "",
  ): Promise<string> {
    const characterBriefs = characters
      .map((c) => `[${c.name}] 身份：${c.role} | 性格：${safeJoin(c.personality)} | 动机：${safeJoin(c.hiddenMotives)}`)
      .join("\n");

    const loreBriefs = loreEntries
      .filter((l) => l.enabled)
      .map((l) => `[${l.title}] ${l.content}`)
      .join("\n");

    const response = await this.client.chat({
      model: this.config.architectModel,
      messages: [
        { role: "system", content: SYSTEM_PROMPTS.architect },
        {
          role: "user",
          content: `请为以下小说项目生成总体大纲：

【作品信息】
名称：${project.name}
类型：${safeJoin(project.genre)}
目标字数：${project.targetWordCount.toLocaleString()}字
主线总纲：${project.synopsis}
基调：${safeJoin(project.toneKeywords)}
${styleDescription}

【角色设定】
${characterBriefs}

【世界观设定】
${loreBriefs}

请输出：1) 总体起承转合结构 2) 分章大纲（每章含标题、核心冲突、出场角色）`,
        },
      ],
      temperature: 0.8,
      maxTokens: 4096,
    });

    return response.content;
  }

  /**
   * Agent C：撰写正文（流式输出）
   *
   * @returns AsyncGenerator，逐 token 产出文本
   */
  async *writeSection(
    context: PromptContext,
    writingInstruction: string,
    targetWordCount: number,
    /** 正文生成专用客户端（硅基），不传则用默认 DeepSeek */
    clientOverride?: LLMClient,
    writerModelOverride?: string,
    /** 覆盖默认 temperature（来自项目文风设置） */
    temperatureOverride?: number,
    /** 覆盖默认 topP（来自项目文风设置） */
    topPOverride?: number,
    /** L5-04：外部 AbortSignal（客户端断连），透传到 chatStream 的 request.signal，断连即中止生成 */
    signal?: AbortSignal,
  ): AsyncGenerator<{ type: "token" | "done" | "error"; content: string; usage?: { promptTokens: number; completionTokens: number; totalTokens: number }; finishReason?: string }> {
    const systemPrompt = context.systemPrompt;
    const client = clientOverride || this.client;
    const model = writerModelOverride || this.config.writerModel;

    // 酒馆记忆迁移最后一环：远楼层 LLM 压缩摘要。
    // 检测短期记忆中放不进预算的较早章节，用同一 client/model 预生成摘要，
    // 注入前文回顾区替换"已折叠·非完整原文"标记，保留情节要义。
    const distantSummaries: Record<string, string> = {};
    const distantFloors = getDistantFloors(context.slidingWindow, this.config.contextWindowSize);
    for (const floor of distantFloors) {
      const summary = await summarizeDistantFloor(client, floor, model);
      if (summary) distantSummaries[floor.id] = summary;
    }

    const { prompt } = assemblePrompt(
      context,
      this.config.contextWindowSize,
      `${writingInstruction}\n\n目标字数：约${targetWordCount}字。`,
      { distantSummaries }
    );

    // v1.6.45：空响应/0-token 退避重试。
    // chatStream 内部已对「连接建立失败」做 DEFAULT_RETRIES 重试 + 故障转移，但「流成功建立却
    // 返回 0 个正文 token（DeepSeek 偶发空响应）」不在其重试范围——那种情况下 chatStream 正常
    // return，上层空响应守卫会把整章判为失败（如 v1.6.45 实测首次 refine 撞空响应）。此处补一层：
    // 仅当本次尝试未产出任何 token（空响应或连接中途断）才退避重试，已产出 token 则视为成功、
    // 直接结束（避免重复 yield 导致上层 newContent 重复累积）。鉴权/4xx 类错误重试必败，直接报错。
    const WRITE_MAX_RETRIES = 2;
    const writeBackoff = async (a: number) => {
      const ms = Math.min(8000, 600 * Math.pow(2, a - 1));
      await new Promise((r) => setTimeout(r, ms));
    };
    let attempt = 0;
    while (attempt <= WRITE_MAX_RETRIES) {
      let gotToken = false;
      let errMsg: string | null = null;
      try {
        for await (const chunk of client.chatStream({
          model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: prompt },
          ],
          temperature: temperatureOverride ?? this.config.defaultTemperature,
          topP: topPOverride ?? this.config.defaultTopP,
          maxTokens: this.config.maxTokensPerRequest,
          // L5-01：按目标字数动态放大 max_tokens；L5-04：透传断连信号
          targetWordCount,
          signal,
        })) {
          if (chunk.type === "token") gotToken = true;
          yield chunk;
        }
      } catch (err) {
        errMsg = err instanceof Error ? err.message : String(err);
      }
      // 已产出正文 token：视为成功，done chunk 已随流 yield，直接结束（不重复重试）
      if (gotToken) return;
      // 0 token 产出：空响应或连接中断。鉴权/4xx 类错误重试必败，直接报错；
      // 其余（网关抖动/偶发空响应）退避重试，提升 DeepSeek 偶发故障下的成功率。
      const fatal = errMsg && /401|403|authentication|api[ _-]?key|invalid[ _-]?key|鉴权|未授权|forbidden/i.test(errMsg);
      if (fatal || attempt >= WRITE_MAX_RETRIES) {
        yield {
          type: "error",
          content: errMsg || "模型未返回任何正文（空响应），请稍后重试或检查 LLM 配置",
        };
        return;
      }
      attempt++;
      await writeBackoff(attempt);
    }
  }

  /**
   * Agent D：审校生成的文本
   *
   * @returns 审校日志
   */
  async reviewContent(
    generatedContent: string,
    nodeOutline: string,
    activeCharacters: CharacterCard[],
    activeLoreEntries: LorebookEntry[],
    previousContext: { chapterTitle: string; summary: string; keyEvents: string[]; characterStates?: string }[]
  ): Promise<ReviewLog> {
    const characterRefs = activeCharacters
      .map((c) => {
        const dialogue = (typeof c.dialogueStyle === "object" && c.dialogueStyle !== null
          ? c.dialogueStyle
          : {}) as Record<string, unknown>;
        const examples = Array.isArray(dialogue.examples) ? (dialogue.examples as string[]).join("；") : "";
        return `[${c.name}] 性格：${safeJoin(c.personality)} | 对话风格：${examples} | 动机：${safeJoin(c.hiddenMotives)} | 状态：${c.currentStatus}`;
      })
      .join("\n");

    const loreRefs = activeLoreEntries
      .map((l) => `[${l.title}] ${l.content}`)
      .join("\n");

    // 构建前文跨章对照表
    const prevChaptersBlock = previousContext.length > 0
      ? previousContext.map((ctx, i) => {
          const states = ctx.characterStates
            ? `\n    角色状态快照：${typeof ctx.characterStates === "string" ? ctx.characterStates.slice(0, 400) : JSON.stringify(ctx.characterStates).slice(0, 400)}`
            : "";
          const events = ctx.keyEvents?.length
            ? `\n    关键事件：${ctx.keyEvents.join("；")}`
            : "";
          return `【前第${previousContext.length - i}章——${ctx.chapterTitle}】
    摘要：${ctx.summary}${events}${states}`;
        }).join("\n\n")
      : "（本章开头，无前文）";

    const reviewPrompt = `请审校以下小说文本：

【本节大纲】
${nodeOutline}

【前文章节记录——用于跨章一致性对比】
${prevChaptersBlock}

【角色设定参考】
${characterRefs}

【世界观参考】
${loreRefs}

【待审文本】
${generatedContent}

请逐项检查并输出审校报告。重点：待审文本中的角色状态、关系、事件是否与前文章节记录矛盾？`;

    const response = await this.client.chat({
      model: this.config.reviewerModel,
      messages: [
        { role: "system", content: SYSTEM_PROMPTS.reviewer },
        { role: "user", content: reviewPrompt },
      ],
      temperature: 0.3, // 审校用低温，更准确
      maxTokens: 2048,
    });

    // 解析审校结果为结构化数据
    return parseReviewResponse(response.content, nodeOutline);
  }

  /**
   * Agent 摘要：压缩章节为中期记忆
   */
  async summarizeChapter(
    chapterContent: string,
    chapterTitle: string,
    characters: CharacterCard[],
    chapterOrder?: number, // 当前章节序号，用于时效性计算
    existingSummariesCount?: number, // 已有摘要数，用于计算 chapterDiff
    titleStyle?: string, // v2.55.0：章节标题风格 default/verse/prose/brief/suspense
  ): Promise<{
    summary: string;
    keyEvents: string[];
    characterStates: string;
    closingSnapshot: string;       // 章末快照：最后段落 + 情绪基调
    characterImpulses: Array<{ name: string; impulse: string }>; // 角色脉搏
    threadProgress: Array<{ storylineId: string; stage: string; progressNote: string }>;
    unresolvedQuestions: string[];
    impactScore: number;
    chapterTitle: string; // v2.43.0：专用短章名（≤5字、不含人名），供 post-processor 自动命名使用
    eventImportances: EventImportances; // S/A/B/C四级事件分层
  }> {
    const charNames = characters.map((c) => c.name).join("、");

    // 截取章末 200 字作为快照原文
    const lastParagraphs = chapterContent.slice(-200).trim();

    const response = await this.client.chat({
      model: this.config.summarizeModel,
      messages: [
        {
          role: "system",
          content: `你是高效的文本摘要助手，擅长提取章节精华。

任务：
1. 写一句摘要（≤200 Token）
2. 提取关键事件（≤5个）
3. 记录每个角色的**最终状态**（情绪、位置、关键决定）
4. 分析章末氛围——前章最后一段的情绪基调是什么（如"压抑/释然/紧张/平静/悲伤"）
5. 为每个角色写一句**当下冲动**——"我想要X，因为Y刚发生"。这是角色在下一章开头的行为驱动力，是区别于"大纲目标"的**即时欲望**。

输出格式：
---
摘要：[摘要]
关键事件：
- [事件1]
- [事件2]
角色状态：[角色名]：[情绪]，[位置]，决定了[关键决定]
章末氛围：[情绪基调标签]
角色脉搏：
- [角色名]：[一句话的当下冲动]
- [角色名]：[一句话的当下冲动]
---

额外输出字段（JSON 格式——在上述文本格式输出全部结束后，另起一行用 json 代码块包裹输出以下四个字段）：
- "threadProgress": 数组，每项 { storylineId: "故事线ID", stage: "所在阶段", progressNote: "一句话——本线在本章的推进" }
  阶段可选值: desire(欲望)/obstacle(阻碍)/action(行动)/result(结果)/twist(意外)/turn(转折)/ending(结局)
- "unresolvedQuestions": 字符串数组，本章留下的悬念/伏笔（每条一句话，如"剑的秘密仍未解开"）
- "chapterTitle": 字符串，本章章名，**按当前风格生成（当前风格="${titleStyle || "default"}"）**：
    · default：≤5字极简短语（如"祭坛觉醒""边城夜雨""血脉异动""密室对峙"）
    · verse（诗句）：五/七言感、有韵味（如"雨落忆往昔""剑舞风云变""月满西厢念君归"）
    · prose（文笔）：文艺抒情、有画面（如"月夜幽思""血影将至的静谧""悲恸之夜"）
    · brief（简短）：直白点题、含关键事件/冲突（如"得宝剑""正邪初遇""踏入新门派"）
    · suspense（悬念）：抛疑问/暗示真相、勾起好奇（如"谁盗走了灵珠""古宅里的低语""神秘的包裹"）
  通用约束：纯名词/短语，概括核心意象或关键事件；绝对不能包含任何角色人名，也不能含"第N章"字样；可含地点/物品/氛围/动作。若实在无法概括可留空字符串。
- "impactScore": 数字 1-10，本章对主线剧情的整体影响力
  - 1-3: 日常过渡章节（角色互动、日常描写）
  - 4-6: 有实质性剧情推进（新线索、新冲突）
  - 7-9: 重大转折/揭露（角色死亡、真相大白、阵营倒戈）
  - 10: 全书核心转折点（最终决战、终极揭示）
---`,
        },
        {
          role: "user",
          content: `章节标题：${chapterTitle}\n出场角色：${charNames}\n\n【章末原文——最后一段】\n${lastParagraphs}\n\n【完整正文】\n${chapterContent}`,
        },
      ],
      temperature: 0.3,
      maxTokens: 1536, // 加大，容纳脉搏数据
    });

    const parsed = parseSummaryResponse(response.content);

    // ── 蒸馏评分：对关键事件进行 S/A/B/C 分层 ──
    const roleMap: Record<string, string> = {};
    for (const c of characters) {
      roleMap[c.name] = c.role;
    }

    const events = parsed.keyEvents.map((event) => ({
      description: event,
      chapterDiff: existingSummariesCount || 0, // 本章的事件，diff=0（最新）
      category: classifyEventCategory(event) as EventCategory,
      characterIds: characters.filter((c) => event.includes(c.name)).map((c) => c.id),
      characterRoleMap: roleMap,
    }));

    const eventImportances = scoreAndClassifyEvents(events);

    return { ...parsed, eventImportances };
  }

  // ─── 工具调用 ─────────────────────────────────────────────

  /** 返回所有已注册工具的 function schema（用于 LLM tools 参数） */
  getToolSchemas(): ToolSchema[] {
    return toolRegistry.getAllSchemas();
  }

  /** 执行指定工具调用 */
  async executeToolCall(name: string, args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    return toolRegistry.execute(name, args, ctx);
  }

}
