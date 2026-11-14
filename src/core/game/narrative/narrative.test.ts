/**
 * 叙事系统移植 · 契约单测
 * 锁死的是「最容易悄悄坏掉」的几条：零迁移兼容、幂等、不降级、不编造、防抢跑。
 */
import { describe, expect, it } from "vitest";
import {
  emptyLedger,
  envelopeSeeds,
  hasNarrative,
  normalizeLedger,
  readNarrative,
  writeEnvelope,
} from "./ledger";
import {
  commitmentFromSeed,
  computePayoffStats,
  createCommitment,
  detectPayoffs,
  extractPhraseSeeds,
  fulfillBySeeds,
  plantFromSeeds,
  setCommitmentStatus,
} from "./foreshadow";
import { patchCard, registerCard, registerEntities, suggestCategory, approvedCards } from "./worldcard";
import {
  AUTO_MAIN_ID,
  addClue,
  adoptMilestones,
  aggregatedClues,
  completeLine,
  createLine,
  ensureAutoMain,
  switchLineType,
  timelineOf,
} from "./storyline";
import { recordChapter, stageOf, formatChronicle } from "./worldline";
import { buildNarrativeContext, narrativeSummary } from "./context";
import { syncRound, toRoundSignals, type RoundSignals } from "./sync";
import type { CausalitySeed } from "../types";

const seed = (id: string, subject: string, description: string, type: CausalitySeed["type"] = "羁绊"): CausalitySeed => ({
  id, type, subject, description, plantedRound: 1, triggered: false,
});

const emptySig = (over: Partial<RoundSignals> = {}): RoundSignals => ({
  round: 2,
  chapterIndex: 0,
  chapterTitle: "第一章",
  totalChapters: 2,
  narrative: "林舟推开木门，街上空无一人。",
  playerAction: "推门",
  newEntities: [],
  gainedItems: [],
  titles: [],
  plantedSeeds: [],
  triggeredSeeds: [],
  ...over,
});

// ─── 信封：零迁移的地基 ────────────────────────────────────────

describe("信封读写 · 零迁移兼容", () => {
  const oldSeeds = [seed("cs_1", "老陈", "欠他一条命")];
  const ledger = { ...emptyLedger(), updatedRound: 3 };

  it("裸数组（老存档）：读成 seeds、账本为空", () => {
    expect(envelopeSeeds(oldSeeds)).toHaveLength(1);
    expect(readNarrative(oldSeeds).storylines).toEqual([]);
    expect(hasNarrative(oldSeeds)).toBe(false);
  });

  it("三件套对象：读成 seeds、账本为空", () => {
    const three = { causality: oldSeeds, declaredFacts: [], goals: [] };
    expect(envelopeSeeds(three)).toHaveLength(1);
    expect(readNarrative(three).updatedRound).toBe(0);
  });

  it("新信封：seeds 与账本都在，且保留其它键（declaredFacts/goals 不丢）", () => {
    const env = writeEnvelope({ causality: oldSeeds, declaredFacts: [{ id: "df1" }] }, oldSeeds, ledger);
    expect(env.causality).toHaveLength(1);
    expect(env.narrative.updatedRound).toBe(3);
    expect((env as any).declaredFacts).toHaveLength(1);
    expect(readNarrative(env).updatedRound).toBe(3);
    expect(hasNarrative(env)).toBe(true);
  });

  it("JSON 字符串 / null / 坏 JSON / 数组 都不抛错", () => {
    expect(() => readNarrative("not json")).not.toThrow();
    expect(readNarrative("not json").version).toBe(1);
    expect(readNarrative(null).storylines).toEqual([]);
    expect(readNarrative(42).commitments).toEqual([]);
    expect(envelopeSeeds("[]")).toEqual([]);
    expect(envelopeSeeds(undefined)).toEqual([]);
  });

  it("逐条丢弃脏数据，不让一条坏记录毁掉整局", () => {
    const dirty = {
      storylines: [null, { id: "x" }, { id: "ok", title: "正经线", type: "???", events: [null, { id: "e", title: "事" }] }],
      commitments: [{ id: "c", description: "伏笔", status: "乱写" }, null],
      worldCards: [{ id: "w", title: "卡", category: "不存在的类", depth: 99 }],
      chronicle: [{ id: "ch_0", chapterIndex: "abc" }],
    };
    const n = normalizeLedger(dirty);
    expect(n.storylines).toHaveLength(1);
    expect(n.storylines[0].type).toBe("side");
    expect(n.storylines[0].events).toHaveLength(1);
    expect(n.commitments[0].status).toBe("pending");
    expect(n.worldCards[0].category).toBe("custom");
    expect(n.worldCards[0].depth).toBe(4);
    expect(n.chronicle[0].chapterIndex).toBe(0);
  });

  it("stageKey 能跨轮保留（判断是否跨阶段用）", () => {
    const env = writeEnvelope(null, [], { ...ledger, stageKey: "mid" });
    expect(readNarrative(env).stageKey).toBe("mid");
  });
});

