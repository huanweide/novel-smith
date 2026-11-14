/**
 * R9 自由度扩展 —— 纯函数单测
 *
 * 三个模块（因果链 / 声明事实 / 玩家目标）+ 扩展态容错层。
 * 引擎侧的 LLM 调用不在此测（mock 收益低），这里只锁「决策规则」：
 * 什么该入库、什么该丢、兑现怎么匹配、提示词怎么渲染。
 */
import { describe, it, expect } from "vitest";
import {
  extractCausalitySeeds,
  markSeedTriggered,
  mergeSeeds,
  buildCausalityContext,
  CAUSALITY_TYPES,
} from "./causality-ledger";
import {
  validateDeclaredFact,
  addDeclaredFact,
  removeDeclaredFact,
  buildDeclaredFactsContext,
  DECLARE_MAX_LEN,
} from "./declare-fact";
import { addGoal, removeGoal, toggleGoalDone, buildGoalsContext, GOAL_MAX_LEN } from "./goals";
import {
  parseExtensions,
  serializeExtensions,
  causalityOnly,
  emptyExtensions,
  normalizeSeed,
  EXT_CAPS,
} from "./session-extensions";
import type { CausalitySeed } from "./types";
import { buildGameSystemPrompt, parseGameOutput } from "./game-prompts";

// ─── 因果链 ───────────────────────────────────────────────────

describe("causality-ledger —— 种子入库", () => {
  it("合法行生成带 id/轮次/未触发态的种子", () => {
    const seeds = extractCausalitySeeds(
      [
        { type: "仇怨", subject: "血刀门", description: "你杀了他们少主" },
        { type: "善缘", subject: "船老大", description: "你替他挡了一刀" },
      ],
      3
    );
    expect(seeds).toHaveLength(2);
    expect(seeds[0].type).toBe("仇怨");
    expect(seeds[0].plantedRound).toBe(3);
    expect(seeds[0].triggered).toBe(false);
    expect(seeds[0].id).toContain("cs_3_0");
  });

  it("非法类型回落「因果」，不丢这条种子", () => {
    const [s] = extractCausalitySeeds([{ type: "天谴", subject: "老天", description: "雷劈" }], 1);
    expect(s.type).toBe("因果");
    expect(CAUSALITY_TYPES).toContain(s.type);
  });

  it("缺 subject 或 description 的行直接丢弃（脏数据不入库）", () => {
    const seeds = extractCausalitySeeds(
      [{ subject: "", description: "无主" }, { subject: "某人", description: "" }, null as any],
      1
    );
    expect(seeds).toHaveLength(0);
  });

  it("超长字段截断（subject 120 / description 300）", () => {
    const [s] = extractCausalitySeeds(
      [{ type: "因果", subject: "人".repeat(300), description: "事".repeat(900) }],
      1
    );
    expect(s.subject.length).toBe(120);
    expect(s.description.length).toBe(300);
  });
});

describe("causality-ledger —— 兑现匹配", () => {
  const base: CausalitySeed[] = [
    { id: "a", type: "仇怨", subject: "血刀门", description: "结仇", plantedRound: 1, triggered: false },
    { id: "b", type: "善缘", subject: "船老大", description: "报恩", plantedRound: 2, triggered: false },
  ];

  it("subject+type 精确命中", () => {
    const next = markSeedTriggered(base, [{ subject: "血刀门", type: "仇怨" }], 5);
    expect(next[0].triggered).toBe(true);
    expect(next[0].triggeredRound).toBe(5);
    expect(next[1].triggered).toBe(false);
  });

  it("type 不一致时按 subject 兜底（宁可兑现，不留死种）", () => {
    const next = markSeedTriggered(base, [{ subject: "血刀门", type: "善缘" }], 6);
    expect(next[0].triggered).toBe(true);
  });

  it("已兑现的不会被二次改写轮次", () => {
    const once = markSeedTriggered(base, [{ subject: "船老大" }], 3);
    const twice = markSeedTriggered(once, [{ subject: "船老大" }], 9);
    expect(twice[1].triggeredRound).toBe(3);
  });

  it("纯函数：不改入参", () => {
    markSeedTriggered(base, [{ subject: "血刀门" }], 5);
    expect(base[0].triggered).toBe(false);
  });

  it("空/非法兑现列表原样返回", () => {
    expect(markSeedTriggered(base, [], 5)).toEqual(base);
    expect(markSeedTriggered(base, [null, { subject: "  " }] as any, 5)).toEqual(base);
  });
});

