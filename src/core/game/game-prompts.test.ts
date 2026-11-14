import { describe, it, expect } from "vitest";
import {
  parseGameOutput,
  buildMemorySummary,
  buildActionPrompt,
  buildGameSystemPrompt,
  buildPersonaContract,
  buildPersonaRoundAnchor,
  isConfrontationalAction,
  rollTier,
  buildRollDirective,
} from "./game-prompts";
import { syncRound } from "./narrative/sync";
import { buildNarrativeContext } from "./narrative/context";
import { writeEnvelope } from "./narrative/ledger";
import { readNarrative } from "./narrative/ledger";
import { causalityOnly } from "./session-extensions";
import type { GameActionInput, GameSessionContext } from "./types";

// 验证游戏模式「背包物品归属」解析：CI| 格式带归属者字段。
describe("parseGameOutput —— 背包物品归属", () => {
  const raw = `huanweide握紧龙髓石，目光扫过潮痕尽头。
===角色物品变动===
CI|获得|龙髓石|1|huanweide
CI|获得|黑金怀表|2
CI|消耗|破损的地图|1
===新实体===
NE|周远征|公安局长|追寻龙陨真相
【情节进度：35%】
1. 追查怀表来源
2. 返回龙骨滩`;

  const r = parseGameOutput(raw);

  it("解析出三个物品变动且归属正确", () => {
    expect(r.itemChanges.length).toBe(3);
  });

  it("带归属者的物品记录 owner（operation 已归一化为英文枚举）", () => {
    const dragon = r.itemChanges.find((c) => c.name === "龙髓石");
    expect(dragon).toBeDefined();
    expect(dragon?.operation).toBe("gain");
    expect(dragon?.quantity).toBe(1);
    expect(dragon?.owner).toBe("huanweide");
  });

  it("未填归属者时 owner 为 undefined（UI 默认显示「主角」）", () => {
    const watch = r.itemChanges.find((c) => c.name === "黑金怀表");
    expect(watch?.owner).toBeUndefined();
    expect(watch?.quantity).toBe(2);
  });

  it("消耗操作也被正确解析（operation 归一化为 consume）", () => {
    const consumed = r.itemChanges.find((c) => c.name === "破损的地图");
    expect(consumed?.operation).toBe("consume");
    expect(consumed?.quantity).toBe(1);
  });

  it("新实体与情节进度一并解析", () => {
    expect(r.newEntities.find((e) => e.name === "周远征")?.type).toBe("公安局长");
    expect(r.plotProgress).toBe(35);
  });
});

// ─── P1 万物可交互：转移/损坏标记 + 暗线（谎言与伪装）────────────
describe("parseGameOutput —— 转移/损坏/暗线（P1）", () => {
  it("转移与损坏标记解析为 transfer/damage，归属字段=新归属者", () => {
    const r = parseGameOutput(
      `老陈把钱包递了过来。\n===角色物品变动===\nCI|转移|神秘钱包|1|主角\nCI|损坏|铁剑|1|李尘\n===新实体===\n`
    );
    const tf = r.itemChanges.find((c) => c.name === "神秘钱包");
    expect(tf?.operation).toBe("transfer");
    expect(tf?.owner).toBe("主角");
    const dm = r.itemChanges.find((c) => c.name === "铁剑");
    expect(dm?.operation).toBe("damage");
    expect(dm?.owner).toBe("李尘");
  });

  it("TRICK 暗线解析为 newTricks，且暗线区块绝不残留在 narrative 里（玩家不可见）", () => {
    const r = parseGameOutput(
      `他拍了拍胸口：「钥匙在我身上，放心。」\n1. 跟他走\n===暗线===\nTRICK|书房钥匙|陈伯|空盒子，钥匙早被他儿子拿走了\n`
    );
    expect(r.newTricks.length).toBe(1);
    expect(r.newTricks[0]).toMatchObject({ name: "书房钥匙", owner: "陈伯", truth: "空盒子，钥匙早被他儿子拿走了" });
    expect(r.narrative).not.toContain("暗线");
    expect(r.narrative).not.toContain("TRICK");
    expect(r.narrative).not.toContain("空盒子");
  });

  it("没有暗线区块时 newTricks 为空数组（向后兼容）", () => {
    const r = parseGameOutput(`普通叙事。\n1. 选项\n`);
    expect(r.newTricks).toEqual([]);
  });

  it("REVEAL 销账：真相已揭露时解析出 newReveals（引擎从暗账移除，避免重复揭露）", () => {
    const r = parseGameOutput(
      `盒子打开——空的。陈伯的钥匙根本不存在。\n1. 追问陈伯\n===暗线===\nREVEAL|书房钥匙|陈伯\n`
    );
    expect(r.newReveals).toEqual([{ name: "书房钥匙", owner: "陈伯" }]);
    expect(r.narrative).not.toContain("REVEAL");
  });
});