// ─── 伏笔机 ────────────────────────────────────────────────────

describe("伏笔五状态机 · 抄小说系统判定规则", () => {
  it("因果种子 → pending 伏笔，带审计链与闭环条件，按 seedId 去重", () => {
    const s = seed("cs_1", "老陈", "当年欠他一条命");
    const c = commitmentFromSeed(s, 3);
    expect(c.status).toBe("pending");
    expect(c.linkedSeedId).toBe("cs_1");
    expect(c.closureConditions).toContain("老陈");
    expect(c.statusHistory[0].trigger).toBe("causality_seed");
    const r1 = plantFromSeeds([], [s], 3);
    const r2 = plantFromSeeds(r1.commitments, [s], 4);
    expect(r1.added).toHaveLength(1);
    expect(r2.added).toHaveLength(0);
  });

  it("闭环条件命中 → fulfilled/1.0；短语命中 1 → partial/0.5", () => {
    const c = { ...commitmentFromSeed(seed("cs_1", "老陈", "当年欠他一条命"), 1), closureConditions: ["还了这条命"] };
    const full = detectPayoffs([c], "他终于还了这条命", 2);
    expect(full.commitments[0].status).toBe("fulfilled");
    expect(full.commitments[0].ratio).toBe(1);
    expect(full.recovered).toHaveLength(1);

    // 短语种子与小说系统同口径：连续中文 ≥3 字。2 字人名走「闭环条件」而非短语。
    const c2 = { ...commitmentFromSeed(seed("cs_2", "老陈", "当年欠他一条命"), 1), closureConditions: [] };
    const partial = detectPayoffs([c2], "席间有人提起当年欠他一条命的旧事", 2);
    expect(partial.commitments[0].status).toBe("partially_fulfilled");
    expect(partial.commitments[0].ratio).toBe(0.5);
  });

  it("2 字人名由闭环条件承接（commitmentFromSeed 默认把 subject 写进闭环条件）", () => {
    const c = commitmentFromSeed(seed("cs_3", "老陈", "当年欠他一条命"), 1);
    expect(c.closureConditions).toContain("老陈");
    const r = detectPayoffs([c], "老陈推门进来", 2);
    expect(r.commitments[0].status).toBe("fulfilled");
  });

  it("绝不降级 fulfilled；埋设轮自身不参与检测（防自埋自收）", () => {
    const done = { ...commitmentFromSeed(seed("cs_1", "老陈", "旧事"), 1), status: "fulfilled" as const, ratio: 1 };
    expect(detectPayoffs([done], "什么都没发生", 5).commitments[0].status).toBe("fulfilled");
    const fresh = commitmentFromSeed(seed("cs_2", "老陈", "旧事"), 3);
    expect(detectPayoffs([fresh], "老陈旧事", 3).commitments[0].status).toBe("pending");
  });

  it("因果种子兑现 → 关联伏笔销账；手动改状态写审计链", () => {
    const c = commitmentFromSeed(seed("cs_1", "老陈", "旧誓"), 1);
    const r = fulfillBySeeds([c], ["cs_1"], 6, "他兑现了");
    expect(r.commitments[0].status).toBe("fulfilled");
    expect(r.commitments[0].fulfilledRound).toBe(6);
    expect(r.commitments[0].statusHistory.at(-1)?.trigger).toBe("causality_done");
    const voided = setCommitmentStatus(r.commitments, c.id, "voided", 7, "作废");
    // 已 fulfilled 仍可被玩家手动作废（这是玩家权，不是自动降级）
    expect(voided[0].status).toBe("voided");
    expect(voided[0].voidReason).toBe("作废");
  });

  it("收束率公式 (fulfilled + 0.5*partial) / active", () => {
    const mk = (id: string, status: any, ratio: number) => ({
      ...commitmentFromSeed(seed(id, "某", "某件事"), 1), id, status, ratio,
    });
    const s = computePayoffStats([
      mk("a", "fulfilled", 1), mk("b", "partially_fulfilled", 0.5),
      mk("c", "pending", 0), mk("d", "voided", 0),
    ]);
    expect(s.active).toBe(3);
    expect(s.payoffRate).toBeCloseTo((1 + 0.5) / 3);
  });

  it("玩家手动埋伏笔：填表入口、同句不重复、闭环条件归一", () => {
    const r1 = createCommitment([], { description: "那把刀究竟是谁留下的", priority: "high", closureConditions: ["刀鞘上有血"], round: 3 });
    expect(r1.added?.source).toBe("player");
    expect(r1.added?.priority).toBe("high");
    expect(r1.added?.closureConditions).toContain("刀鞘上有血");
    const r2 = createCommitment(r1.commitments, { description: "那把刀究竟是谁留下的", round: 4 });
    expect(r2.added).toBeNull();
    expect(createCommitment([], { description: "", round: 1 }).added).toBeNull();
  });

  it("短语种子只取连续中文≥3字、去重（2 字人名交给闭环条件）", () => {
    expect(extractPhraseSeeds("老陈，当年欠他一条命。")).toContain("当年欠他一条命");
    expect(extractPhraseSeeds("老陈，当年欠他一条命。")).not.toContain("老陈");
    expect(extractPhraseSeeds("abc 123")).toEqual([]);
  });
});

