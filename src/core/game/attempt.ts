/**
 * 尝试 · 结果契约 —— 「选了」不等于「成了」
 *
 * 用户终审（2026-11-15）：
 *   "选择的指令只是我的一个尝试，而不是一个既定的结果。"
 *   "不能是我选择了'偷他一样东西'，就默认我已经偷到了，并且这个过程也不给我看。"
 *   "不能是黑箱操作……无论什么动作都要在正文中去体现。"
 *
 * 判据（本轮定调，跨会话有效）：
 *   ① 结算只认**正文里的证据**，不认玩家输入的动作文本。玩家点了「偷」不构成得手，
 *      模型在正文里落笔「得手」才构成得手。此前 inferVerb(输入文本) + outcomeFromTurn
 *      无骰恒 success，是「输入即结果」的总根因。
 *   ② **默认未定**：模型没写 RESULT| 就是「事情还没落定」——好感 / 物品 / 生死一律不结算，
 *      下一轮还能继续、还能挽回、还能反转。未定是常态，不是异常。
 *   ③ 失败不是终局：blocked 档不夺物、不杀人、不锁死，正文里留得住下一步。
 *   ④ **死必须明写**：只有 RESULT|丧命 才允许 markDead。绝不从「杀」这个字、
 *      也绝不从骰子档位推导死亡——「判定完我就已经死了」是明确禁止项。
 *   ⑤ 骰子只管「这一步顺不顺」，正文才管「整件事成没成」。两者不再互相冒充。
 *
 * 防静默失效（本项目反复踩的坑）：结构行可能被模型整块忽略。所以 resolveAttempt 有
 * 两条不依赖 RESULT| 的兜底：上帝档（作者权）与 AI 自己写下的 CI|获得/转移（到手是他记的账）。
 * 除此之外一律未定，且**界面必须显示「本轮未落定」**，让玩家看得见没结算，而不是悄悄吞掉。
 */

/** 本轮结果档位。undecided 是默认值，也是大多数尝试该停的地方。 */
export type AttemptOutcome = "undecided" | "gained" | "costly" | "blocked" | "fatal";

export interface AttemptResult {
  outcome: AttemptOutcome;
  /** 给玩家看的一句话：这一轮走到哪儿了（不是「你成功了/你失败了」这种宣判） */
  note: string;
  /** 结果是从哪儿读出来的——回执透明，方便排查「模型又没写结构行」 */
  source: "result_line" | "god_mode" | "item_evidence" | "default";
}

const OUTCOME_WORDS: Array<[RegExp, AttemptOutcome]> = [
  [/丧命|身死|毙命|断气|死了|已死/, "fatal"],
  [/得手|成功|达成|到手|拿到了|得逞/, "gained"],
  [/有代价|代价|勉强|惊险|带伤|折了/, "costly"],
  [/受阻|失败|被识破|被抓|扑空|没成|落空|反被|挡了回来/, "blocked"],
  [/未定|进行中|待续|悬着|还没|尚且不知/, "undecided"],
];

/** 从一段原始输出里找 RESULT| 行（取最后一条，容忍模型写多次） */
export function parseAttemptLine(raw: string): AttemptResult | null {
  const lines = (raw || "").split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!/^RESULT\s*\|/.test(line)) continue;
    const parts = line.replace(/^RESULT\s*\|/, "").split("|").map((s) => s.trim());
    const word = parts[0] || "";
    let outcome: AttemptOutcome = "undecided";
    for (const [re, o] of OUTCOME_WORDS) {
      if (re.test(word)) { outcome = o; break; }
    }
    // 认不出的词一律按未定处理——宁可不结算，不可替模型宣布结果
    return { outcome, note: (parts[1] || "").slice(0, 80), source: "result_line" };
  }
  return null;
}

export interface ItemEvidence {
  operation: string;
  name?: string;
}

/**
 * 定本轮结果。调用方传入解析后的物品变动与叙事档位。
 *
 * @param raw        LLM 原始输出（含结构行）
 * @param itemChanges 已解析的 CI| 变动（AI 自己记的账，可作为到手的证据）
 * @param godMode    上帝档：玩家输入是导演编排，仍按既成事实处理（作者权例外）
 */
export function resolveAttempt(
  raw: string,
  itemChanges: ItemEvidence[] = [],
  godMode = false
): AttemptResult {
  const explicit = parseAttemptLine(raw);
  if (explicit) return explicit;

  if (godMode) {
    return { outcome: "gained", note: "上帝视角：编排即成事实。", source: "god_mode" };
  }

  // AI 在正文里自己打了「获得/转移」的账——到手是他写下来的，不是玩家点出来的。
  // 注意：只认获取类；消耗/丢弃/损坏不构成「本轮动作得手」。
  const gainedSomething = itemChanges.some(
    (c) => c.operation === "gain" || c.operation === "transfer"
  );
  if (gainedSomething) {
    return { outcome: "gained", note: "正文记下了到手的东西。", source: "item_evidence" };
  }

  return {
    outcome: "undecided",
    note: "这一步还没落定——过程写在这儿，结果留到后面。",
    source: "default",
  };
}

/** 未定 / 受阻：不许好感入账，也不许夺物。失败只是「这一步没顺」，不是结案。 */
export function toRelationOutcome(a: AttemptOutcome): "success" | "cost" | "fail" | null {
  if (a === "gained" || a === "fatal") return "success";
  if (a === "costly") return "cost";
  if (a === "blocked") return "fail";
  return null;
}

/** 物品是否允许入账：只有真的到手（含带代价的到手）才记。 */
export function itemSettlementAllowed(a: AttemptOutcome): boolean {
  return a === "gained" || a === "costly" || a === "fatal";
}

/** 只有明写了丧命才可以标死；且调用方还须确认动词是 kill。 */
export function deathSettlementAllowed(a: AttemptOutcome): boolean {
  return a === "fatal";
}

/** 回执上的人话：不许出现「你失败了」这种终局宣判 */
export function attemptLabel(a: AttemptOutcome): string {
  return a === "gained" ? "这一步得手了"
    : a === "costly" ? "到手了，但有代价"
    : a === "blocked" ? "这一步没顺，还有下文"
    : a === "fatal" ? "有人没能站起来"
    : "本轮未落定 · 还能继续";
}

export function attemptHint(a: AttemptOutcome): string {
  return a === "undecided"
    ? "没结算好感 / 物品 / 生死——事情还在走，下一轮接着来。"
    : a === "blocked"
      ? "没夺物、没定生死；被拦下不等于结案，还能换个法子。"
      : "";
}
