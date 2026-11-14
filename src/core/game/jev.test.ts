/**
 * JEV 判定层 + 意图盘 —— 纯函数单测
 *
 * 这两层决定了「自由」的体感：
 *   判得准 → 不合理的动作在界面就被挡住，正文保持好看；
 *   判得松 → 玩家永远撞不到"系统不让"，而是故事里的成败。
 * 所以这里测的不是"能不能跑"，是**边界该不该拦**。
 */
import { describe, it, expect } from "vitest";
import { verifyIntent, weighIntent, extractDestination } from "./jev";
import { buildIntentDeck, hoursLabel } from "./intent-deck";

describe("Verify —— 人 / 物 / 路，只拦确定的", () => {
  it("身上没东西就不给送（最常见的一条）", () => {
    const v = verifyIntent({ actionType: "use_item", actionText: "把干粮送给陈老伯" }, { items: [] });
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.code).toBe("no_item");
      expect(v.reason).toContain("没有");
      expect(v.alternatives.length).toBeGreaterThan(0);
    }
  });

  it("指名要送的东西不在身上 → 拦", () => {
    const v = verifyIntent({ actionType: "use_item", actionText: "把玉佩送给老板", targetItem: "玉佩" }, { items: ["干粮"] });
    expect(v.ok).toBe(false);
  });

  it("东西在身上 → 放过", () => {
    const v = verifyIntent({ actionType: "use_item", actionText: "把干粮送给陈老伯", targetItem: "干粮" }, { items: ["干粮"] });
    expect(v.ok).toBe(true);
  });

  it("人不在场 → 拦，并给出『去找他』", () => {
    const v = verifyIntent({ actionType: "dialogue", actionText: "问老板", target: "独臂老板" }, { presentNames: ["陈老伯"] });
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.code).toBe("not_present");
      expect(v.alternatives.join()).toContain("去找");
    }
  });

  it("在场表为空 → 不拦（那是不知道，不是不能）", () => {
    const v = verifyIntent({ actionType: "dialogue", actionText: "问老板", target: "独臂老板" }, { presentNames: [] });
    expect(v.ok).toBe(true);
  });

  it("不在可达之列 → 拦；可达表为空 → 放过", () => {
    const blocked = verifyIntent(
      { actionType: "explore", actionText: "去黑风口" },
      { reachable: [{ name: "镇上" }, { name: "村口" }] }
    );
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.code).toBe("unreachable");

    const pass = verifyIntent({ actionType: "explore", actionText: "去黑风口" }, { reachable: [] });
    expect(pass.ok).toBe(true);
  });

  it("能走到的地方 → 放过", () => {
    const v = verifyIntent({ actionType: "explore", actionText: "去镇上" }, { reachable: [{ name: "镇上", hours: 4 }] });
    expect(v.ok).toBe(true);
  });

  it("普通动作（观察/休息）永远放过", () => {
    expect(verifyIntent({ actionType: "observe", actionText: "看看四周" }).ok).toBe(true);
    expect(verifyIntent({ actionType: "rest", actionText: "睡一会" }).ok).toBe(true);
  });
});

describe("Verify —— 地名抽取", () => {
  it("能从『前往镇上』里认出已知地名", () => {
    expect(extractDestination("前往镇上", ["镇上", "村口"])).toBe("镇上");
  });
  it("认不出就返回空（宁可放过，不误拦）", () => {
    expect(extractDestination("随便走走", ["镇上"])).toBe("");
  });
});

describe("Judge 分流 —— 轻回合 vs 正戏", () => {
  it("观察、短移动是轻回合（不该拖成一大段）", () => {
    expect(weighIntent({ actionType: "observe", actionText: "环顾四周" })).toBe("light");
    expect(weighIntent({ actionType: "explore", actionText: "去镇上" })).toBe("light");
  });
  it("战斗、长输入是正戏", () => {
    expect(weighIntent({ actionType: "combat", actionText: "拔刀" })).toBe("scene");
    expect(
      weighIntent({ actionType: "custom", actionText: "我把仅有的一半干粮全给了他，并答应替他找回孙子" })
    ).toBe("scene");
  });
  it("移动里带埋伏/追逃 → 升为正戏", () => {
    expect(weighIntent({ actionType: "explore", actionText: "去后巷追他" })).toBe("scene");
  });
});

