/**
 * 游戏模式（交互式文本冒险）—— 类型定义
 *
 * 游戏模式是"写正文的另一种方式"：
 * 用户输入行动 → AI 生成 1-3 段叙事 → 给出 2-4 个选项 → 循环
 * 最终累积正文保存为章节内容。
 */

// ─── 行动类型（6 个快捷按钮 + 自定义输入 + 选项选择）──────────

export type GameActionType =
  | "observe"   // 观察环境/人物
  | "dialogue"  // 与 NPC 对话
  | "combat"    // 战斗
  | "explore"   // 探索新区域
  | "use_item"  // 使用背包物品
  | "rest"      // 休息/恢复
  | "option"    // 选择了编号选项
  | "custom"    // 自定义文本输入
  | "declare";  // 玩家声明一个世界事实（R9：共享叙事权威）

export const ACTION_LABELS: Record<GameActionType, string> = {
  observe: "观察",
  dialogue: "对话",
  combat: "战斗",
  explore: "探索",
  use_item: "使用物品",
  rest: "休息",
  option: "选项",
  custom: "自定义",
  declare: "声明事实",
};

export const ACTION_ICONS: Record<GameActionType, string> = {
  observe: "🔍",
  dialogue: "💬",
  combat: "⚔️",
  explore: "🗺️",
  use_item: "🎒",
  rest: "💤",
  option: "🔢",
  custom: "✏️",
  declare: "🖋️",
};

// ─── 游戏实体 ─────────────────────────────────────────────────

export interface GameEntity {
  name: string;
  type: string;       // character | location | item | faction | technique | creature | other
  description: string;
  firstSeenRound?: number; // 由引擎在持久化时设置
}

// ─── 背包物品 ─────────────────────────────────────────────────

export interface GameItem {
  name: string;
  quantity: number;
  category: string;   // consumable | equipment | quest | currency | other
  source: string;     // 获得来源描述
  acquiredRound: number;
  owner?: string;     // 归属者（谁的物品），默认「主角」
  equipped?: boolean; // 是否已装备（阿游 P0-3）
  damaged?: boolean;  // P1 万物可交互：受损（仍存在，可修复/藏内情）
}

// ─── 物品变动记录 ─────────────────────────────────────────────

export interface ItemChange {
  // 7 值：与引擎 applyItemChanges / 前端 applyFrontendItemChanges 实际分支完全对齐（阿游 Round12 B2 修类型谎言）
  operation:
    | "gain"      // 获得
    | "consume"   // 消耗
    | "equip"     // 装备
    | "discard"   // 丢弃
    | "unequip"   // 脱下/解下（仅清 equipped，不删物品）
    | "destroy"   // 损毁（数量递减，归零移除）
    | "skip";     // 流转/出售（安全跳过，不入库）
  name: string;
  quantity?: number;
  owner?: string; // 归属者（与背包 name+owner 隔离对齐，阿游 P1）
}

// ─── 游戏选项（下一轮）─────────────────────────────────────────

export interface GameOption {
  index: number;  // 1-4
  text: string;
}

// ─── 玩家行动输入 ─────────────────────────────────────────────

export interface GameActionInput {
  sessionId: string;
  actionType: GameActionType;
  actionText: string;       // 自定义文本 或 按钮标签
  selectedOption?: number;  // 如果选了编号选项
  selectedOptionText?: string; // 上一轮选项对应的文本（承接分支用，由引擎从 states 补全）
  /** 玩家声明事实（actionType=declare 时使用）：一句话既定事实，引擎校验后并入世界状态 */
  declareText?: string;
  /** JEV 分流：轻回合（看一眼/挪一步）只写过场，不展开——节奏不该被小事拖慢 */
  light?: boolean;
  targetItem?: string;      // 如果用物品，目标物品名
  target?: string;          // 行动目标：本次交互针对的角色/生物/势力/物品名（目标指定，阿游 R-目标）
  /** 两段式判定：前端已掷的骰（/api/game/roll），引擎直接采用不重掷（AI 只演不判） */
  preRolled?: {
    d100: number;
    successRate: number;
    reasons?: string[];
  };
}

// ─── AI 回合输出 ──────────────────────────────────────────────

export interface GameTurnOutput {
  narrative: string;        // 1-3 段叙事正文
  options: GameOption[];    // 2-4 个选项
  newEntities: GameEntity[];
  itemChanges: ItemChange[];
  plotProgress: number;     // 0-100
  wordCount: number;        // 本轮字数
}