describe("causality-ledger —— 合并与渲染", () => {
  it("按 id 去重，同 id 合并且保留已触发态", () => {
    const existing: CausalitySeed[] = [
      { id: "x", type: "因果", subject: "甲", description: "旧", plantedRound: 1, triggered: true, triggeredRound: 2 },
    ];
    const merged = mergeSeeds(existing, [
      { id: "x", type: "因果", subject: "甲", description: "新", plantedRound: 1, triggered: false },
      { id: "y", type: "誓言", subject: "乙", description: "发誓", plantedRound: 4, triggered: false },
    ]);
    expect(merged).toHaveLength(2);
    expect(merged.find((s) => s.id === "x")!.triggered).toBe(true);
  });

  it("空上下文返回空串（不往提示词里塞空标题）", () => {
    expect(buildCausalityContext([])).toBe("");
  });

  it("未兑现与已兑现分栏渲染，已兑现带 ✓", () => {
    const txt = buildCausalityContext([
      { id: "a", type: "仇怨", subject: "血刀门", description: "结仇", plantedRound: 1, triggered: false },
      { id: "b", type: "善缘", subject: "船老大", description: "报恩", plantedRound: 2, triggered: true, triggeredRound: 4 },
    ]);
    expect(txt).toContain("尚未兑现");
    expect(txt).toContain("【仇怨】关于「血刀门」");
    expect(txt).toContain("【善缘✓】");
  });
});

// ─── 声明事实 ─────────────────────────────────────────────────

describe("declare-fact —— 校验与增删", () => {
  it("空 / 过短 / 过长 一律拒绝", () => {
    expect(validateDeclaredFact("").ok).toBe(false);
    expect(validateDeclaredFact("呀").ok).toBe(false);
    expect(validateDeclaredFact("字".repeat(DECLARE_MAX_LEN + 1)).ok).toBe(false);
  });

  it("夹带输出标记的声明被挡下（防污染解析流程）", () => {
    expect(validateDeclaredFact("城里有===选项===").ok).toBe(false);
    expect(validateDeclaredFact("NE|某人|秘密").ok).toBe(false);
  });

  it("正常声明去首尾空白后通过", () => {
    const v = validateDeclaredFact("  城门口的老兵是我父亲  ");
    expect(v.ok).toBe(true);
    expect(v.clean).toBe("城门口的老兵是我父亲");
  });

  it("新增返回新数组并带轮次，不改入参", () => {
    const before: any[] = [];
    const { facts, error } = addDeclaredFact(before, "北境冬天来得早", 7);
    expect(error).toBeUndefined();
    expect(facts).toHaveLength(1);
    expect(facts[0].declaredRound).toBe(7);
    expect(before).toHaveLength(0);
  });

  it("非法声明不写入，原数组原样返回并带原因", () => {
    const facts = [{ id: "f1", text: "已有事实", declaredRound: 1 }];
    const res = addDeclaredFact(facts, "", 2);
    expect(res.error).toBeTruthy();
    expect(res.facts).toHaveLength(1);
  });

  it("按 id 删除", () => {
    const facts = [
      { id: "f1", text: "甲", declaredRound: 1 },
      { id: "f2", text: "乙", declaredRound: 2 },
    ];
    expect(removeDeclaredFact(facts, "f1").map((f) => f.id)).toEqual(["f2"]);
  });

  it("提示词强调「既定真相、不可违背」（这是玩家作者权的根据）", () => {
    const txt = buildDeclaredFactsContext([{ id: "f1", text: "北境冬天来得早", declaredRound: 1 }]);
    expect(txt).toContain("既定真相");
    expect(txt).toContain("不可违背");
    expect(buildDeclaredFactsContext([])).toBe("");
  });
});

// ─── 玩家目标 ─────────────────────────────────────────────────

describe("goals —— 无强制主线", () => {
  it("新增带轮次，重复文本拒绝", () => {
    const { goals } = addGoal([], "成为剑圣", 1);
    expect(goals).toHaveLength(1);
    const dup = addGoal(goals, "成为剑圣", 2);
    expect(dup.error).toBeTruthy();
    expect(dup.goals).toHaveLength(1);
  });

  it("空目标与超长目标拒绝", () => {
    expect(addGoal([], "   ", 1).error).toBeTruthy();
    expect(addGoal([], "长".repeat(GOAL_MAX_LEN + 1), 1).error).toBeTruthy();
  });

  it("完成状态可切换也可显式设定", () => {
    const { goals } = addGoal([], "找到妹妹", 1);
    const t1 = toggleGoalDone(goals, goals[0].id);
    expect(t1[0].done).toBe(true);
    const t2 = toggleGoalDone(t1, goals[0].id, false);
    expect(t2[0].done).toBe(false);
  });

  it("按 id 删除；空数组安全", () => {
    const { goals } = addGoal([], "查清身世", 1);
    expect(removeGoal(goals, goals[0].id)).toHaveLength(0);
    expect(removeGoal([], "nope")).toEqual([]);
  });

  it("提示词标明非强制，完成态用 [x]", () => {
    const { goals } = addGoal([], "成为剑圣", 1);
    const done = toggleGoalDone(goals, goals[0].id, true);
    const txt = buildGoalsContext(done);
    expect(txt).toContain("非强制主线");
    expect(txt).toContain("[x] 成为剑圣");
    expect(buildGoalsContext([])).toBe("");
  });
});