// ─── 世界卡 ────────────────────────────────────────────────────

describe("世界卡 15 类 · 归类建议与待审闸门", () => {
  it("实体类型优先，未知交给确定性分类器", () => {
    expect(suggestCategory("青云山门", "location")).toBe("geography");
    expect(suggestCategory("某某宗", "faction")).toBe("faction");
    expect(suggestCategory("屠龙刀", "item")).toBe("item");
    expect(suggestCategory("随便一个名字")).toBeTruthy();
  });

  it("自动登记默认待审、同名幂等；确认后才进提示词", () => {
    const r1 = registerCard([], { title: "屠龙刀", category: "item", source: "entity", round: 2 });
    expect(r1.added?.reviewStatus).toBe("pending");
    expect(approvedCards(r1.cards)).toHaveLength(0);
    const r2 = registerCard(r1.cards, { title: "屠龙刀", category: "item", source: "entity", round: 3 });
    expect(r2.added).toBeNull();
    const approved = patchCard(r1.cards, r1.added!.id, { reviewStatus: "approved" });
    expect(approvedCards(approved)).toHaveLength(1);
  });

  it("停用词/太短的名字不登记（不把「主角」当世界设定）", () => {
    expect(registerCard([], { title: "主角", source: "entity", round: 1 }).added).toBeNull();
    expect(registerCard([], { title: "", source: "entity", round: 1 }).added).toBeNull();
  });

  it("一批实体去重登记", () => {
    const r = registerEntities([], [
      { name: "青云宗", type: "faction", description: "山门大派" },
      { name: "青云宗", type: "faction", description: "重复" },
      { name: "落霞山", type: "location", description: "秘境" },
    ], 2);
    expect(r.added).toHaveLength(2);
    expect(r.cards.map((c) => c.category).sort()).toEqual(["faction", "geography"]);
  });
});

