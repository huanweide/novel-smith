/**
 * 基础动词与扩展动作 —— 自由模式的"手"
 *
 * 设计判据（来自沉浸拟真与跑团）：
 *   · 引擎不强制手段，只负责把"你想做什么"翻译成一次行动；
 *   · 动词不是权限，是**入口**。送礼/聊天/偷窃/杀死只是四个最常用的入口，
 *     其余一切靠"描述"这一格自由输入，永远不被拒绝。
 *   · 每个动词都带代价与风险，但**代价不阻止你**——它只决定这一下有多难、花多久。
 *
 * 三条铁律（写在这里防止后来者加"世界常识"）：
 *   1. 不许按时间/地点写"这个动词不能用"。夜里能不能偷东西，由世界书决定，不由这里决定。
 *   2. 不许按好感写"这个动词消失"。跟仇人搭话永远可选，只是结果难看。
 *   3. 扩展动作（玩家自定义的那 6 格）与基础动词**同权**，不许降级处理。
 */

import type { GameActionType } from "./types";

/** 四个基础动词 + 一个永远存在的自由描述 */
export type BaseVerb = "gift" | "talk" | "steal" | "kill" | "describe";

export interface VerbSpec {
  key: BaseVerb;
  /** 按钮上显示的字 */
  label: string;
  /** 归一到既有的 actionType，复用引擎既有链路 */
  actionType: GameActionType;
  /** 时间代价：一天四段（晨/午/暮/夜），半日=2 */
  costPeriods: number;
  /** 有风险（可能失败、可能招祸） */
  risk: boolean;
  /** 判定难度修正（正=更容易）。这是"这一下有多难"，不是"能不能" */
  difficulty: number;
  /** 拼成给模型的行动句；target 为空时用兜底说法 */
  phrase: (target: string) => string;
  /** 这一动词成功后，好感变化的基础值（负数=变差） */
  relationSuccess: number;
  /** 成功但有代价时的好感变化 */
  relationCost: number;
  /** 失败时的好感变化 */
  relationFail: number;
}

export const BASE_VERBS: Record<BaseVerb, VerbSpec> = {
  gift: {
    key: "gift",
    label: "送礼",
    actionType: "use_item",
    costPeriods: 0,
    risk: false,
    difficulty: 5,
    phrase: (t) => (t ? `把东西送给${t}` : "把东西送出去"),
    relationSuccess: 3,
    relationCost: 1,
    relationFail: -1,
  },
  talk: {
    key: "talk",
    label: "聊天",
    actionType: "dialogue",
    costPeriods: 1,
    risk: false,
    difficulty: 0,
    phrase: (t) => (t ? `跟${t}说说话` : "找个人说说话"),
    relationSuccess: 2,
    relationCost: 1,
    relationFail: -1,
  },
  steal: {
    key: "steal",
    label: "偷窃",
    actionType: "custom",
    costPeriods: 1,
    risk: true,
    difficulty: -15,
    phrase: (t) => (t ? `从${t}身上偷东西` : "顺手牵羊"),
    relationSuccess: -6,
    relationCost: -10,
    relationFail: -18,
  },
  kill: {
    key: "kill",
    label: "杀死",
    actionType: "combat",
    costPeriods: 1,
    risk: true,
    difficulty: -25,
    phrase: (t) => (t ? `对${t}下杀手` : "动手杀人"),
    relationSuccess: -40,
    relationCost: -30,
    relationFail: -25,
  },
  describe: {
    key: "describe",
    label: "描述",
    actionType: "custom",
    costPeriods: 0,
    risk: false,
    difficulty: 0,
    phrase: (t) => t,
    relationSuccess: 0,
    relationCost: 0,
    relationFail: 0,
  },
};

export const BASE_VERB_KEYS: BaseVerb[] = ["gift", "talk", "steal", "kill"];

// ─── 扩展动作（玩家自定义的 6 格）─────────────────────────────

/** 扩展按键固定 6 格：不多不少，多了记不住，少了不够用 */
export const EXTENDED_SLOT_COUNT = 6;

export interface ExtendedAction {
  /** 槽位 0-5，固定 */
  slot: number;
  /** 按钮上的字，玩家自己写，≤ 8 字（例：辱骂他） */
  label: string;
  /** 实际发出去的那句话，玩家自己写，≤ 60 字（例：指着他的鼻子骂他是个忘恩负义的东西） */
  text: string;
}

/** 六格默认值：给不知道写什么的人一个起点，玩家可整格改掉 */
export const DEFAULT_EXTENDED: ExtendedAction[] = [
  { slot: 0, label: "辱骂", text: "指着他骂一顿" },
  { slot: 1, label: "安抚", text: "放软语气，先把他稳住" },
  { slot: 2, label: "试探", text: "绕着弯问一句，看他的反应" },
  { slot: 3, label: "威胁", text: "把话说到他不得不应的份上" },
  { slot: 4, label: "示弱", text: "露出一点狼狈，让他松口" },
  { slot: 5, label: "离开", text: "不再纠缠，转身就走" },
];

/** 判定难度：扩展动作按文本粗分类，但**永不因为分类不给用** */
const HARD_WORDS = /(杀|砍|捅|打|砸|抢|烧|毁|掐|勒|刺|劈|炸)/;
const SOFT_WORDS = /(说|问|劝|求|笑|哄|聊|夸|服软|示弱|道歉|安抚|解释)/;

/**
 * 把一条扩展动作算成一次行动。
 * 不做"能不能"的判断——只给代价、风险、难度。
 */
export function specForExtended(a: ExtendedAction): VerbSpec {
  const text = `${a.label}${a.text}`;
  const hard = HARD_WORDS.test(text);
  const soft = SOFT_WORDS.test(text);
  return {
    key: "describe",
    label: a.label || `动作${a.slot + 1}`,
    actionType: "custom",
    costPeriods: hard ? 1 : 0,
    risk: hard,
    difficulty: hard ? -20 : soft ? 5 : 0,
    phrase: () => a.text || a.label,
    relationSuccess: hard ? -8 : soft ? 1 : 0,
    relationCost: hard ? -5 : 0,
    relationFail: hard ? -4 : -1,
  };
}

/** 从行动类型/文本猜出用的是哪个基础动词（只用于记好感，不用于拦人） */
export function inferVerb(actionType: string, actionText: string): BaseVerb {
  const t = actionText || "";
  if (actionType === "combat") return "kill";
  if (actionType === "dialogue") return "talk";
  if (/(送|赠|给|递|塞给|交给|献给|献上)/.test(t)) return "gift";
  if (/(偷|盗|摸走|顺走|扒|窃)/.test(t)) return "steal";
  if (/(杀|砍|捅|刺|勒|掐死)/.test(t)) return "kill";
  return "describe";
}

/** 把动词与目标拼成一句给模型的行动指令（保留玩家原话时优先用原话） */
export function composeAction(spec: VerbSpec, target: string, raw?: string): string {
  const own = (raw || "").trim();
  if (spec.key === "describe") return own;
  const base = spec.phrase(target);
  return own ? `${base}（玩家原话：${own}）` : base;
}
