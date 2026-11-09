/**
 * 游戏模式 —— 核心引擎
 *
 * 职责：
 * 1. 加载游戏会话上下文（章纲、角色、世界观、历史轮次、背包）
 * 2. 调用 LLM 流式生成叙事
 * 3. 解析 AI 输出（叙事/选项/实体/物品/进度）
 * 4. 管理背包和实体状态
 * 5. 结束导出时：检查章尾悬念钩子 → 生成结尾 → 拼接正文 → 保存为 StoryNode.content
 */

import { prisma } from "@/lib/prisma";
import { withNodeLockGen } from "@/lib/game-lock";
import { assertNodeUnchanged, OptimisticLockError } from "@/lib/optimistic-lock";
import { getApprovedCharacters, getApprovedLore } from "@/lib/approved-cards";
import { getEffectiveConfig, createLLMClient } from "@/core/llm/client";
import { evaluateConfirmEligibility, applyConfirm } from "@/core/confirm-guard";
import { STATUS_COMPLETED, STATUS_CONFIRMED, STATUS_DRAFTING } from "@/core/story-status";
import { buildGameSystemPrompt, buildActionPrompt, parseGameOutput, buildPersonaContract, buildPersonaRoundAnchor, buildDirectorContract, buildDirectorRoundAnchor, isConfrontationalAction } from "./game-prompts";
import { arbitrateRoll, computeAdjustments, nextRollStats, judgeRoll, rateLabel, type RollStats } from "./roll-arbiter";
import type { GameActionInput, GameTurnOutput, GameSessionContext, GameEntity, GameItem, GameOption, GameSessionSummary } from "./types";

// 物品变动输入（含可选 owner，用于背包按 name+owner 隔离，阿游 P1）。
interface ItemChangeRequest {
  operation: string;
  name: string;
  quantity?: number;
  owner?: string;
}

const DEFAULT_OWNER = "主角";

// 按 (name, owner) 二元组应用背包变动，保证主角与 NPC 同名物品互不干扰（阿游 P1）。
// 纯函数：深拷贝每一项再修改，绝不改动入参（便于单测与并发安全）。
export function applyItemChanges(
  prevItems: GameItem[],
  changes: ItemChangeRequest[],
  round: number
): GameItem[] {
  let updatedItems: GameItem[] = prevItems.map((i) => ({ ...i }));
  const matches = (i: GameItem, name: string, owner: string) =>
    i.name === name && (i.owner || DEFAULT_OWNER) === owner;

  for (const change of changes) {
    const owner = change.owner || DEFAULT_OWNER;
    if (change.operation === "gain") {
      const idx = updatedItems.findIndex((i) => matches(i, change.name, owner));
      if (idx >= 0) {
        updatedItems[idx] = {
          ...updatedItems[idx],
          quantity: updatedItems[idx].quantity + (change.quantity || 1),
          owner: updatedItems[idx].owner || owner,
        };
      } else {
        updatedItems.push({
          name: change.name,
          quantity: change.quantity || 1,
          category: "other",
          source: `第${round}轮获得`,
          acquiredRound: round,
          owner,
        });
      }
    } else if (change.operation === "consume") {
      const idx = updatedItems.findIndex((i) => matches(i, change.name, owner));
      if (idx >= 0) {
        const q = updatedItems[idx].quantity - (change.quantity || 1);
        if (q <= 0) {
          updatedItems.splice(idx, 1);
        } else {
          updatedItems[idx] = { ...updatedItems[idx], quantity: q };
        }
      }
    } else if (change.operation === "equip") {
      const idx = updatedItems.findIndex((i) => matches(i, change.name, owner));
      if (idx >= 0) updatedItems[idx] = { ...updatedItems[idx], equipped: true };
    } else if (change.operation === "unequip") {
      // 阿游 P1-1：脱下/解下类。仅清 equipped 标记，物品仍在背包（不删）。
      const idx = updatedItems.findIndex((i) => matches(i, change.name, owner));
      if (idx >= 0) updatedItems[idx] = { ...updatedItems[idx], equipped: false };
    } else if (change.operation === "discard") {
      const idx = updatedItems.findIndex((i) => matches(i, change.name, owner));
      if (idx >= 0) {
        const q = updatedItems[idx].quantity - (change.quantity || 1);
        if (q <= 0) {
          updatedItems.splice(idx, 1);
        } else {
          updatedItems[idx] = { ...updatedItems[idx], quantity: q };
        }
      }
    } else if (change.operation === "destroy") {
      // 阿游 P1-1：损毁/摧毁类。从背包移除该物品（按数量递减，归零即移除）。
      const idx = updatedItems.findIndex((i) => matches(i, change.name, owner));
      if (idx >= 0) {
        const q = updatedItems[idx].quantity - (change.quantity || 1);
        if (q <= 0) {
          updatedItems.splice(idx, 1);
        } else {
          updatedItems[idx] = { ...updatedItems[idx], quantity: q };
        }
      }
    } else if (change.operation === "transfer") {
      // P1 万物可交互：归属转移。CI|转移|物品名|数量|新归属——
      // change.owner = 新归属者；原持有者从账里按物品名查（同名多人时取持量>0 且非新归属的第一人）。
      const prevOwnerEntry = updatedItems.find(
        (i) => i.name === change.name && (i.owner || DEFAULT_OWNER) !== owner && i.quantity > 0
      );
      // 1) 原持有者扣减
      if (prevOwnerEntry) {
        const idx = updatedItems.findIndex((i) => i === prevOwnerEntry);
        const q = updatedItems[idx].quantity - (change.quantity || 1);
        if (q <= 0) {
          updatedItems.splice(idx, 1);
        } else {
          updatedItems[idx] = { ...updatedItems[idx], quantity: q };
        }
      }
      // 2) 新归属者入账（已有则加量并保留 acquiredRound，无则新建——damage 状态随物走）
      const destIdx = updatedItems.findIndex((i) => matches(i, change.name, owner));
      if (destIdx >= 0) {
        updatedItems[destIdx] = { ...updatedItems[destIdx], quantity: updatedItems[destIdx].quantity + (change.quantity || 1) };
      } else {
        updatedItems.push({
          name: change.name,
          quantity: change.quantity || 1,
          category: prevOwnerEntry?.category || "other",
          source: `第${round}轮${prevOwnerEntry ? `来自${prevOwnerEntry.owner || DEFAULT_OWNER}` : "转移"}`,
          acquiredRound: round,
          owner,
          damaged: prevOwnerEntry?.damaged,
        });
      }
    } else if (change.operation === "damage") {
      // P1：受损但仍存在（区别于 destroy 移除）——后续可修复，也可能藏着内情。
      const idx = updatedItems.findIndex((i) => matches(i, change.name, owner));
      if (idx >= 0) updatedItems[idx] = { ...updatedItems[idx], damaged: true };
    } else if (change.operation === "skip") {
      // 阿游 P1-1：流转/出售类（典当/抵押/出售经 OP_MAP 归一）。安全跳过，不改动背包。
      // 直接 no-op 返回成功（无告警，属预期行为）。
    } else {
      // 阿游 P1-1 修复：收窄兜底，不再对一切未知动词无脑 gain（原 else→gain 反向坑）。
      // 仅当操作确属「获得/得到/获取」类动词才兜底 gain（避免静默丢物）；
      // 其余真正未知动词 → 告警并安全跳过（不污染背包计数）。
      const SAFE_SKIP = new Set([
        "出售", "售卖", "交换", "交易", "卖出", "买出", "当掉", "典当", "抵押", "典押",
      ]);
      const GAIN_LIKE = new Set([
        "获得", "得到", "获取", "收下", "赢得", "缴获", "收到", "得手", "到手",
        "拾取", "捡到", "取得", "拾起", "拿",
      ]);
      if (SAFE_SKIP.has(change.operation)) {
        console.warn(`[applyItemChanges] 已知流转操作「${change.operation}」跳过入库（不计入背包）：${change.name}`);
      } else if (GAIN_LIKE.has(change.operation)) {
        const idx = updatedItems.findIndex((i) => matches(i, change.name, owner));
        if (idx >= 0) {
          updatedItems[idx] = {
            ...updatedItems[idx],
            quantity: updatedItems[idx].quantity + (change.quantity || 1),
            owner: updatedItems[idx].owner || owner,
          };
        } else {
          updatedItems.push({
            name: change.name,
            quantity: change.quantity || 1,
            category: "other",
            source: `第${round}轮获得`,
            acquiredRound: round,
            owner,
          });
        }
      } else {
        console.warn(
          `[applyItemChanges] 未知操作「${change.operation}」，无明确获得语义→安全跳过（不污染背包）：${change.name}`
        );
      }
    }
  }
  return updatedItems;
}