// ─── 故事线：复用小说系统纯函数 ────────────────────────────────

describe("故事线 · 自动长出来，不派任务", () => {
  it("空账本第一次发生事才建自动主线，且不预填结局", () => {
    const r = ensureAutoMain([], 1);
    expect(r.created).toBe(true);
    expect(r.storylines[0].id).toBe(AUTO_MAIN_ID);
    expect(r.storylines[0].sevenElements).not.toHaveProperty("ending");
    expect(ensureAutoMain(r.storylines, 2).created).toBe(false);
  });

  it("里程碑采纳去重：同轮同标题不重复、位置递增", () => {
    const t = targetForTest();
    const r1 = adoptMilestones(t, 2, [{ title: "种下羁绊·老陈" }, { title: "得号·刀客" }]);
    expect(r1.added).toHaveLength(2);
    expect(r1.added[1].position).toBeGreaterThan(r1.added[0].position);
    const r2 = adoptMilestones(r1.storylines, 2, [{ title: "种下羁绊·老陈" }]);
    expect(r2.added).toHaveLength(0);
  });

  it("CLUE 不进时间轴（因果链口径），主线汇聚子支线线索", () => {
    const t = targetForTest();
    const side = createLine(t, { title: "找刀", type: "side" }, 2);
    const withClue = addClue(side.storylines, side.line!.id, 3, { tag: "物证", content: "刀鞘上有血" });
    const mainId = AUTO_MAIN_ID;
    const all = aggregatedClues(withClue.storylines, mainId);
    expect(all).toHaveLength(1);
    expect(all[0].from).toBe("找刀");
    expect(timelineOf(withClue.storylines.find((s) => s.id === side.line!.id)!)).toEqual([]);
  });

  it("完结回填要素：主线三要素、支线七要素，结局不预填、已填不覆盖", () => {
    const t = targetForTest();
    const withEv = adoptMilestones(t, 2, [{ title: "起因事件", content: "门开了" }, { title: "结果事件", content: "人走了" }]);
    const done = completeLine(withEv.storylines, AUTO_MAIN_ID, 5);
    const main = done.find((s) => s.id === AUTO_MAIN_ID)!;
    expect(main.status).toBe("completed");
    expect(Object.keys(main.sevenElements).sort()).toEqual(["origin", "process", "result"]);
    expect(main.sevenElements.ending).toBeUndefined();
  });

  it("切换主线/支线清理另一套要素（防串味）", () => {
    const t = switchLineType(targetForTest(), AUTO_MAIN_ID, "side");
    const line = t.find((s) => s.id === AUTO_MAIN_ID)!;
    expect(line.type).toBe("side");
    expect(line.sevenElements.origin).toBeUndefined();
    expect(line.sevenElements).toHaveProperty("ending");
  });
});

function targetForTest() {
  return ensureAutoMain([], 1).storylines;
}

// ─── 世界线 / 6 阶段 ───────────────────────────────────────────