// 验证游戏模式「操作中文→英文归一化」：AI 产出中文操作，解析器统一映射为英文枚举，
// 使引擎/前端/开局路由的 gain/consume/equip/discard 比较全部生效（阿游 P0）。
describe("parseGameOutput —— 操作中文→英文归一化（阿游 P0）", () => {
  const cases: Array<{ ci: string; op: string; name: string }> = [
    { ci: "CI|获得|怀表|1", op: "gain", name: "怀表" },
    { ci: "CI|消耗|药水|2", op: "consume", name: "药水" },
    { ci: "CI|装备|长剑|1", op: "equip", name: "长剑" },
    { ci: "CI|丢弃|破盾|1", op: "discard", name: "破盾" },
  ];

  for (const { ci, op, name } of cases) {
    it(`解析 ${ci} → operation=${op}`, () => {
      const r = parseGameOutput(`叙事继续。\n===角色物品变动===\n${ci}\n===新实体===\n`);
      expect(r.itemChanges.length).toBe(1);
      expect(r.itemChanges[0].operation).toBe(op);
      expect(r.itemChanges[0].name).toBe(name);
    });
  }

  it("中文数量被解析为阿拉伯数字（CI|获得|怀表|二 → quantity=2）", () => {
    const r = parseGameOutput(`叙事。\n===角色物品变动===\nCI|获得|怀表|二\n===新实体===\n`);
    expect(r.itemChanges.length).toBe(1);
    expect(r.itemChanges[0].operation).toBe("gain");
    expect(r.itemChanges[0].quantity).toBe(2);
  });

  it("物品名为空时（CI|获得|）跳过空名，不落库空物品", () => {
    const r = parseGameOutput(`叙事。\n===角色物品变动===\nCI|获得|\n===新实体===\n`);
    expect(r.itemChanges.length).toBe(0);
  });

  it("未知操作保留原值（如 CI|熔化|宝物|1 → operation=熔化）", () => {
    const r = parseGameOutput(`叙事。\n===角色物品变动===\nCI|熔化|宝物|1\n===新实体===\n`);
    expect(r.itemChanges.length).toBe(1);
    expect(r.itemChanges[0].operation).toBe("熔化");
  });
});

// 验证游戏模式「同义动词归一化」（阿游 N3）：模型常用同义词，应映射为对应英文枚举，
// 避免透传到 applyItemChanges 后四个分支无一命中、物品被静默丢弃。
describe("parseGameOutput —— 同义动词归一化（阿游 N3）", () => {
  const cases: Array<{ ci: string; op: string }> = [
    { ci: "CI|拾取|龙髓石|1", op: "gain" },
    { ci: "CI|捡到|金币|5", op: "gain" },
    { ci: "CI|取得|钥匙|1", op: "gain" },
    { ci: "CI|获取|符纸|3", op: "gain" },
    { ci: "CI|拾起|玉佩|1", op: "gain" },
    { ci: "CI|使用|药水|1", op: "consume" },
    { ci: "CI|服用|丹药|1", op: "consume" },
    { ci: "CI|吃掉|干粮|1", op: "consume" },
    { ci: "CI|饮用|泉水|1", op: "consume" },
    { ci: "CI|佩戴|戒指|1", op: "equip" },
    { ci: "CI|穿上|铠甲|1", op: "equip" },
    { ci: "CI|丢掉|破靴|1", op: "discard" },
    { ci: "CI|扔掉|烂绳|1", op: "discard" },
    { ci: "CI|弃置|废铁|1", op: "discard" },
  ];

  for (const { ci, op } of cases) {
    it(`解析 ${ci} → operation=${op}`, () => {
      const r = parseGameOutput(`叙事。\n===角色物品变动===\n${ci}\n===新实体===\n`);
      expect(r.itemChanges.length).toBe(1);
      expect(r.itemChanges[0].operation).toBe(op);
    });
  }

  it("带归属者的同义动词仍正常解析（CI|拾取|灵剑|1|李尘 → gain + 李尘）", () => {
    const r = parseGameOutput(`叙事。\n===角色物品变动===\nCI|拾取|灵剑|1|李尘\n===新实体===\n`);
    expect(r.itemChanges.length).toBe(1);
    expect(r.itemChanges[0].operation).toBe("gain");
    expect(r.itemChanges[0].owner).toBe("李尘");
  });
});