// ─── 会话管理 ──────────────────────────────────────────────────

/** 创建或恢复游戏会话 */
export async function ensureGameSession(
  projectId: string,
  nodeId: string,
  originalContentSnapshot?: string | null,
) {
  let session = await prisma.gameSession.findUnique({
    where: { projectId_nodeId: { projectId, nodeId } },
    include: { states: { orderBy: { round: "asc" } } },
  });

  if (!session) {
    // 检查 node 是否存在
    const node = await prisma.storyNode.findUnique({ where: { id: nodeId } });
    if (!node) throw new Error(`章节节点 ${nodeId} 不存在`);

    // IMP-001 快照修复：以「作者进入游戏那一刻」的 node.content 拍原正文快照作为第 0 段前置。
    // 若传了 preservedSnapshot（来自上一局会话），则复用同一份原正文，保证跨 reset 不变、二次导出不堆叠。
    const snapshot =
      originalContentSnapshot && originalContentSnapshot.length > 0
        ? originalContentSnapshot
        : (node.content || "");

    session = await prisma.gameSession.create({
      data: {
        projectId,
        nodeId,
        status: "active",
        currentRound: 0,
        totalWords: 0,
        maxWords: 3000,
        plotProgress: 0,
        originalContentSnapshot: snapshot,
      },
      include: { states: { orderBy: { round: "asc" } } },
    });
  }

  return session;
}

/**
 * 游戏本：创建或恢复某章的会话（一章一局）。
 * 与 ensureGameSession 平行：node 会话绑小说章节，saga 会话绑 GameSagaChapter。
 */
export async function ensureSagaSession(sagaId: string, sagaChapterId: string) {
  let session = await prisma.gameSession.findFirst({
    where: { sagaChapterId },
    include: { states: { orderBy: { round: "asc" } } },
  });
  if (!session) {
    const chapter = await prisma.gameSagaChapter.findUnique({ where: { id: sagaChapterId } });
    if (!chapter || chapter.sagaId !== sagaId) throw new Error(`游戏本章节 ${sagaChapterId} 不存在`);
    const saga = await prisma.gameSaga.findUnique({ where: { id: sagaId }, select: { projectId: true } });
    if (!saga) throw new Error(`游戏本 ${sagaId} 不存在`);
    session = await prisma.gameSession.create({
      data: {
        projectId: saga.projectId,
        nodeId: null,
        sagaId,
        sagaChapterId,
        status: "active",
        currentRound: 0,
        totalWords: 0,
        maxWords: 3000,
        plotProgress: 0,
        originalContentSnapshot: chapter.content || "",
      },
      include: { states: { orderBy: { round: "asc" } } },
    });
  }
  return session;
}

/** 游戏本：重开某章（清轮次重建会话，与 resetGameSession 语义对齐） */
export async function resetSagaChapterSession(sagaId: string, sagaChapterId: string) {
  const existing = await prisma.gameSession.findFirst({ where: { sagaChapterId } });
  if (existing) {
    await prisma.gameState.deleteMany({ where: { sessionId: existing.id } });
    await prisma.gameSession.delete({ where: { id: existing.id } });
  }
  return ensureSagaSession(sagaId, sagaChapterId);
}

/** 获取会话摘要（返回给前端） */
export async function getSessionSummary(sessionId: string): Promise<GameSessionSummary> {
  const session = await prisma.gameSession.findUnique({
    where: { id: sessionId },
    include: { states: { orderBy: { round: "asc" } } },
  });
  if (!session) throw new Error(`游戏会话 ${sessionId} 不存在`);

  const allNarrative = session.states.map((s) => s.narrative).filter(Boolean).join("\n\n");
  // 合并实体并按 name 去重（取末轮快照，阿游 P1-2），避免跨轮重复累积导致实体面板数据膨胀。
  const entityMap = new Map<string, GameEntity>();
  for (const s of session.states) {
    for (const e of (s.entities as unknown as any[]) || []) {
      if (e?.name) entityMap.set(e.name, e as GameEntity);
    }
  }
  const entities = Array.from(entityMap.values());
  const items = session.states.length > 0
    ? ((session.states[session.states.length - 1].items as unknown as any[]) || []) as GameItem[]
    : [];
  const lastState = session.states[session.states.length - 1];
  const lastOptions = lastState ? (lastState.options as unknown as GameOption[]) : [];

  return {
    id: session.id,
    projectId: session.projectId,
    nodeId: session.nodeId,
    sagaId: session.sagaId,
    sagaChapterId: session.sagaChapterId,
    status: session.status,
    currentRound: session.currentRound,
    totalWords: session.totalWords,
    maxWords: session.maxWords,
    plotProgress: session.plotProgress,
    entities,
    items,
    lastOptions,
    allNarrative,
    turns: session.states.map((s) => ({
      round: s.round,
      playerAction: s.playerAction,
      narrative: s.narrative,
      options: (s.options as unknown as GameOption[]) || [],
    })),
  };
}

// ─── 上下文加载 ────────────────────────────────────────────────