describe("意图盘 —— 从场景长出来，不是让玩家写", () => {
  const input = {
    present: [{ name: "陈老伯", note: "腿脚不便。他孙子丢了十年。" }],
    items: [{ name: "干粮", quantity: 2 }],
    places: [{ name: "镇上", hours: 4 }],
    threads: [{ text: "青叶帕子的来路" }],
  };

  it("有东西才出『送』牌", () => {
    const withItem = buildIntentDeck(input);
    expect(withItem.some((c) => c.verb === "送")).toBe(true);

    const noItem = buildIntentDeck({ ...input, items: [] });
    expect(noItem.some((c) => c.verb === "送")).toBe(false);
  });

  it("顺序：人 → 事 → 地 → 物（此刻最该看见的在前）", () => {
    const deck = buildIntentDeck(input);
    expect(deck[0].group).toBe("person");
    const groups = deck.map((c) => c.group);
    expect(groups.indexOf("thread")).toBeLessThan(groups.indexOf("place"));
  });

  it("一屏最多 8 张（超过就成负担）", () => {
    const many = {
      present: Array.from({ length: 6 }, (_, i) => ({ name: `人${i}` })),
      items: Array.from({ length: 4 }, (_, i) => ({ name: `物${i}` })),
      places: Array.from({ length: 4 }, (_, i) => ({ name: `地${i}`, hours: 3 })),
      threads: [{ text: "甲" }, { text: "乙" }],
    };
    expect(buildIntentDeck(many).length).toBe(8);
  });

  it("副标只取第一句且截短（卡片上不写小作文）", () => {
    const deck = buildIntentDeck(input);
    const ask = deck.find((c) => c.verb === "问")!;
    expect(ask.hint.length).toBeLessThanOrEqual(12);
    expect(ask.hint).not.toContain("。");
  });

  it("代价标签可读", () => {
    expect(hoursLabel(1)).toBe("1 刻");
    expect(hoursLabel(3)).toBe("半日");
    expect(hoursLabel(8)).toBe("一日");
    expect(hoursLabel(20)).toBe("一夜");
    expect(hoursLabel(48)).toBe("2 天");
    expect(hoursLabel(0)).toBeUndefined();
  });

  // 契约变更（2026-11-14）：空场景不再给空盘。
  // 空盘＝把"想出做什么"的活又推回给玩家，正是这套设计要消灭的东西。
  // 但也不许硬造具体的牌（没有的人不出现、没有的东西不给"送"）。
  it("空场景：不硬造具体的牌，只留通用牌", () => {
    const deck = buildIntentDeck({});
    expect(deck.length).toBeGreaterThan(0);
    expect(deck.every((c) => c.group === "self")).toBe(true);
    expect(deck.some((c) => c.verb === "问")).toBe(false);
    expect(deck.some((c) => c.verb === "送")).toBe(false);
  });
});

// ─── 轻判定（仿 JEV 结构）：只出字母，不出句子 ────────────────
import { buildStateBrief, buildDecisionPrompt, parseChoiceReply } from "./decision-model";

describe("轻判定 —— 结构照搬 JEV", () => {
  it("State 压到 ≤300 字，只留判断需要的东西", () => {
    const brief = buildStateBrief({
      time: "黄昏",
      place: "村口",
      present: ["陈老伯", "独臂老板"],
      items: ["干粮"],
    });
    expect(brief).toContain("黄昏");
    expect(brief).toContain("在场");
    expect(brief.length).toBeLessThanOrEqual(300);
  });

  it("提示词强制「一个字母 + 一位数字」，不给解释空间", () => {
    const p = buildDecisionPrompt("黄昏；在村口", "送得出吗", ["做得到", "会失败", "做不到"]);
    expect(p).toContain("只回");
    expect(p).toContain("A.");
    expect(p).toContain("C.");
  });

  it("解析容忍大小写/空格/多余标点", () => {
    const opts = ["做得到", "会失败", "做不到"];
    expect(parseChoiceReply("B8", opts)?.choice).toBe("会失败");
    expect(parseChoiceReply(" b 6 ", opts)?.confidence).toBe(0.6);
    expect(parseChoiceReply("C", opts)?.confidence).toBe(0.7);
  });

  it("越界字母或缺内容返回 null（不猜）", () => {
    expect(parseChoiceReply("Z9", ["甲", "乙"])).toBeNull();
    expect(parseChoiceReply("", ["甲", "乙"])).toBeNull();
    expect(parseChoiceReply("A5", [])).toBeNull();
  });
});