// 验证游戏模式「中文复合数字解析」：十二/二十/一百零五 等不应落默认 1（阿游 P1）。
describe("parseGameOutput —— 中文复合数字（阿游 P1）", () => {
  const cases: Array<[string, number]> = [
    ["十二", 12],
    ["二十", 20],
    ["三十", 30],
    ["十一", 11],
    ["二十五", 25],
    ["九十九", 99],
    ["一百", 100],
    ["一百零五", 105],
    ["一百二十", 120],
    ["十", 10],
    ["两", 2],
  ];

  for (const [cn, num] of cases) {
    it(`CI|获得|丹药|${cn} → quantity=${num}`, () => {
      const r = parseGameOutput(`叙事。\n===角色物品变动===\nCI|获得|丹药|${cn}\n===新实体===\n`);
      expect(r.itemChanges.length).toBe(1);
      expect(r.itemChanges[0].operation).toBe("gain");
      expect(r.itemChanges[0].quantity).toBe(num);
    });
  }

  it("无法解析的串（英文混合/乱码）默认按 1 处理", () => {
    const r = parseGameOutput(`叙事。\n===角色物品变动===\nCI|获得|丹药|abc\n===新实体===\n`);
    expect(r.itemChanges.length).toBe(1);
    expect(r.itemChanges[0].quantity).toBe(1);
  });
});

// 验证游戏模式「Round12 A4 同义动词补全」：消费/卸下/损毁/流转类同义词归一，消告警且不污染背包。
describe("parseGameOutput —— Round12 A4 同义动词补全", () => {
  const cases: Array<{ ci: string; op: string }> = [
    { ci: "CI|吃|馒头|1", op: "consume" },
    { ci: "CI|喝|泉水|1", op: "consume" },
    { ci: "CI|食|干粮|1", op: "consume" },
    { ci: "CI|进食|肉脯|1", op: "consume" },
    { ci: "CI|吸|烟|1", op: "consume" },
    { ci: "CI|饮|酒|1", op: "consume" },
    { ci: "CI|摘下|面具|1", op: "unequip" },
    { ci: "CI|摘掉|头盔|1", op: "unequip" },
    { ci: "CI|除下|手套|1", op: "unequip" },
    { ci: "CI|破坏|木门|1", op: "destroy" },
    { ci: "CI|砸碎|花瓶|1", op: "destroy" },
    { ci: "CI|摔碎|玉佩|1", op: "destroy" },
    { ci: "CI|烧毁|书信|1", op: "destroy" },
    { ci: "CI|焚毁|卷轴|1", op: "destroy" },
    { ci: "CI|炸毁|营寨|1", op: "destroy" },
    { ci: "CI|出售|宝物|1", op: "skip" },
    { ci: "CI|售卖|灵药|1", op: "skip" },
    { ci: "CI|卖出|旧剑|1", op: "skip" },
    { ci: "CI|交换|情报|1", op: "skip" },
    { ci: "CI|交易|货物|1", op: "skip" },
  ];

  for (const { ci, op } of cases) {
    it(`解析 ${ci} → operation=${op}`, () => {
      const r = parseGameOutput(`叙事。\n===角色物品变动===\n${ci}\n===新实体===\n`);
      expect(r.itemChanges.length).toBe(1);
      expect(r.itemChanges[0].operation).toBe(op);
    });
  }
});