// ─── 游戏会话上下文（组装提示词用）────────────────────────────

export interface GameSessionContext {
  bookName: string;
  chapterTitle: string;
  outline: string | null;           // 章纲原文
  existingContent: string | null;   // v0.46.58：本章已有正文（游戏从其后续接）
  characters: Array<{
    name: string;
    role: string;
    currentStatus: string;
    briefDescription: string;
  }>;
  worldLore: Array<{
    title: string;
    content: string;
  }>;
  previousTurns: Array<{
    round: number;
    playerAction: string;
    narrative: string;
  }>;
  entities: GameEntity[];
  items: GameItem[];
  currentRound: number;
  totalWords: number;
  maxWords: number;
  plotProgress: number;
  // 叙事视点（三档，随 AI 演算自然切换玩法感）：
  // first 第一人称单一视角（第二人称「你」，只知道扮演角色所知）
  // third 第三人称小说视角（镜头跟随某角色，像读小说）
  // god   群像上帝/GM（不扮演任何人，全知多线，输入是导演编排）
  narrativeMode?: "first" | "third" | "god";
  playAsName?: string | null; // first/third 的镜头角色
  // 暗账（表层/真相分层，P1）：仅注入 prompt 给 AI，UI 不显示（god 模式例外：上帝本就全知）
  secretLedger?: Array<{ name: string; owner: string; truth: string; round: number }>;
  // R9 自由度扩展：从会话/游戏本持久态读取，注入 prompt 让 AI 围绕其创作
  causalitySeeds?: CausalitySeed[]; // 未了因果种子库（鬼谷八荒式因果链）
  declaredFacts?: DeclaredFact[];   // 玩家既定事实（FATE Core 式共享叙事权威）
  goals?: PlayerGoal[];             // 玩家自定义目标（无强制主线）
  /**
   * 叙事账本上下文（故事线 / 待收伏笔 / 已确认世界卡 / 6 阶段 / 跨章编年）。
   * 由游戏本路径从 saga.causality 信封读出并注入；非游戏本路径为空串。
   * 只有「玩家看得见 + AI 也看得见」才算协同，单做 UI 不算。
   */
  narrativeContext?: string;
  /** 章序元数据，供结算时的 syncRound 记编年 / 算阶段（避免重复查库） */
  sagaMeta?: {
    chapterIndex: number;
    chapterTitle: string;
    totalChapters: number;
    worldTime?: string;
  };
}

// ─── 游戏会话摘要（返回给前端）────────────────────────────────

export interface GameSessionSummary {
  id: string;
  projectId: string | null;
  nodeId: string | null;
  /** 游戏本（Saga）关联：node 会话为 null */
  sagaId?: string | null;
  sagaChapterId?: string | null;
  status: string;
  currentRound: number;
  totalWords: number;
  maxWords: number;
  plotProgress: number;
  entities: GameEntity[];
  items: GameItem[];
  lastOptions: GameOption[];
  allNarrative: string;     // 全部累积正文
  turns: Array<{
    round: number;
    playerAction: string;
    narrative: string;
    options: GameOption[];
  }>;
}

// ─── R9 自由度扩展：因果链 / 声明事实 / 玩家目标 ──────────────

/** 因果类型（与提示词 CAUSE|类型|相关实体|描述 白名单对齐） */
export type CausalityType = "善缘" | "仇怨" | "羁绊" | "因果" | "誓言";

/** 因果种子：玩家某个行动埋下的"因"，后续在合适时机自然回响（鬼谷八荒式"无限可能"引擎） */
export interface CausalitySeed {
  id: string;
  type: CausalityType;
  subject: string;   // 相关实体（人物/势力/地点）—— 因涉及谁
  description: string; // 因的描述（埋下时的情形）
  plantedRound: number; // 埋下轮次
  triggered: boolean;   // 是否已兑现（回响）
  triggeredRound?: number;
}

/** 玩家声明事实：玩家用"作者权"直接声明一个世界既定事实（FATE Core 式"declare a story detail"） */
export interface DeclaredFact {
  id: string;
  text: string;       // 声明的事实文本
  declaredRound: number;
}

/** 玩家自定义目标：无强制主线，玩家自定追求，AI 围绕其生成机会但不强行完成 */
export interface PlayerGoal {
  id: string;
  text: string;
  createdRound: number;
  done?: boolean;
}