describe("世界线编年 + 6 阶段防抢跑", () => {
  it("同章幂等：不堆重复条目，代表句取最新、大事去重合并", () => {
    const r1 = recordChapter([], { chapterIndex: 0, chapterTitle: "第一章", narrative: "他推开门。街上空无一人，风很冷。", keyEvents: ["推门"], round: 1 });
    expect(r1.added).toBe(true);
    const r2 = recordChapter(r1.chronicle, { chapterIndex: 0, chapterTitle: "第一章", narrative: "后来他遇见了老陈，两人对视良久。", keyEvents: ["推门", "遇老陈"], round: 4 });
    expect(r2.added).toBe(false);
    expect(r2.chronicle).toHaveLength(1);
    expect(r2.chronicle[0].keyEvents).toEqual(["推门", "遇老陈"]);
    expect(formatChronicle(r2.chronicle)).toContain("第1章《第一章》");
  });

  it("游戏本不预设目标章数 → 永远不自动进高潮/收尾", () => {
    expect(stageOf(0, 1).key).toBe("opening");
    expect(stageOf(99, 100).key).not.toBe("ending");
    expect(stageOf(99, 100).percent).toBeLessThanOrEqual(78);
  });

  it("主线收尾时才进 ending（玩家/系统显式标记，不靠章数猜）", () => {
    expect(stageOf(2, 100, true).key).toBe("ending");
  });
});

// ─── 协同层（本次核心）────────────────────────────────────────

describe("syncRound · 五套系统一次演算", () => {
  it("种下因果 → 伏笔登记 + 里程碑 + 世界卡 + 编年，浮体分类正确", () => {
    const s = seed("cs_1", "老陈", "当年欠他一条命");
    const r = syncRound(null, emptySig({
      plantedSeeds: [s],
      newEntities: [{ name: "青云宗", type: "faction", description: "山门大派" }],
      gainedItems: ["屠龙刀"],
      titles: ["刀客"],
    }));
    expect(r.ledger.commitments).toHaveLength(1);
    expect(r.ledger.storylines[0].events.length).toBeGreaterThanOrEqual(2);
    expect(r.ledger.worldCards.map((c) => c.title)).toEqual(expect.arrayContaining(["青云宗", "屠龙刀"]));
    expect(r.ledger.chronicle).toHaveLength(1);
    expect(r.ledger.stageKey).toBe("opening");
    expect(r.discoveries.some((d) => d.kind === "world")).toBe(true);
    expect(r.discoveries.some((d) => d.kind === "clue")).toBe(true);
    expect(r.changed).toBe(true);
  });

  it("幂等：同一轮信号重放不产生重复伏笔/世界卡/里程碑", () => {
    const sig = emptySig({ plantedSeeds: [seed("cs_1", "老陈", "旧誓")], gainedItems: ["屠龙刀"] });
    const r1 = syncRound(null, sig);
    const r2 = syncRound(r1.ledger, sig);
    expect(r2.ledger.commitments).toHaveLength(1);
    expect(r2.ledger.worldCards.filter((c) => c.title === "屠龙刀")).toHaveLength(1);
    expect(r2.ledger.storylines[0].events.length).toBe(r1.ledger.storylines[0].events.length);
  });

  it("正文命中闭环条件 → 伏笔回收浮体 + 里程碑", () => {
    const s = seed("cs_1", "老陈", "当年欠他一条命");
    const r1 = syncRound(null, emptySig({ round: 1, plantedSeeds: [s] }));
    const c = { ...r1.ledger.commitments[0], closureConditions: ["还了这条命"] };
    const r2 = syncRound(
      { ...r1.ledger, commitments: [c] },
      emptySig({ round: 2, narrative: "他终于还了这条命，转身离开。" }),
    );
    expect(r2.ledger.commitments[0].status).toBe("fulfilled");
    expect(r2.discoveries.some((d) => d.text.includes("伏笔回收"))).toBe(true);
  });

  it("跨阶段才弹时辰浮体（不每轮刷屏）", () => {
    const r = syncRound(
      { ...emptyLedger(), stageKey: "opening" },
      emptySig({ chapterIndex: 3, totalChapters: 2 }), // 4/13≈31% → early
    );
    expect(r.discoveries.some((d) => d.kind === "time")).toBe(true);
    const r2 = syncRound(
      { ...emptyLedger(), stageKey: r.ledger.stageKey },
      emptySig({ chapterIndex: 3, totalChapters: 2 }),
    );
    expect(r2.discoveries.some((d) => d.kind === "time")).toBe(false);
  });

  it("空信号也返回合法账本，不抛错、不编造", () => {
    const r = syncRound(null, emptySig({ narrative: "", chapterIndex: 0 }));
    expect(r.ledger.storylines).toHaveLength(0);
    expect(r.ledger.commitments).toHaveLength(0);
    expect(r.ledger.version).toBe(1);
  });

  it("引擎胶水 toRoundSignals：只把「本轮」兑现的种子算进来，历史已兑现的不重复", () => {
    const old = { ...seed("cs_old", "旧人", "旧事"), triggered: true, triggeredRound: 2 };
    const now = { ...seed("cs_now", "老陈", "旧誓"), triggered: true, triggeredRound: 7 };
    const pending = seed("cs_p", "某人", "未了之事");
    const sig = toRoundSignals({
      round: 7,
      narrative: "老陈终于兑现了旧誓。",
      playerAction: "问旧誓",
      newEntities: [{ name: "青云宗", type: "faction", description: "山门" }],
      gainedItemNames: ["屠龙刀"],
      titleNames: ["刀客"],
      plantedSeeds: [pending],
      settledSeeds: [old, now, pending],
      meta: { chapterIndex: 2, chapterTitle: "第三章", totalChapters: 3 },
    });
    expect(sig.triggeredSeeds.map((s) => s.id)).toEqual(["cs_now"]);
    expect(sig.chapterIndex).toBe(2);
    expect(sig.chapterTitle).toBe("第三章");
    expect(sig.gainedItems).toEqual(["屠龙刀"]);
    // 整条链路能直接跑通，不依赖 LLM
    const r = syncRound(null, sig);
    expect(r.ledger.worldCards.map((c) => c.title)).toContain("青云宗");
    expect(r.discoveries.some((d) => d.text.includes("了却"))).toBe(true);
  });

  it("引擎胶水缺省 meta 也不崩（小说项目内开游戏的老路径）", () => {
    const sig = toRoundSignals({
      round: 1, narrative: "", playerAction: "", newEntities: [],
      gainedItemNames: [], titleNames: [], plantedSeeds: [], settledSeeds: [],
    });
    expect(sig.chapterIndex).toBe(0);
    expect(sig.totalChapters).toBe(1);
    expect(() => syncRound(null, sig)).not.toThrow();
  });
});