// 验证 IMP-022「跨轮次记忆摘要」：长游戏（>6 轮）早期实体/关键决策不丢失。
// buildMemorySummary 仅从持久化的 ctx.entities / ctx.items / previousTurns 提取，
// 不改动 historySection 截断逻辑。
describe("buildMemorySummary —— 跨轮次记忆摘要（IMP-022）", () => {
  // 造一个 8 轮的长局：前 2 轮会掉出 historySection 的「最近 6 轮」。
  const turns = Array.from({ length: 8 }, (_, i) => ({
    round: i + 1,
    playerAction: `玩家在第${i + 1}轮的决定`,
    narrative: `第${i + 1}轮叙事内容`,
  }));

  // 早期实体（角色/势力/功法/地点）—— 模拟跨全部轮次合并去重后的结果。
  const ctx: GameSessionContext = {
    bookName: "测试书",
    chapterTitle: "第一章",
    outline: null,
    existingContent: null,
    characters: [],
    worldLore: [],
    previousTurns: turns,
    entities: [
      { name: "李尘", type: "角色", description: "主角" },
      { name: "黑风寨", type: "势力", description: "反派据点" },
      { name: "青云诀", type: "功法", description: "绝世功法" },
      { name: "断魂崖", type: "地点", description: "险地" },
    ],
    items: [
      { name: "玄铁剑", quantity: 1, category: "equipment", source: "开局", acquiredRound: 1 },
      { name: "疗伤丹", quantity: 3, category: "consumable", source: "拾取", acquiredRound: 2, owner: "李尘" },
    ],
    currentRound: 8,
    totalWords: 3000,
    maxWords: 5000,
    plotProgress: 60,
  };

  const summary = buildMemorySummary(ctx);

  it("注入跨轮次记忆摘要块（置于 historySection 之前）", () => {
    expect(summary).toContain("## 跨轮次记忆摘要");
  });

  it("列出全部持久实体（含掉出最近 6 轮的早期实体）", () => {
    expect(summary).toContain("李尘(角色)");
    expect(summary).toContain("黑风寨(势力)");
    expect(summary).toContain("青云诀(功法)");
    expect(summary).toContain("断魂崖(地点)");
  });

  it("列出当前背包关键物品并保留归属者", () => {
    expect(summary).toContain("玄铁剑 ×1（equipment）");
    expect(summary).toContain("疗伤丹 ×3（consumable）【归属：李尘】");
  });

  it("回填掉出最近 6 轮的早期玩家关键决策（第1、2轮）", () => {
    expect(summary).toContain("早期关键决策：");
    expect(summary).toContain("第1轮：玩家在第1轮的决定");
    expect(summary).toContain("第2轮：玩家在第2轮的决定");
    // 最近 6 轮（第3~8轮）不应出现在摘要里（已在 historySection 呈现）
    expect(summary).not.toContain("第8轮：玩家在第8轮的决定");
  });

  it("无实体/无物品/无早期决策时返回空串（不污染短局 prompt）", () => {
    const empty = buildMemorySummary({
      ...ctx,
      entities: [],
      items: [],
      previousTurns: turns.slice(-6), // 全部落在最近 6 轮内
    });
    expect(empty).toBe("");
  });
});

// 目标指定（阿游 R-目标）：玩家指定交互对象时注入【行动目标】头部。
describe("buildActionPrompt —— 目标指定", () => {
  const base: GameActionInput = {
    sessionId: "s1",
    actionType: "dialogue",
    actionText: "对话",
  };

  it("有 target 时在 prompt 头部注入【行动目标】", () => {
    const p = buildActionPrompt({ ...base, target: "林振山" });
    expect(p).toContain("【行动目标】本次行动针对：林振山");
    expect(p).toContain("【对话】");
    // 目标注入必须在行动模板之前
    expect(p.indexOf("【行动目标】")).toBeLessThan(p.indexOf("【对话】"));
  });

  it("无 target / 空白 target 时不注入", () => {
    expect(buildActionPrompt({ ...base })).not.toContain("【行动目标】");
    expect(buildActionPrompt({ ...base, target: "   " })).not.toContain("【行动目标】");
  });

  it("target 与自定义文本同时存在：两者都保留", () => {
    const p = buildActionPrompt({ ...base, actionType: "custom", actionText: "质问钥匙来历", target: "林振山" });
    expect(p).toContain("【行动目标】本次行动针对：林振山");
    expect(p).toContain("质问钥匙来历");
  });

  it("target 与承接选项前缀共存：目标在最前", () => {
    const p = buildActionPrompt({ ...base, selectedOption: 2, selectedOptionText: "追问老头", target: "老头" });
    expect(p.indexOf("【行动目标】")).toBeLessThan(p.indexOf("（承接上一轮"));
  });
});

// 视角契约（P0-3 扮演任意角色）：三重防歧义之①②
describe("buildPersonaContract —— 扮演视角契约", () => {
  const p = { name: "林振山", role: "antagonist", briefDescription: "赌场老板，守了十年秘密", otherNames: ["林舟", "林晚", "林振山"] };

  it("契约块置顶声明双方扮演边界", () => {
    const c = buildPersonaContract(p);
    expect(c).toContain("【视角契约");
    expect(c).toContain("玩家扮演：**林振山**");
    expect(c).toContain("除 林振山 外的一切角色");
    expect(c).toContain("玩家的每一次输入都是 **林振山 的言行与意图**");
    expect(c).toContain("不得替 林振山 自由行动");
  });

  it("otherNames 过滤扮演者自身", () => {
    const c = buildPersonaContract(p);
    expect(c).toContain("林舟、林晚");
    expect(c).not.toContain("林舟、林晚、林振山");
  });

  it("轮锚每轮重申视角", () => {
    const a = buildPersonaRoundAnchor("林振山");
    expect(a).toContain("玩家继续扮演 林振山");
    expect(a).toContain("玩家输入 = 林振山 的言行");
  });
});