// ─── 扩展态容错（存档能不能打开）────────────────────────────

describe("session-extensions —— 脏存档不炸", () => {
  it("null / 坏 JSON / 数组 / 字符串，全都安全返回空态", () => {
    expect(parseExtensions(null)).toEqual(emptyExtensions());
    expect(parseExtensions("{坏掉的 json")).toEqual(emptyExtensions());
    expect(parseExtensions([1, 2, 3])).toEqual(emptyExtensions());
    expect(parseExtensions("null")).toEqual(emptyExtensions());
  });

  it("单条脏数据被丢弃，合法条目保留", () => {
    const ext = parseExtensions({
      causality: [
        { subject: "血刀门", description: "结仇", type: "仇怨", plantedRound: 2, triggered: false },
        { subject: "", description: "无主" },
        { subject: "某人" },
      ],
      declaredFacts: [{ text: "北境冬天来得早", declaredRound: 1 }, { text: "短" }],
      goals: [{ text: "成为剑圣", createdRound: 1 }, { text: "" }],
    });
    expect(ext.causality).toHaveLength(1);
    expect(ext.declaredFacts).toHaveLength(1);
    expect(ext.goals).toHaveLength(1);
  });

  it("因果超上限时优先保留未兑现的（还要兑现的不能被裁掉）", () => {
    const many = Array.from({ length: EXT_CAPS.causality + 10 }, (_, i) => ({
      id: `s${i}`,
      subject: `人${i}`,
      description: `事${i}`,
      type: "因果",
      plantedRound: i,
      triggered: i < 5, // 前 5 条已兑现
    }));
    const ext = parseExtensions({ causality: many });
    expect(ext.causality).toHaveLength(EXT_CAPS.causality);
    expect(ext.causality.every((s) => !s.triggered)).toBe(true);
  });

  it("种下轮次升序落库（读起来像时间线）", () => {
    const ext = parseExtensions({
      causality: [
        { id: "b", subject: "乙", description: "后", plantedRound: 9, triggered: false },
        { id: "a", subject: "甲", description: "前", plantedRound: 2, triggered: false },
      ],
    });
    expect(ext.causality.map((s) => s.id)).toEqual(["a", "b"]);
  });

  it("causalityOnly 同时认「裸数组」（saga.causality）与「三件套对象」", () => {
    const bare = [{ subject: "血刀门", description: "结仇", plantedRound: 1, triggered: false }];
    expect(causalityOnly(bare)).toHaveLength(1);
    expect(causalityOnly({ causality: bare })).toHaveLength(1);
    expect(causalityOnly("[]")).toEqual([]);
  });

  it("序列化只保留三件套，不夹带其它键", () => {
    const out = serializeExtensions({
      causality: [],
      declaredFacts: [],
      goals: [],
      // @ts-expect-error 故意夹带
      sneaky: 1,
    });
    expect(Object.keys(out).sort()).toEqual(["causality", "declaredFacts", "goals"]);
  });

  it("normalizeSeed 对非对象输入返回 null（不抛错）", () => {
    expect(normalizeSeed(null)).toBeNull();
    expect(normalizeSeed("x")).toBeNull();
    expect(normalizeSeed({ subject: "甲", description: "乙" })).not.toBeNull();
  });
});

// ─── 生产者必须存在（这轮真踩过的坑）─────────────────────────
// 解析器认 CAUSE|，但只要提示词里没让模型输出它，因果库永远是空的；
// 单测全绿、界面正常、功能却是"死"的。这条测试就是钉住这个断层。