async function loadGameContext(session: any): Promise<GameSessionContext> {
  // ── 游戏本（Saga）路径：不绑小说章节，章纲/正文来自 GameSagaChapter，
  //    角色/世界书等长期资产在派生本下实时取项目现值（跨模式共享），从零新建用前传快照。──
  if (session.sagaChapterId && !session.nodeId) {
    const [chapter, saga, states] = await Promise.all([
      prisma.gameSagaChapter.findUnique({ where: { id: session.sagaChapterId } }),
      prisma.gameSaga.findUnique({ where: { id: session.sagaId! } }),
      prisma.gameState.findMany({
        where: { sessionId: session.id },
        orderBy: { round: "asc" },
      }),
    ]);
    if (!chapter || !saga) throw new Error("游戏本或章节不存在");

    let snap: any = {};
    try { snap = saga.sourceSnapshot ? JSON.parse(saga.sourceSnapshot) : {}; } catch { /* 坏快照当空 */ }

    const [characters, loreEntries] = saga.projectId
      ? await Promise.all([
          getApprovedCharacters(prisma, saga.projectId, { take: 20 }),
          getApprovedLore(prisma, saga.projectId, { take: 15 }),
        ])
      : [
          (snap.characters || []) as any[],
          (snap.lore || []) as any[],
        ];

    // 合并实体（去重）
    const entityMap = new Map<string, GameEntity>();
    for (const s of states) {
      for (const e of (s.entities as unknown as any[]) || []) {
        if (!entityMap.has(e.name)) entityMap.set(e.name, e as GameEntity);
      }
    }
    const latestItems: GameItem[] = states.length > 0
      ? ((states[states.length - 1].items as unknown as any[]) || [])
      : [];

    return {
      bookName: snap.bookName || saga.title,
      chapterTitle: chapter.title,
      outline: chapter.outline ?? null,
      existingContent: (chapter.content || "").trim() || null,
      characters: characters.map((c: any) => ({
        name: c.name,
        role: c.role,
        currentStatus: c.currentStatus,
        briefDescription: c.background?.slice(0, 100) || "",
      })),
      worldLore: loreEntries.map((l: { title: string; content: string }) => ({ title: l.title, content: l.content })),
      previousTurns: states.map((s: { round: number; playerAction: string; narrative: string }) => ({
        round: s.round,
        playerAction: s.playerAction,
        narrative: s.narrative,
      })),
      entities: Array.from(entityMap.values()),
      items: latestItems,
      currentRound: session.currentRound,
      totalWords: session.totalWords,
      maxWords: session.maxWords,
      plotProgress: session.plotProgress,
      // 叙事视点：first 第二人称亲历 | third 第三人称小说镜头 | god 群像上帝/GM
      narrativeMode: ((saga as any).narrativeMode || "first") as "first" | "third" | "god",
      playAsName: saga.playAsName ?? null,
      // 暗账（P1 谎言与伪装）：未揭露的真相注入 prompt（仅 AI 可见），跨章持久
      secretLedger: (() => {
        try { return JSON.parse(saga.secretLedger || "[]"); } catch { return []; }
      })(),
    };
  }

  // ── 章节节点路径（小说项目内开游戏，原逻辑）──
  const projectId = session.projectId as string;
  const nodeId = session.nodeId as string;
  const [project, node, characters, loreEntries, states] = await Promise.all([
    prisma.project.findUnique({ where: { id: projectId } }),
    prisma.storyNode.findUnique({ where: { id: nodeId } }),
    getApprovedCharacters(prisma, projectId, { take: 20 }),
    getApprovedLore(prisma, projectId, { take: 15 }),
    prisma.gameState.findMany({
      where: { sessionId: session.id },
      orderBy: { round: "asc" },
    }),
  ]);

  if (!project || !node) throw new Error("项目或章节节点不存在");

  // 合并实体（去重）
  const entityMap = new Map<string, GameEntity>();
  for (const s of states) {
    for (const e of (s.entities as unknown as any[]) || []) {
      if (!entityMap.has(e.name)) entityMap.set(e.name, e as GameEntity);
    }
  }

  // 最新背包状态
  const latestItems: GameItem[] = states.length > 0
    ? ((states[states.length - 1].items as unknown as any[]) || [])
    : [];

  return {
    bookName: project.name,
    chapterTitle: node.title,
    outline: node.outline ?? null,
    existingContent: (node.content || "").trim() || null, // v0.46.58：本章已有正文
    characters: characters.map((c: { name: string; role: string; currentStatus: string; background?: string }) => ({
      name: c.name,
      role: c.role,
      currentStatus: c.currentStatus,
      briefDescription: c.background?.slice(0, 100) || "",
    })),
    worldLore: loreEntries.map((l: { title: string; content: string }) => ({ title: l.title, content: l.content })),
    previousTurns: states.map((s: { round: number; playerAction: string; narrative: string }) => ({
      round: s.round,
      playerAction: s.playerAction,
      narrative: s.narrative,
    })),
    entities: Array.from(entityMap.values()),
    items: latestItems,
    currentRound: session.currentRound,
    totalWords: session.totalWords,
    maxWords: session.maxWords,
    plotProgress: session.plotProgress,
  };
}

// ─── 核心游戏循环 ──────────────────────────────────────────────

/**
 * 处理一个游戏回合——流式版本
 * 返回一个 AsyncGenerator，逐 token 产出 SSE 事件
 */
export async function* processGameTurn(input: GameActionInput, signal?: AbortSignal): AsyncGenerator<{
  type: string;
  content?: string;
  narrative?: string;
  options?: GameOption[];
  newEntities?: GameEntity[];
  itemChanges?: { operation: string; name: string; quantity: number }[];
  plotProgress?: number;
  wordCount?: number;
  /** P0-4 跑团检定：骰面事件（含检定官明细） */
  d100?: number;
  tier?: string;
  label?: string;
  successRate?: number;
  reasons?: string[];
  error?: string;
}> {
  // 1. 加载会话和上下文
  const session = await prisma.gameSession.findUnique({
    where: { id: input.sessionId },
    include: { states: { orderBy: { round: "asc" } } },
  });
  if (!session) {
    yield { type: "error", error: "游戏会话不存在" };
    return;
  }
  if (session.status !== "active") {
    yield { type: "error", error: "游戏已结束" };
    return;
  }

  // FIX-3：按 nodeId/saga 串行化同目标的并发回合，避免两个并发请求都读到旧状态、
  // 后写覆盖先写导致游戏状态（轮次/背包/实体）丢失。不同目标之间仍并行。
  const lockKey = session.nodeId ?? `saga:${session.sagaId}`;
  yield* withNodeLockGen(lockKey, () => runLockedTurn(input, signal, session));
}

/**
 * processGameTurn 的实际回合逻辑。已在 withNodeLockGen 持锁期间执行，
 * 因此同一 node 的并发回合严格排队、互不打断（不同 node 仍并行）。
 */