// Roll 检定（P0-4 跑团模式）：骰在 LLM 前、AI 只演不判
describe("isConfrontationalAction / rollTier —— 检定判定", () => {
  it("combat 恒为对抗；观察/休息/选项永不骰", () => {
    expect(isConfrontationalAction("combat", "")).toBe(true);
    expect(isConfrontationalAction("observe", "偷袭")).toBe(false);
    expect(isConfrontationalAction("rest", "偷袭")).toBe(false);
    expect(isConfrontationalAction("option", "偷袭")).toBe(false);
  });

  it("自定义行动按关键词命中对抗", () => {
    expect(isConfrontationalAction("custom", "偷袭老头")).toBe(true);
    expect(isConfrontationalAction("custom", "说服他交出钥匙")).toBe(true);
    expect(isConfrontationalAction("custom", "仔细环顾四周")).toBe(false);
    expect(isConfrontationalAction("dialogue", "和老陈聊天")).toBe(false);
  });

  it("d100 五档边界正确", () => {
    expect(rollTier(1).key).toBe("critical_fail");
    expect(rollTier(5).key).toBe("critical_fail");
    expect(rollTier(6).key).toBe("fail");
    expect(rollTier(40).key).toBe("fail");
    expect(rollTier(41).key).toBe("partial");
    expect(rollTier(75).key).toBe("partial");
    expect(rollTier(76).key).toBe("success");
    expect(rollTier(95).key).toBe("success");
    expect(rollTier(96).key).toBe("critical_success");
    expect(rollTier(100).key).toBe("critical_success");
  });

  it("骰定约束块含既定结果与档位指令", () => {
    const d = buildRollDirective(87, rollTier(87));
    expect(d).toContain("d100 = 87");
    expect(d).toContain("成功");
    expect(d).toContain("必须如实演绎");
  });
});

// 叙事系统移植：账本要真的进提示词（不是只画在左抽屉里），且信封不破坏因果读取。
describe("叙事账本注入提示词 · 协同闭环", () => {
  const baseCtx: GameSessionContext = {
    bookName: "测试书", chapterTitle: "第一章", outline: null, existingContent: null,
    characters: [], worldLore: [], previousTurns: [], entities: [], items: [],
    currentRound: 1, totalWords: 0, maxWords: 3000, plotProgress: 5,
  };

  it("叙事上下文原样注入，占位符被替换、不残留", () => {
    const r = syncRound(null, {
      round: 1, chapterIndex: 0, chapterTitle: "第一章", totalChapters: 1,
      narrative: "林舟推开木门。", playerAction: "推门",
      newEntities: [{ name: "青云宗", type: "faction", description: "山门大派" }],
      gainedItems: [], titles: [],
      plantedSeeds: [{ id: "cs_1", type: "羁绊", subject: "老陈", description: "当年欠他一条命", plantedRound: 1, triggered: false }],
      triggeredSeeds: [],
    });
    const context = buildNarrativeContext(r.ledger, { chapterIndex: 0, totalChapters: 1 });
    const prompt = buildGameSystemPrompt({ ...baseCtx, narrativeContext: context });
    expect(prompt).toContain("## 待收伏笔");
    expect(prompt).toContain("老陈");
    expect(prompt).toContain("## 故事线");
    expect(prompt).not.toContain("{narrativeSection}");
  });

  it("不传上下文时该段为空，模板其它内容不受影响", () => {
    const prompt = buildGameSystemPrompt(baseCtx);
    expect(prompt).not.toContain("{narrativeSection}");
    expect(prompt).toContain("## 写作风格要求");
  });

  it("信封写回后 causalityOnly 仍读到因果种子（零迁移不破坏跨章继承）", () => {
    const seeds = [{ id: "cs_1", type: "羁绊", subject: "老陈", description: "当年欠他一条命", plantedRound: 1, triggered: false }];
    const r = syncRound(null, {
      round: 1, chapterIndex: 0, chapterTitle: "第一章", totalChapters: 1,
      narrative: "林舟推门。", playerAction: "推门", newEntities: [], gainedItems: [], titles: [],
      plantedSeeds: [], triggeredSeeds: [],
    });
    const env = writeEnvelope(seeds, seeds, r.ledger);
    expect(causalityOnly(env)).toHaveLength(1);
    expect(readNarrative(env).version).toBe(1);
  });
});
