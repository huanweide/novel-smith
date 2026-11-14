/**
 * JEV 判定层 —— Verify（可行性）/ Judge（要不要掷骰），纯函数、零 LLM、零 IO
 *
 * 为什么单独一层：
 *   让大模型当裁判，等于每做一件小事都要写一段理由——慢，而且它会"礼貌地拒绝"，
 *   把拒绝写进正文（"你没有礼物，所以不能赠送"），读起来像系统提示。
 *   这里把"世界不允许"与"角色可能失败"彻底分开：
 *     · 世界不允许（人不在、物没有、路不通）→ 界面直接说，不进正文；
 *     · 角色可能失败（对手强、运气差）→ 交给骰子/判定，正文演成好坏结果。
 *
 * 与 JEV（TypeSafe AI 的 System One 决策模型）同构：
 *   JEV 不生成文字，只做 Choice / Score / Noul 三种判定并给置信度；
 *   这里的 `decideAct` 就是那套契约的**本地规则后端**——零成本、可离线、确定性。
 *   将来接真 JEV（或本地小模型前向打分）时，只替换 `decideAct` 的实现，
 *   上层（action 路由）与候选集（意图盘）都不用改。
 *
 * 一条硬判据：**宁可放过，不可错拦**。
 *   拦错一次，玩家会以为游戏在管他；放过多一次，最多是叙事里演个失败。
 *   所以所有规则都必须"确定才知道"，拿不准一律 ok。
 */

export type BlockCode = "not_present" | "no_item" | "unreachable" | "implausible";

export type NarrativeMode = "first" | "third" | "god";

/**
 * 三档模式对"世界限制"的严格度——这是三档真正的区别，不是人称：
 *   god（上帝）：命令即事实。玩家说成，就是成；连"没这个东西"都可以凭空出现。
 *               → 一律不拦（strictness 0）
 *   third（小说）：镜头跟随，偏剧情。硬事实要拦（没有的东西不能送），
 *               但"人不在"这种可以演成"跑空了"的波折，不必挡在门口。
 *               → 只拦硬事实（strictness 1）
 *   first（沉浸）：默认推荐。要真实感，人不在就是不在一处、路远就是到不了。
 *               → 全拦（strictness 2）
 */
export function modeStrictness(mode?: NarrativeMode): 0 | 1 | 2 {
  if (mode === "god") return 0;
  if (mode === "third") return 1;
  return 2;
}

export interface SceneSnapshot {
  /** 当前在场的人（角色卡名 / 正文刚出现的人名） */
  presentNames?: string[];
  /** 身上现有的物品名 */
  items?: string[];
  /** 当前可去的地方（相邻/可达） */
  reachable?: Array<{ name: string; hours?: number }>;
}

export interface IntentLike {
  actionType: string;
  actionText: string;
  target?: string;
  targetItem?: string;
}

export type Verdict =
  | { ok: true }
  | {
      ok: false;
      code: BlockCode;
      /** 一句话，给界面用，不写进正文 */
      reason: string;
      /** 可点的替代做法（同样来自场景，不凭空造） */
      alternatives: string[];
    };

const GIFT_WORDS = /(送|赠|给|递|塞给|交给|献给|献上)/;
const MOVE_WORDS = /(去|前往|赶往|返回|回到|动身|启程)/;

function has(list: string[] | undefined, name: string): boolean {
  if (!list || list.length === 0 || !name) return false;
  return list.some((x) => x === name || x.includes(name) || name.includes(x));
}

function norm(s: string): string {
  return (s || "").trim();
}

/**
 * 从"去某地"这类文本里抽出目的地名。
 * 只认紧跟在动词后面的 2-8 个字，抽不出就返回空——抽不准就不要拦。
 *
 * 两个必须挡住的情况（否则会误拦）：
 *   · "去去去去"这类重复字：不是地名，是玩家在乱敲；
 *   · 抽出来的词里还含着动词（"到去"）：说明断句不可信。
 */
export function extractDestination(text: string, known: string[]): string {
  const t = norm(text);
  if (!t) return "";
  const hit = known.find((k) => k && t.includes(k));
  if (hit) return hit;
  const m = t.match(/(?:去|前往|赶往|返回|回到|动身去|启程去)([\u4e00-\u9fa5]{2,8})/);
  if (!m) return "";
  const dest = m[1];
  if (/^(.)\1+$/.test(dest)) return ""; // 单字重复
  if (/(去|往|回|到|赶|返|启|身)/.test(dest)) return ""; // 断句不可信
  return dest;
}

/**
 * Verify：这一动作为什么做不成（若能确定的话）。
 * 三件事必查——人、物、路；其余一律放过。
 */