async function* runLockedTurn(
  input: GameActionInput,
  signal: AbortSignal | undefined,
  session: any,
): AsyncGenerator<{
  type: string;
  content?: string;
  narrative?: string;
  options?: GameOption[];
  newEntities?: GameEntity[];
  itemChanges?: { operation: string; name: string; quantity: number }[];
  plotProgress?: number;
  wordCount?: number;
  /** P0-4 跑团检定：骰面事件（含检定官明细） */
  d100?: number;
  tier?: string;
  label?: string;
  successRate?: number;
  reasons?: string[];
  error?: string;
}> {
  const ctx = await loadGameContext(session);

  // 2. 组装提示词
  // 视角契约（三档）：first/third 扮演镜头角色；god 不扮演任何人，注入导演契约（三重契约之①②）
  let personaBlock = "";
  let personaAnchor = "";
  const narrativeMode = ctx.narrativeMode || "first";
  if (session.sagaId) {
    if (narrativeMode === "god") {
      personaBlock = buildDirectorContract(ctx.characters.map((c) => c.name));
      personaAnchor = `${buildDirectorRoundAnchor()}\n\n`;
    } else {
      const saga = await prisma.gameSaga.findUnique({
        where: { id: session.sagaId },
        select: { playAsCharacterId: true, playAsName: true },
      });
      const target = (saga?.playAsCharacterId || saga?.playAsName)
        ? ctx.characters.find((c) => c.name === saga!.playAsName)
        : undefined;
      if (target) {
        personaBlock = buildPersonaContract({
          name: target.name,
          role: target.role,
          briefDescription: target.briefDescription,
          otherNames: ctx.characters.filter((c) => c.name !== target.name).map((c) => c.name),
          person: narrativeMode === "third" ? "third" : "second",
        });
        personaAnchor = `${buildPersonaRoundAnchor(target.name)}\n\n`;
      }
    }
  }
  const systemPrompt = personaBlock ? `${personaBlock}\n\n${buildGameSystemPrompt(ctx)}` : buildGameSystemPrompt(ctx);
  // 阿游 P1-1：从上一轮 states 取出所选选项文本，让 prompt 显式承接分支
  let selectedOptionText: string | undefined;
  if (input.selectedOption != null && session.states.length > 0) {
    const lastState = session.states[session.states.length - 1] as any;
    const opts = (lastState?.options || []) as any[];
    const hit = opts.find((o: any) => o?.index === input.selectedOption);
    if (hit) selectedOptionText = hit.text;
  }
  let userPromptBase = buildActionPrompt({ ...input, selectedOptionText });
  // 上帝/GM：玩家输入是导演编排（而非某角色言行），显式标注，避免 AI 当成角色台词
  if (narrativeMode === "god") {
    userPromptBase = `【导演编排｜上帝视角】\n${userPromptBase}`;
  }

  // 骰子检定（P0-4 + 检定官进阶 + 两段式）：saga 跑团模式下，对抗类行动先由检定官裁定
  // 动态成功率（能力对比/情境修正/连胜连败/重复惩罚），再掷 d100 定结果，AI 只演不判。
  // 两段式：前端已掷骰（preRolled，含重骰后的最终结果）→ 引擎直接采用，不再重掷。
  let rollBlock = "";
  if (session.sagaId) {
    const sagaRoll = await prisma.gameSaga.findUnique({
      where: { id: session.sagaId },
      select: { rollMode: true, rollStats: true, playAsName: true, projectId: true },
    });
    if (narrativeMode !== "god" && sagaRoll?.rollMode === "tabletop" && isConfrontationalAction(input.actionType, input.actionText)) {
      // 行动指纹（重复检测）
      const actionKey = `${input.actionType}|${(input.actionText || "").slice(0, 40)}|${input.target ?? ""}`;
      const prevStats: RollStats = (sagaRoll.rollStats as any) || { winStreak: 0, loseStreak: 0, lastKey: "", repeatCount: 0 };

      let d100: number;
      let finalRate: number;
      let reasons: string[];

      if (input.preRolled && typeof input.preRolled.d100 === "number" && typeof input.preRolled.successRate === "number") {
        // 两段式第二段：采用前端掷定的结果
        d100 = input.preRolled.d100;
        finalRate = Math.max(1, Math.min(99, Math.round(input.preRolled.successRate)));
        reasons = input.preRolled.reasons || [];
      } else {
        // 旧路径（无预掷）：检定官在本请求内裁定+掷骰
        const adjustments = computeAdjustments(prevStats, actionKey);

        // 检定官上下文：角色能力要点 + 装备 + 最近叙事
        const personaBrief = personaBlock
          ? personaBlock.slice(0, 400) // 契约块里已含扮演角色要点
          : (ctx.characters.find((c) => c.role === "protagonist")?.briefDescription ?? "");
        const itemsBrief = ctx.items.map((i) => `${i.name}×${i.quantity}${i.equipped ? "（已装备）" : ""}`).join("、");
        const recentNarrative = ctx.previousTurns.slice(-2).map((t) => t.narrative).join("\n") || ctx.existingContent?.slice(-400) || "";

        const verdict = await arbitrateRoll({
          actionText: input.actionText,
          actionType: input.actionType,
          target: input.target,
          personaBrief,
          recentNarrative,
          itemsBrief,
          adjustments,
        });
        d100 = 1 + Math.floor(Math.random() * 100);
        finalRate = verdict.finalRate;
        reasons = verdict.reasons;
      }

      const judged = judgeRoll(d100, finalRate);
      rollBlock = [
        `\n\n【骰子判定（既定结果，必须如实演绎，不得更改）】`,
        `检定：d100=${d100}，成功率=${finalRate}%（${rateLabel(finalRate)}）→ ${judged.label}。`,
        reasons.length > 0 ? `难度依据：${reasons.join("；")}。` : ``,
        `要求：${judged.key === "critical_success" ? "超预期达成，并有意外之喜" : judged.key === "success" ? "顺利达成" : judged.key === "partial" ? "达成目的但付出可见代价（受伤/暴露/结怨/损失）" : judged.key === "fail" ? "行动受阻、被阻止或被反制" : "严重受挫且出人意料（如当场被识破/反被制服/弄巧成拙）"}。把结果演成有趣的故事，不要生硬宣布成败。`,
      ].join("");

      yield {
        type: "roll",
        d100,
        tier: judged.key,
        label: judged.label,
        successRate: finalRate,
        reasons,
      };

      // 更新动态状态（防退化三件套的记忆；重骰后的最终结果为准；保留重骰次数）
      const nextStats = { ...nextRollStats(prevStats, actionKey, judged.success), rerollsLeft: prevStats.rerollsLeft };
      await prisma.gameSaga.update({
        where: { id: session.sagaId },
        data: { rollStats: nextStats as any },
      }).catch(() => {});
    }
  }
  const userPrompt = personaAnchor + userPromptBase + rollBlock;

  // 3. 获取 LLM 配置并创建客户端
  const llmConfig = await getEffectiveConfig();
  const client = createLLMClient(llmConfig);

  // 4. 流式生成
  const messages = [
    { role: "system" as const, content: systemPrompt },
    { role: "user" as const, content: userPrompt },
  ];

  let fullResponse = "";
  try {
    const stream = client.chatStream({
      model: llmConfig.writerModel,
      messages,
      temperature: 0.85,
      // N1 修复：推理模型思考链吃预算，抬到 2500 保证正文非空（与 game/start 对齐）
      maxTokens: 2500,
      signal, // 阿游 P1-1：把前端透传的 abort 信号转发到底层 fetch，停止后 LLM 真正中断、灭 token 浪费
    });
    for await (const chunk of stream) {
      // 流式期用户停止：abort 信号透传进来后立即放弃本轮，停止消费并准备丢弃提交（阿游 P0-1）
      if (signal?.aborted) return;
      if (chunk.content) {
        fullResponse += chunk.content;
        yield { type: "token", content: chunk.content };
      }
    }
  } catch (err: any) {
    // 用户主动停止（abort）不是失败：优雅放弃本轮，不污染回放/对账
    if (err?.name === "AbortError" || signal?.aborted) return;
    yield { type: "error", error: `LLM 调用失败：${err?.message ?? err}` };
    return;
  }

  // 空流保护（阿游 P1-2）：若 LLM 返回 0 个 chunk，fullResponse 为空。
  // 此时不解析、不提交，直接 return 跳过 $transaction，
  // 避免产生「空叙事幻影轮次」污染回放——与 Round7 P0-2 自愈一致。
  if (!fullResponse.trim()) {
    yield { type: "error", error: "LLM 返回为空，本轮未提交" };
    return;
  }

  // 5. 解析输出
  const parsed = parseGameOutput(fullResponse);
  const wordCount = parsed.narrative.length;

  // 如果没有解析到选项，给兜底选项
  let finalOptions = parsed.options;
  if (finalOptions.length < 2) {
    finalOptions = [
      { index: 1, text: "继续向前探索" },
      { index: 2, text: "仔细观察周围环境" },
      { index: 3, text: "与身边的人交谈" },
    ];
  }

  // 6. 更新背包和实体（按 name+owner 隔离，阿游 P1）
  const newRound = session.currentRound + 1;
  const updatedItems = applyItemChanges(
    ctx.items,
    parsed.itemChanges as ItemChangeRequest[],
    newRound
  );

  // 合并实体
  const existingEntities = ctx.entities;
  const newEntities = parsed.newEntities.filter(
    (ne) => !existingEntities.find((e) => e.name === ne.name)
  );
  const allEntities = [
    ...existingEntities,
    ...newEntities.map((ne) => ({
      ...ne,
      firstSeenRound: session.currentRound + 1,
    })),
  ];

  // 持久化前最终核对 abort：若用户已在流式期停止（signal 透传，阿游 P0-1），
  // 此处丢弃本轮——不提交 gameState/session，不创建孤儿世界卡词条，与「停止=放弃本轮」语义一致，
  // 后端权威态停在 N，前端 abort 后 GET /api/game/state 对账读到 N，前后端不再错位。
  if (signal?.aborted) {
    return;
  }

  // 6.5 世界卡物品联动：游戏新获得的物品，若无对应 item 类世界书词条则自动补充（保留已有物品词条）
  // 批量查询去重（FIX-10 低风险项）：把循环内 N 次 findMany 合并为 1 次。
  const gainItems = parsed.itemChanges
    .filter((c) => c.operation === "gain")
    .map((c) => ({ name: c.name, owner: (c as any).owner || "主角" }));
  if (gainItems.length > 0) {
    await ensureItemLorebooks(session.projectId, gainItems);
  }

  // 7. 持久化本轮状态
  const newTotalWords = session.totalWords + wordCount;
  const finalProgress = parsed.plotProgress > 0 ? parsed.plotProgress : session.plotProgress;

  // 7→8 两步写包进事务：避免「gameState 已落库、session 未更新」之间断流留下孤儿态（阿游 P0-2）。
  // 提交时机：仅在解析成功、即将产出 game_done 的这一步提交；流式 token 阶段不落库，
  // 故不存在「流式中间提前提交」。若用户停止/断网，后端已提交的权威态由前端 abort 后
  // GET /api/game/state 对账回拉覆盖（reconcileFromSummary），自愈前后端错位。
  // Round12 A1：gameState 现已落库 @@unique([sessionId, round])（schema.prisma:376），
  // 并发/重试写入同 round 会抛 P2002。改用 upsert：存在则更新、不存在则创建，幂等且不抛错，
  // 与下方 gameSession.update 同处一事务，保持原子性、不留孤儿态。
  await prisma.$transaction([
    prisma.gameState.upsert({
      where: { sessionId_round: { sessionId: session.id, round: newRound } },
      create: {
        sessionId: session.id,
        round: newRound,
        playerAction:
          input.selectedOption != null
            ? `选择选项${input.selectedOption}${selectedOptionText ? `：${selectedOptionText}` : ""}`
            : (input.actionText || ACTION_TYPE_LABELS[input.actionType] || "自定义行动"),
        narrative: parsed.narrative,
        options: finalOptions as any,
        entities: allEntities as any,
        items: updatedItems as any,
        plotProgress: finalProgress,
        wordCount,
      },
      update: {
        playerAction:
          input.selectedOption != null
            ? `选择选项${input.selectedOption}${selectedOptionText ? `：${selectedOptionText}` : ""}`
            : (input.actionText || ACTION_TYPE_LABELS[input.actionType] || "自定义行动"),
        narrative: parsed.narrative,
        options: finalOptions as any,
        entities: allEntities as any,
        items: updatedItems as any,
        plotProgress: finalProgress,
        wordCount,
      },
    }),
    prisma.gameSession.update({
      where: { id: session.id },
      data: {
        currentRound: newRound,
        totalWords: newTotalWords,
        plotProgress: finalProgress,
      },
    }),
  ]);

  // P1 暗账：TRICK 合并写入 saga.secretLedger（跨章持久的伏笔账，仅 AI 可见）。
  // 按 name+owner 去重：同一伪装重复输出只记一次；REVEAL 销账（真相已揭露，移除该条避免重复注入/重复揭露）。
  if (session.sagaId && (parsed.newTricks.length > 0 || parsed.newReveals.length > 0)) {
    const saga = await prisma.gameSaga.findUnique({ where: { id: session.sagaId }, select: { secretLedger: true } });
    let ledger: Array<{ name: string; owner: string; truth: string; round: number }> = [];
    try { ledger = JSON.parse(saga?.secretLedger || "[]"); } catch { /* 坏账当空 */ }
    let changed = false;
    for (const t of parsed.newTricks) {
      if (!ledger.find((s) => s.name === t.name && s.owner === t.owner)) {
        ledger.push({ name: t.name, owner: t.owner, truth: t.truth, round: newRound });
        changed = true;
      }
    }
    for (const r of parsed.newReveals) {
      const before = ledger.length;
      ledger = ledger.filter((s) => !(s.name === r.name && (!r.owner || s.owner === r.owner)));
      if (ledger.length !== before) changed = true;
    }
    if (changed) {
      await prisma.gameSaga.update({ where: { id: session.sagaId }, data: { secretLedger: JSON.stringify(ledger) } });
    }
  }

  // P1 世界卡联动（回合路径补齐，与开局路径 ensureItemLorebook 对齐）：
  // 回合内获得/转移的物品同步建/更新世界书词条（归属随剧情流动），长期资产跨模式共享。
  if (session.projectId) {
    for (const change of parsed.itemChanges) {
      if (change.operation === "gain") {
        await ensureItemLorebook(session.projectId, change.name, change.owner || "主角");
      } else if (change.operation === "transfer") {
        // 转移：为新归属建/更新词条（原持有者词条保留历史，不删——揭露伏笔时可翻旧账）
        await ensureItemLorebook(session.projectId, change.name, change.owner || "主角");
      }
    }
  }

  // 9. 产出完整回合结果
  yield {
    type: "game_done",
    narrative: parsed.narrative,
    options: finalOptions,
    newEntities,
    itemChanges: parsed.itemChanges,
    plotProgress: finalProgress,
    wordCount,
  };
}