describe("提示词必须要求模型输出因果标记", () => {
  const prompt = buildGameSystemPrompt({
    bookName: "测试书",
    chapterTitle: "第一章",
    outline: null,
    existingContent: null,
    characters: [],
    worldLore: [],
    previousTurns: [],
    entities: [],
    items: [],
    currentRound: 1,
    totalWords: 0,
    maxWords: 3000,
    plotProgress: 0,
  } as any);

  it("含 CAUSE| 指令（否则解析器收不到任何东西）", () => {
    expect(prompt).toContain("CAUSE|");
    expect(prompt).toContain("CAUSE_DONE|");
    // 实测模型会忽略尾随段头，所以要求它内联写、不要标题
    expect(prompt).toContain("【情节进度");
  });

  it("三个 R9 注入位都在（因果/声明事实/目标），且空态不产生空标题", () => {
    expect(prompt).not.toContain("{causalitySection}");
    expect(prompt).not.toContain("{declaredFactsSection}");
    expect(prompt).not.toContain("{goalsSection}");
    expect(prompt).not.toContain("## 因果脉络");
    expect(prompt).not.toContain("## 玩家确立的世界事实");
  });

  it("非空扩展态会被注入到系统提示词", () => {
    const withExt = buildGameSystemPrompt({
      bookName: "测试书", chapterTitle: "第一章", outline: null, existingContent: null,
      characters: [], worldLore: [], previousTurns: [], entities: [], items: [],
      currentRound: 2, totalWords: 0, maxWords: 3000, plotProgress: 0,
      causalitySeeds: [{ id: "a", type: "仇怨", subject: "血刀门", description: "结仇", plantedRound: 1, triggered: false }],
      declaredFacts: [{ id: "f", text: "北境冬天来得早", declaredRound: 1 }],
      goals: [{ id: "g", text: "成为剑圣", createdRound: 1 }],
    } as any);
    expect(withExt).toContain("## 因果脉络");
    expect(withExt).toContain("血刀门");
    expect(withExt).toContain("## 玩家确立的世界事实");
    expect(withExt).toContain("北境冬天来得早");
    expect(withExt).toContain("## 玩家的自由目标");
    expect(withExt).toContain("成为剑圣");
  });
});

// ─── 解析器必须认内联结构行（模型不肯写段头的现实）────────────
describe("parseGameOutput —— 因果行内联也能收", () => {
  it("无段头、只有 CAUSE| 行，也能解析并把它从正文里剔除", () => {
    const raw = [
      "他记下了你的脸。",
      "",
      "【情节进度：23%】",
      "CAUSE|仇怨|赌坊打手|当众打翻了他，这笔账他记下了",
      "",
      "1. 走",
      "2. 留",
      "3. 追",
    ].join("\n");
    const out = parseGameOutput(raw);
    expect(out.causality).toHaveLength(1);
    expect(out.causality[0]).toMatchObject({ type: "仇怨", subject: "赌坊打手" });
    expect(out.narrative).not.toContain("CAUSE|");
    expect(out.plotProgress).toBe(23);
  });

  it("CAUSE_DONE| 内联同样能收", () => {
    const raw = ["正文", "【情节进度：30%】", "CAUSE_DONE|赌坊打手|仇怨", "", "1. 甲", "2. 乙"].join("\n");
    const out = parseGameOutput(raw);
    expect(out.causalityDone).toEqual([{ subject: "赌坊打手", type: "仇怨" }]);
    expect(out.narrative).not.toContain("CAUSE_DONE|");
  });

  it("字段不足的 CAUSE| 行丢弃（不让半截数据进账）", () => {
    const out = parseGameOutput(["正文", "CAUSE|仇怨|只有实体", "", "1. 甲", "2. 乙"].join("\n"));
    expect(out.causality).toHaveLength(0);
  });
});

// ─── 三模式：真正要不同的是规则，不是人称 ─────────────────────
describe("三档模式提示词 —— 各有专属规则块，互不串味", () => {
  const base = {
    bookName: "测试书", chapterTitle: "第一章", outline: null, existingContent: null,
    characters: [], worldLore: [], previousTurns: [], entities: [], items: [],
    currentRound: 1, totalWords: 0, maxWords: 3000, plotProgress: 0,
  };

  const god = buildGameSystemPrompt({ ...base, narrativeMode: "god" } as any);
  const third = buildGameSystemPrompt({ ...base, narrativeMode: "third" } as any);
  const first = buildGameSystemPrompt({ ...base, narrativeMode: "first" } as any);

  it("上帝：命令即事实、荒诞无上限、不掷骰", () => {
    expect(god).toContain("【本档规则 · 上帝】");
    expect(god).toContain("命令，不是请求");
    expect(god).toContain("不掷骰");
    expect(god).not.toContain("【本档规则 · 沉浸】");
  });

  it("小说：不合剧情转波折，人不在写扑空", () => {
    expect(third).toContain("【本档规则 · 小说】");
    expect(third).toContain("扑了个空");
    expect(third).not.toContain("【本档规则 · 上帝】");
  });

  it("沉浸：受距离与条件约束，失败要留后果，正文不写系统腔", () => {
    expect(first).toContain("【本档规则 · 沉浸】");
    expect(first).toContain("系统不允许");
    expect(first).toContain("转场要花时间");
    expect(first).not.toContain("【本档规则 · 小说】");
  });

  it("默认档是沉浸（不传 mode 时）", () => {
    const dflt = buildGameSystemPrompt({ ...base } as any);
    expect(dflt).toContain("【本档规则 · 沉浸】");
  });
});