export function verifyIntent(
  intent: IntentLike,
  scene: SceneSnapshot = {},
  opts: { mode?: NarrativeMode } = {}
): Verdict {
  // 上帝模式不设限：玩家写什么就是什么，连"手里没东西"都能凭空发生
  const strict = modeStrictness(opts.mode);
  if (strict === 0) return { ok: true };

  const text = norm(intent.actionText);
  const target = norm(intent.target || "");
  const itemName = norm(intent.targetItem || "");

  // 1) 送礼/递交：没有东西就是没有（最确定的一条）
  const isGift = GIFT_WORDS.test(text) || intent.actionType === "use_item" && GIFT_WORDS.test(text);
  if (isGift) {
    const need = itemName || "";
    if (need) {
      if (!has(scene.items, need)) {
        return {
          ok: false,
          code: "no_item",
          reason: `你身上没有${need}`,
          alternatives: ["去市集看看", "先找件能拿得出手的东西"],
        };
      }
    } else if (!scene.items || scene.items.length === 0) {
      return {
        ok: false,
        code: "no_item",
        reason: "你身上没有能送出手的东西",
        alternatives: ["去市集看看", "先找件能拿得出手的东西"],
      };
    }
  }

  // 2) 对人说话/递东西：人不在场就是不在一处（只查明确点名的人）
  //    小说模式（strict=1）不在这里拦——人不在，写成"扑了个空"比弹提示好看。
  const faceToFace = target || (text.match(/对([\u4e00-\u9fa5]{2,4})(说|道|喊|问)/) || [])[1] || "";
  if (strict >= 2 && faceToFace && (intent.actionType === "dialogue" || isGift)) {
    if (scene.presentNames && scene.presentNames.length > 0 && !has(scene.presentNames, faceToFace)) {
      return {
        ok: false,
        code: "not_present",
        reason: `你与${faceToFace}不在一处`,
        alternatives: [`去找${faceToFace}`, "先打听他在哪"],
      };
    }
  }

  // 3) 去某地：不在可达之列就走不到（可达表为空时不拦——那是"不知道"，不是"不能"）
  //    同上，只有沉浸模式（strict=2）把"路远"当硬限制；小说模式让它变成路上的时间。
  //    例外：目标是"人"（去找某人）时不判距离——我们不知道他在哪，就没资格说远。
  const targetIsPerson =
    !!target &&
    !(scene.reachable || []).some((r) => r.name === target || r.name.includes(target) || target.includes(r.name));
  const dest = extractDestination(text, (scene.reachable || []).map((r) => r.name));
  if (strict >= 2 && !targetIsPerson && dest && scene.reachable && scene.reachable.length > 0) {
    const hit = scene.reachable.find((r) => r.name === dest || r.name.includes(dest) || dest.includes(r.name));
    if (!hit) {
      return {
        ok: false,
        code: "unreachable",
        reason: `从这里一天之内到不了${dest}`,
        alternatives: scene.reachable.slice(0, 2).map((r) => `先去${r.name}`),
      };
    }
  }

  return { ok: true };
}

/**
 * Judge 前的分流：这一轮是"轻回合"还是"正戏"。
 * 轻回合（看一眼、挪一步、拿件东西）只写一两句过场，不展开、不掷骰；
 * 正戏（与人交锋、送礼、许诺、动手）才值得完整生成 + 掷骰。
 */
export function weighIntent(intent: IntentLike): "light" | "scene" {
  const t = norm(intent.actionText);
  if (intent.actionType === "observe") return "light";
  if (intent.actionType === "explore" && t.length <= 24 && !/埋伏|偷袭|动手|追|逃/.test(t)) return "light";
  if (intent.actionType === "rest" && t.length <= 24) return "light";
  if (intent.actionType === "use_item" && t.length <= 20) return "light";
  return "scene";
}

// ─── JEV 契约（本地规则后端）──────────────────────────────────

/** JEV 的 Choice 结果：act（直接做）/ roll（成败未定）/ block（世界不允许） */
export interface ActDecision {
  choice: "act" | "roll" | "block";
  /**
   * 校准置信度（0-1）。规则能确定的给高分；模糊的给低分——
   * 将来接真 JEV / 本地小模型时，低置信度这几条正好是优先送判的样本。
   */
  confidence: number;
  code?: BlockCode;
  reason?: string;
  alternatives?: string[];
  /** 表达成本：light 只写过场，scene 走完整叙事 */
  weight: "light" | "scene";
}

const RISK_WORDS = /(杀|砍|打|抢|偷|闯|威胁|挑战|强行|硬来|动手)/;

/** 赌一把的事：不是不许，是让骰子说话 */
export function decideAct(
  intent: IntentLike,
  scene: SceneSnapshot = {},
  opts: { allowRoll?: boolean; mode?: NarrativeMode } = {}
): ActDecision {
  const weight = weighIntent(intent);
  const v = verifyIntent(intent, scene, { mode: opts.mode });
  if (!v.ok) {
    return { choice: "block", confidence: 0.95, code: v.code, reason: v.reason, alternatives: v.alternatives, weight };
  }
  // 上帝模式不掷骰：编排里的成败由人定，不交给骰子
  const godMode = modeStrictness(opts.mode) === 0;
  if (!godMode && opts.allowRoll !== false && weight === "scene" && RISK_WORDS.test(intent.actionText || "")) {
    return { choice: "roll", confidence: 0.6, weight };
  }
  return { choice: "act", confidence: weight === "light" ? 0.9 : 0.75, weight };
}