/**
 * 世界卡物品联动：确保某物品在世界书中有对应 item 类词条。
 * 已有则保留；无则补充创建（记录归属），使背包物品与世界卡双向打通。
 */
// 世界卡物品联动：确保某物品在世界书中有对应 item 类词条。
// 已有则保留；无则补充创建（记录归属），使背包物品与世界卡双向打通。
// Round12 A4b：去重维度加 owner——主角与同名 NPC 物品各建独立词条，避免共用世界卡丢失归属。
export async function ensureItemLorebook(projectId: string, itemName: string, owner: string) {
  if (!itemName || itemName.length < 2) return;
  const candidates = await prisma.lorebookEntry.findMany({
    where: { projectId, category: "item", title: itemName },
  });
  // 仅在「同 title 且同归属 owner」的词条缺失时才新建，否则保留已有（归属已被该 owner 占用）。
  const ownerTag = `归属：${owner}`;
  const owned = candidates.find((e) => (e.content || "").includes(ownerTag));
  if (owned) return;
  await prisma.lorebookEntry.create({
    data: {
      projectId,
      title: itemName,
      category: "item",
      keys: [itemName],
      content: `[游戏获得] 物品「${itemName}」，归属：${owner}。`,
      insertionOrder: 60,
      enabled: true,
      relatedEntryIds: [],
      reviewStatus: "pending",
    },
  });
}

/**
 * 批量世界卡物品联动（FIX-10 低风险项）：把循环内 N 次 findMany 合并为 1 次。
 * 与 ensureItemLorebook 语义一致——按 (name, owner) 去重，仅缺「同归属」词条时新建。
 */
export async function ensureItemLorebooks(
  projectId: string,
  items: { name: string; owner: string }[],
) {
  if (items.length === 0) return;
  const distinctNames = Array.from(new Set(items.map((i) => i.name)));
  const existing = await prisma.lorebookEntry.findMany({
    where: { projectId, category: "item", title: { in: distinctNames } },
    select: { title: true, content: true },
  });
  for (const it of items) {
    if (!it.name || it.name.length < 2) continue;
    const ownerTag = `归属：${it.owner}`;
    const owned = existing.find(
      (e) => e.title === it.name && (e.content || "").includes(ownerTag),
    );
    if (owned) continue;
    await prisma.lorebookEntry.create({
      data: {
        projectId,
        title: it.name,
        category: "item",
        keys: [it.name],
        content: `[游戏获得] 物品「${it.name}」，归属：${it.owner}。`,
        insertionOrder: 60,
        enabled: true,
        relatedEntryIds: [],
        reviewStatus: "pending",
      },
    });
  }
}

// 类型标签（避免跨文件导入问题）
const ACTION_TYPE_LABELS: Record<string, string> = {
  observe: "观察",
  dialogue: "对话",
  combat: "战斗",
  explore: "探索",
  use_item: "使用物品",
  rest: "休息",
  option: "选择选项",
  custom: "自定义行动",
};