// ─── 提示词注入 ────────────────────────────────────────────────

describe("提示词上下文 · 让 AI 也看得见这套系统", () => {
  it("空账本返回空串（不污染 prompt）", () => {
    expect(buildNarrativeContext(null)).toBe("");
    expect(buildNarrativeContext(emptyLedger())).not.toContain("## 故事线");
  });

  it("待收伏笔 / 已确认世界卡 / 故事线时间轴都进上下文；未确认卡不进", () => {
    const s = seed("cs_1", "老陈", "当年欠他一条命");
    const r = syncRound(null, emptySig({
      plantedSeeds: [s],
      newEntities: [{ name: "青云宗", type: "faction", description: "山门大派" }],
    }));
    const pendingCtx = buildNarrativeContext(r.ledger);
    expect(pendingCtx).toContain("## 待收伏笔");
    expect(pendingCtx).toContain("老陈");
    expect(pendingCtx).toContain("## 故事线");
    expect(pendingCtx).not.toContain("青云宗"); // 待审卡不注入

    const approved = patchCard(r.ledger.worldCards, r.ledger.worldCards[0].id, { reviewStatus: "approved" });
    expect(buildNarrativeContext({ ...r.ledger, worldCards: approved })).toContain("青云宗");
    expect(narrativeSummary(r.ledger)).toContain("1 条故事线");
  });
});