/**
 * 开始游戏（流式）——复用与 processGameTurn 相同的 SSE 事件协议
 * 逐 token 产出 {type:"token"}，最后产出 {type:"start_done"}。
 * 这样「开始游戏」期间前端即可实时看到开场叙事逐字流出，不再空等整段生成完。
 */
export async function* processGameStart(
  input: {
    projectId?: string;
    nodeId?: string;
    /** 游戏本（Saga）模式：与 nodeId 二选一 */
    sagaId?: string;
    sagaChapterId?: string;
    concept?: string | null;
  },
  signal?: AbortSignal
): AsyncGenerator<{
  type: string;
  content?: string;
  sessionId?: string;
  narrative?: string;
  options?: GameOption[];
  newEntities?: GameEntity[];
  itemChanges?: { operation: string; name: string; quantity: number }[];
  items?: GameItem[];
  plotProgress?: number;
  wordCount?: number;
  totalWords?: number;
  currentRound?: number;
  error?: string;
}> {
  // 1. 创建或重置会话（双模式：小说章节 node / 游戏本 sagaChapter）
  const isSaga = !!(input.sagaId && input.sagaChapterId);
  const session = isSaga
    ? await resetSagaChapterSession(input.sagaId!, input.sagaChapterId!)
    : await resetGameSession(input.projectId!, input.nodeId!);

  // 2. 加载上下文（双模式）
  let bookName: string;
  let chapterTitle: string;
  let chapterOutline: string | null;
  let existingContent: string;
  let characters: Array<{ name: string; role: string; currentStatus: string; background?: string }>;
  let loreEntries: Array<{ title: string; content: string }>;
  let sagaPlayAs: { playAsCharacterId: string | null; playAsName: string | null } | null = null;
  let sagaNarrativeMode: "first" | "third" | "god" = "first";
  let personaBlock = "";
  let sagaSynopsis = "";

  if (isSaga) {
    const [chapter, saga] = await Promise.all([
      prisma.gameSagaChapter.findUnique({ where: { id: input.sagaChapterId! } }),
      prisma.gameSaga.findUnique({ where: { id: input.sagaId! } }),
    ]);
    if (!chapter || !saga) {
      yield { type: "error", error: "游戏本或章节不存在" };
      return;
    }
    sagaPlayAs = { playAsCharacterId: saga.playAsCharacterId, playAsName: saga.playAsName };
    sagaNarrativeMode = ((saga as any).narrativeMode || "first") as "first" | "third" | "god";
    let snap: any = {};
    try { snap = saga.sourceSnapshot ? JSON.parse(saga.sourceSnapshot) : {}; } catch { /* 坏快照当空 */ }
    sagaSynopsis = typeof snap.synopsis === "string" ? snap.synopsis : "";
    // 长期资产：派生本实时取项目角色卡/世界书（跨模式共享）；从零新建用前传快照
    const assets = saga.projectId
      ? await Promise.all([
          getApprovedCharacters(prisma, saga.projectId, { take: 20 }),
          getApprovedLore(prisma, saga.projectId, { take: 15 }),
        ])
      : [
          (snap.characters || []) as any[],
          (snap.lore || []) as any[],
        ];
    bookName = snap.bookName || saga.title;
    chapterTitle = chapter.title;
    chapterOutline = chapter.outline ?? null;
    existingContent = (chapter.content || "").trim();
    characters = assets[0];
    loreEntries = assets[1];
  } else {
    const [project, node, nodeCharacters, nodeLore] = await Promise.all([
      prisma.project.findUnique({ where: { id: input.projectId! } }),
      prisma.storyNode.findUnique({ where: { id: input.nodeId! } }),
      getApprovedCharacters(prisma, input.projectId!, { take: 20 }),
      getApprovedLore(prisma, input.projectId!, { take: 15 }),
    ]);

    if (!project || !node) {
      yield { type: "error", error: "项目或章节不存在" };
      return;
    }
    // #123 软删防复活：已移入回收站的节点不允许开始游戏，避免污染 tombstone
    if (node.deletedAt) {
      yield { type: "error", error: "该节点已被删除（回收站），无法开始游戏。如需操作请先从回收站恢复" };
      return;
    }
    bookName = project.name;
    chapterTitle = node.title;
    chapterOutline = node.outline ?? null;
    existingContent = (node.content || "").trim();
    characters = nodeCharacters;
    loreEntries = nodeLore;
  }

  // 3. 组装起始提示词
  const ctx = {
    bookName,
    chapterTitle,
    outline: chapterOutline,
    existingContent: existingContent || null,
    characters: characters.map((c: { name: string; role: string; currentStatus: string; background?: string }) => ({
      name: c.name,
      role: c.role,
      currentStatus: c.currentStatus,
      briefDescription: c.background?.slice(0, 100) || "",
    })),
    worldLore: loreEntries.map((l: { title: string; content: string }) => ({ title: l.title, content: l.content })),
    previousTurns: [] as any[],
    entities: [] as any[],
    items: [] as any[],
    currentRound: 0,
    totalWords: existingContent.length,
    maxWords: 3000,
    plotProgress: 0,
    narrativeMode: sagaNarrativeMode,
    playAsName: sagaPlayAs?.playAsName ?? null,
  };

  const systemPromptBase = buildGameSystemPrompt(ctx);
  const userPromptBase = existingContent
    ? `【开始游戏】本章已有正文 ${existingContent.length} 字。请从现有正文的结尾自然续接，为游戏开场：简短承接上一段情节，然后给出 3-4 个编号选项让玩家选择接下来的行动。`
    : chapterOutline
      ? `【开始游戏】根据章纲，为本章写一个开场。从"${chapterOutline.slice(0, 80)}..."开始，生成精彩的入场叙事。记住在叙事结束后给出 3-4 个编号选项。`
      : `【开始游戏】为本章写一个精彩的开场。描述场景、氛围和角色的初始状态，然后给出 3-4 个编号选项。`;
  const userPrompt = sagaNarrativeMode === "god"
    ? `${userPromptBase}\n\n（上帝视角：开场用全知群像写，不设「你」；给出的 3-4 个编号选项要写成「接下来可以怎么编排」的方向，例如：把镜头切到某人／让某事发生／同时推进两条线。）`
    : userPromptBase;

  // 视角契约（三档）：first/third 需要扮演者；god 不扮演任何人，注入导演契约
  let personaName: string | null = null;
  if (isSaga) {
    if (sagaNarrativeMode === "god") {
      personaBlock = buildDirectorContract(characters.map((c: any) => c.name));
    } else {
      const target = characters.find(
        (c: any) => c.id === (sagaPlayAs?.playAsCharacterId ?? null) || c.name === sagaPlayAs?.playAsName
      );
      if (target) {
        personaName = target.name;
        personaBlock = buildPersonaContract({
          name: target.name,
          role: target.role,
          briefDescription: target.background || "",
          otherNames: characters.filter((c: any) => c.name !== target.name).map((c: any) => c.name),
          person: sagaNarrativeMode === "third" ? "third" : "second",
        });
      }
    }
  }
  const systemPrompt = personaBlock ? `${personaBlock}\n\n${systemPromptBase}` : systemPromptBase;

  // 前情提要（连续扮演的命脉）：saga 已归档章节的结尾部分自动注入开场，
  // 玩家点「继续下一章」后无缝续玩——不需要任何手动导入/复制。
  let sagaRecap = "";
  if (isSaga) {
    const archived = await prisma.gameSagaChapter.findMany({
      where: { sagaId: input.sagaId!, status: "archived" },
      orderBy: { index: "asc" },
    });
    if (archived.length > 0) {
      const parts = archived
        .slice(-3) // 最近 3 章足够承接；更早的剧情由 AI 在叙事中自然回顾
        .map((c) => `《${c.title}》（结尾）：…${(c.content || "").slice(-500)}`);
      sagaRecap = `\n\n【前情提要——前面章节的结尾，本章开场必须自然承接这些情节，不得凭空重启】\n${parts.join("\n\n")}`;
    }
  }

  // 三重契约之②：每轮 user prompt 头部重申视角锚（防长上下文漂移）
  const personaAnchor = personaName ? `${buildPersonaRoundAnchor(personaName)}\n\n` : "";

  // 世界观前置（从零新建的游戏本）：用户创建时输入的设定，作为开场的硬前置
  const sagaWorldSeed = isSaga && !chapterOutline && sagaSynopsis
    ? `\n\n【世界观前置——本次扮演的世界与身份设定，开场必须遵循，不得另起炉灶】\n${sagaSynopsis}`
    : "";

  const finalUserPrompt = `${personaAnchor}${
    input.concept
      ? `${userPrompt}${sagaRecap}${sagaWorldSeed}\n\n【构思参考】玩家已采用以下开场构思，请据此展开本章开场叙事，自然融入而非照抄原文：${input.concept}`
      : `${userPrompt}${sagaRecap}${sagaWorldSeed}`
  }`;

  // 4. 调用 LLM（流式，逐 token 产出）
  const llmConfig = await getEffectiveConfig();
  const client = createLLMClient(llmConfig);
  const messages = [
    { role: "system" as const, content: systemPrompt },
    { role: "user" as const, content: finalUserPrompt },
  ];

  let fullResponse = "";
  try {
    const stream = client.chatStream({
      model: llmConfig.writerModel,
      messages,
      temperature: 0.85,
      maxTokens: 2500,
      signal,
    });
    for await (const chunk of stream) {
      if (signal?.aborted) return;
      if (chunk.content) {
        fullResponse += chunk.content;
        yield { type: "token", content: chunk.content };
      }
    }
  } catch (err: any) {
    if (err?.name === "AbortError" || signal?.aborted) return;
    yield { type: "error", error: `LLM 调用失败：${err?.message ?? err}` };
    return;
  }

  if (!fullResponse.trim()) {
    yield { type: "error", error: "LLM 返回为空，开场未生成" };
    return;
  }

  // 5. 解析
  const parsed = parseGameOutput(fullResponse);
  const wordCount = parsed.narrative.length;

  let finalOptions = parsed.options;
  if (finalOptions.length < 2) {
    finalOptions = [
      { index: 1, text: "仔细观察周围环境" },
      { index: 2, text: "与身边的人交谈" },
      { index: 3, text: "继续探索前进" },
    ];
  }

  const entities = parsed.newEntities.map((ne) => ({
    ...ne,
    firstSeenRound: 1,
  }));

  const initialItems: any[] = [];
  for (const change of parsed.itemChanges) {
    if (change.operation === "gain") {
      initialItems.push({
        name: change.name,
        quantity: change.quantity,
        category: change.category || "other",
        owner: change.owner || "主角",
        source: "开场获得",
        acquiredRound: 1,
      });
    }
  }

  for (const item of initialItems) {
    // 世界卡物品联动：仅派生本（有项目）联动；从零新建无项目可挂
    if (session.projectId) {
      await ensureItemLorebook(session.projectId, item.name, item.owner || "主角");
    }
  }

  // 用户中途停止：丢弃本轮，不提交空会话态
  if (signal?.aborted) return;

  // 6. 保存第一轮状态
  await prisma.gameState.create({
    data: {
      sessionId: session.id,
      round: 1,
      playerAction: "开始游戏",
      narrative: parsed.narrative,
      options: finalOptions as any,
      entities: entities as any,
      items: initialItems as any,
      plotProgress: parsed.plotProgress > 0 ? parsed.plotProgress : 5,
      wordCount,
    },
  });

  await prisma.gameSession.update({
    where: { id: session.id },
    data: {
      currentRound: 1,
      totalWords: wordCount,
      plotProgress: parsed.plotProgress > 0 ? parsed.plotProgress : 5,
    },
  });

  // 7. 产出开场结果
  yield {
    type: "start_done",
    sessionId: session.id,
    narrative: parsed.narrative,
    options: finalOptions,
    newEntities: entities,
    itemChanges: parsed.itemChanges,
    items: initialItems,
    plotProgress: parsed.plotProgress > 0 ? parsed.plotProgress : 5,
    totalWords: wordCount,
    currentRound: 1,
  };
}

// ─── 结束并导出 ────────────────────────────────────────────────

/**
 * 结束游戏，将累积正文保存为章节内容
 *
 * 流程：
 * 1. 检查章纲是否有"章尾悬念"钩子
 * 2. 有钩子 → 用钩子生成结尾叙事
 * 3. 无钩子 → 生成自然收尾
 * 4. 拼接所有叙事 + 结尾 → 保存 StoryNode.content
 * 5. 标记会话完成
 */
export async function endGameAndExport(sessionId: string): Promise<{
  nodeId: string | null;
  projectId: string | null;
  /** 游戏本（Saga）模式：归档目标章节 */
  sagaChapterId: string | null;
  finalContent: string;
  /** 本次结束本章时 AI 新写的收尾段（前端用它即时上屏，不必等重新拉全章） */
  endingNarrative: string;
  totalWords: number;
  status: string;
  autoConfirmed: boolean;
  autoFilled: boolean;
  qualityScore: number | null;
  /** v3.1.133 对比模式：作者进入游戏时刻的原正文快照（供导出后二选一保留） */
  originalContent: string;
}> {
  const session = await prisma.gameSession.findUnique({
    where: { id: sessionId },
    include: {
      states: { orderBy: { round: "asc" } },
      node: true,
      sagaChapter: true,
    },
  });
  if (!session) throw new Error("游戏会话不存在");
  if (session.status !== "active") throw new Error("游戏已结束");

  const isSaga = !!(session.sagaChapterId && !session.nodeId);
  // #123 软删防复活：已移入回收站的节点不允许导出游戏叙事，避免污染 tombstone
  if (!isSaga && session.node?.deletedAt) {
    throw new Error("该节点已被删除（回收站），无法导出游戏。如需操作请先从回收站恢复");
  }

  // 1. 拼接已有叙事
  // IMP-001 修复：游戏导出须保留写作原正文作为第 0 段前置，否则已有正文章节开启游戏并导出后
  // 原正文被游戏轮次整体覆盖（数据丢失）。
  // 关键：必须以「作者进入游戏时刻」的原正文快照（session.originalContentSnapshot）为前置，
  // 而非实时 session.node.content —— 后者在首次导出后已被改写为「原正文+游戏轮次」，
  // 若再次导出会把它当成原正文重复前置，造成堆叠损坏。快照跨 reset 复用，保证多次导出前置同一份原正文。
  // saga 模式：前置 = 游戏本章收束前的既有正文（chapter.content，会话创建时已快照同值）。
  const originalContent = isSaga
    ? session.sagaChapter?.content || session.originalContentSnapshot || ""
    : session.originalContentSnapshot || session.node?.content || "";
  const existingNarrative = [
    originalContent,
    ...session.states.map((s) => s.narrative),
  ]
    .filter(Boolean)
    .join("\n\n");

  // 2. 检查章尾悬念钩子
  const outline = isSaga
    ? session.sagaChapter?.outline ?? null
    : session.node?.outline ?? null;
  let endingHook: string | null = null;
  if (outline) {
    // 匹配 【章尾悬念】：... 或 - **【章尾悬念】**：...
    const hookMatch = outline.match(/【章尾悬念】(?:：|:)\s*(.+?)(?:\n|$)/);
    if (hookMatch) {
      endingHook = hookMatch[1].trim();
    }
  }

  // 收尾口径必须跟当前叙事视点一致，否则上帝/第三人称收尾突然变回「你」会跳戏
  let endingPersonaRule = "";
  if (isSaga) {
    const book = await prisma.gameSaga.findUnique({
      where: { id: session.sagaChapter!.sagaId },
      select: { narrativeMode: true, playAsName: true },
    });
    const emode = book?.narrativeMode || "first";
    const elens = (book?.playAsName || "主角").trim();
    endingPersonaRule = emode === "god"
      ? "本章收尾用全知群像口径：不设「你」，交代各方人物此刻各自的状态、去向或心事，像群像剧落幕。"
      : emode === "third"
        ? `本章收尾用第三人称写「${elens}」（${elens}／他／她），不要用「你」。`
        : "本章收尾用第二人称「你」写主角。";
  }

  // 3. 调用 LLM 生成结尾
  const llmConfig = await getEffectiveConfig();
  const client = createLLMClient(llmConfig);

  let endingPrompt: string;
  if (endingHook) {
    endingPrompt = `${endingPersonaRule}

本章即将结束。章纲预定了一个章节结尾的悬念钩子：

【章尾悬念】：${endingHook}

请基于此钩子，结合前面已完成的剧情，生成 2-3 段叙事为本章收尾。保留悬念感和余韵，但也要给本章一个完整的收束。不要出现任何游戏标记（NE/CI/PROGRESS/选项编号）。像正常小说章节一样自然收尾。`;
  } else {
    endingPrompt = `${endingPersonaRule}

本章即将结束。请基于前面已完成的剧情，生成 2-3 段叙事为本章收尾。可以是：
- 环境的淡出描写
- 角色的内心独白
- 时间的过渡提示
- 情绪的沉淀收束

要求：自然、有画面感、像正常小说章节一样收尾。不要出现任何游戏标记。`;
  }

  const messages = [
    {
      role: "system" as const,
      content: `你是专业小说写手。前面正文已完成，现在需要写章尾收束段落。\n\n前面正文：\n${existingNarrative.slice(-800)}`,
    },
    { role: "user" as const, content: endingPrompt },
  ];

  let endingNarrative = "";
  try {
    const stream = client.chatStream({
      model: llmConfig.writerModel,
      messages,
      temperature: 0.8,
      // N1 修复：章尾收束段在推理模型下 400 预算会全被思考链吃光，抬到 2500
      maxTokens: 2500,
    });
    for await (const chunk of stream) {
      if (chunk.content) {
        endingNarrative += chunk.content;
      }
    }
  } catch {
    // 如果 LLM 调用失败，用一个简单的收尾
    endingNarrative = "\n\n——本章完——";
  }

  // 4. 拼接最终内容（纯正文，无游戏标记）
  const finalContent = (existingNarrative + "\n\n" + endingNarrative).trim();
  const finalWordCount = finalContent.length;

  // 5. 落库（双模式）：
  //  - node 模式：轻确认导出，与正式章节确认流程完全统一（Round1 遗留边界 #519）——
  //    先评估质量分并落 drafting，再按项目「智能审阅」开关走自动确认（Round1 #519）。
  //  - saga 模式：归档进 GameSagaChapter（content + archived）——游戏本是自足创作空间，
  //    不碰小说项目任何数据；确认/定稿在游戏本自己的回流动作里做。
  let autoConfirmed = false;
  let autoFilled = false;
  let qualityScore: number | null = null;

  if (isSaga) {
    const el = evaluateConfirmEligibility(
      { content: finalContent, qualityScore: null },
      [],
      true,
    );
    qualityScore = el.score ?? null;
    await prisma.gameSagaChapter.update({
      where: { id: session.sagaChapterId! },
      data: {
        content: finalContent,
        status: "archived",
      },
    });
  } else {
    const nodeId = session.nodeId!;
    const nodeForConfirm = session.node;
    const el = evaluateConfirmEligibility(
      { content: finalContent, qualityScore: null },
      [],
      true,
    );
    qualityScore = el.score ?? null;
    const proj = await prisma.project.findUnique({
      where: { id: session.projectId! },
      select: { autoConfirmEnabled: true },
    });
    const autoConfirmOn = proj?.autoConfirmEnabled ?? true;

    // FIX-4 乐观并发校验：导出写回前确认本节点自会话开始以来没被并发修改，
    // 变了就中止导出（抛错由 /api/game/end 路由收敛为错误响应），避免覆盖并发编辑。
    try {
      await assertNodeUnchanged(prisma as any, nodeId, {
        revisionCount: session.node?.revisionCount,
        updatedAt: session.node?.updatedAt,
      });
    } catch (oe) {
      if (oe instanceof OptimisticLockError) {
        throw new OptimisticLockError(
          `游戏导出中止：章节在游戏进行期间被并发修改（${oe.message}），为避免覆盖你的编辑，已取消本次导出。`
        );
      }
      throw oe;
    }

    await prisma.storyNode.update({
      where: { id: nodeId },
      data: {
        content: finalContent,
        wordCount: finalWordCount,
        status: STATUS_DRAFTING,
        qualityScore: el.score ?? null,
      },
    });

    if (autoConfirmOn && el.eligible) {
      try {
        const fillMsg = await applyConfirm({
          id: nodeId,
          projectId: session.projectId!,
          content: finalContent,
          order: nodeForConfirm?.order ?? 0,
        });
        autoConfirmed = true;
        // IMP-003：记录导出是否真的回填了设定库，供前端给出明确提示（避免静默改动世界观）
        autoFilled = typeof fillMsg === "string" && fillMsg.includes("已执行");
      } catch (acErr) {
        console.error("[game-light-confirm] 自动确认失败，保持 drafting：", acErr);
      }
    }
    // 非自动确认或不达标 → 维持 drafting，由用户在确认栏手动定稿（与正式章节一致）
  }

  // 6. 标记会话完成
  await prisma.gameSession.update({
    where: { id: sessionId },
    data: { status: "completed" },
  });

  return {
    nodeId: session.nodeId,
    projectId: session.projectId,
    sagaChapterId: session.sagaChapterId,
    finalContent,
    endingNarrative,
    totalWords: finalWordCount,
    status: isSaga ? "archived" : autoConfirmed ? STATUS_CONFIRMED : STATUS_DRAFTING,
    autoConfirmed,
    autoFilled,
    qualityScore,
    originalContent,
  };
}

/**
 * 清除旧会话（重新开始游戏时用）
 */
export async function resetGameSession(projectId: string, nodeId: string) {
  // R2-013 修复：每次「开局 / 重置游戏会话」都重拍作者「当前正在编辑」的实时 node.content 为原正文快照，
  // 确保快照始终 == 工作区真实正文，避免作者润色游戏导出章节后重开游戏时，手动编辑被首次入游的旧快照无声覆盖；
  // 同时消除两局语境错位（C0 旧快照与 C1 实时内容来源不同一）。
  // 注意：endGameAndExport 仍用快照作前置（防「同会话重复导出」的堆叠逻辑不变），此处只是把快照来源刷新为实时正文。
  // 取舍（遗留风险）：若作者「导出后未手动编辑」就直接重开游戏，上一局的游戏正文会被并入新快照基线
  // （即旧游戏输出现在成为新局的「原正文前置」），跨多次重开会持续累积；这与 IMP-001「重开即丢弃旧游戏输出、回到纯净原正文」的语义不同。
  const node = await prisma.storyNode.findUnique({ where: { id: nodeId } });
  const freshSnapshot = node?.content || "";

  const existing = await prisma.gameSession.findUnique({
    where: { projectId_nodeId: { projectId, nodeId } },
  });
  if (existing) {
    await prisma.gameState.deleteMany({ where: { sessionId: existing.id } });
    await prisma.gameSession.delete({ where: { id: existing.id } });
  }
  return ensureGameSession(projectId, nodeId, freshSnapshot);
}
