import { describe, expect, it } from "vitest";
import {
  applyRelations,
  baseDelta,
  deltasFor,
  describeChange,
  levelOf,
  outcomeFromTurn,
  relationAdjustment,
  relationTier,
  type RelationMap,
} from "./relation-ledger";
import { BASE_VERBS, BASE_VERB_KEYS, EXTENDED_SLOT_COUNT, DEFAULT_EXTENDED, composeAction, inferVerb, specForExtended } from "./verbs";

describe("四动词表", () => {
  it("四个基础动词齐全，且都带代价与风险标记", () => {
    expect(BASE_VERB_KEYS).toHaveLength(4);
    for (const k of BASE_VERB_KEYS) {
      const spec = BASE_VERBS[k];
      expect(spec.label.length).toBeGreaterThan(0);
      expect(typeof spec.costPeriods).toBe("number");
      expect(typeof spec.risk).toBe("boolean");
      expect(typeof spec.difficulty).toBe("number");
      expect(spec.phrase("某人").length).toBeGreaterThan(0);
    }
  });

  it("偷与杀比送礼聊天更难（难度修正为负）", () => {
    expect(BASE_VERBS.steal.difficulty).toBeLessThan(0);
    expect(BASE_VERBS.kill.difficulty).toBeLessThan(BASE_VERBS.steal.difficulty);
    expect(BASE_VERBS.gift.difficulty).toBeGreaterThanOrEqual(0);
    expect(BASE_VERBS.talk.difficulty).toBeGreaterThanOrEqual(0);
  });

  it("扩展动作固定 6 格，默认值可直接用", () => {
    expect(EXTENDED_SLOT_COUNT).toBe(6);
    expect(DEFAULT_EXTENDED).toHaveLength(6);
    DEFAULT_EXTENDED.forEach((a, i) => {
      expect(a.slot).toBe(i);
      expect(a.label.length).toBeGreaterThan(0);
      expect(a.text.length).toBeGreaterThan(0);
    });
  });

  it("扩展动作按文本分轻重，但永远给出可用规格（不返回空）", () => {
    const hard = specForExtended({ slot: 0, label: "砍他", text: "抄刀砍过去" });
    const soft = specForExtended({ slot: 1, label: "劝他", text: "软语劝他留下" });
    const neutral = specForExtended({ slot: 2, label: "看看", text: "看看四周" });
    expect(hard.risk).toBe(true);
    expect(hard.difficulty).toBeLessThan(0);
    expect(soft.risk).toBe(false);
    expect(soft.difficulty).toBeGreaterThan(0);
    expect(neutral.risk).toBe(false);
    expect(neutral.phrase("")).toBe("看看四周");
  });

  it("可从未归一行动里猜出动词，猜不出就落到 describe", () => {
    expect(inferVerb("dialogue", "随便说两句")).toBe("talk");
    expect(inferVerb("combat", "打他")).toBe("kill");
    expect(inferVerb("custom", "把这袋米送给他")).toBe("gift");
    expect(inferVerb("custom", "顺手偷个荷包")).toBe("steal");
    expect(inferVerb("observe", "看看天色")).toBe("describe");
  });

  it("拼行动句时保留玩家原话", () => {
    expect(composeAction(BASE_VERBS.talk, "陈伯", "我想问他旧报纸的事")).toContain("玩家原话");
    expect(composeAction(BASE_VERBS.describe, "", "我对着门磕三个头")).toBe("我对着门磕三个头");
  });
});

describe("好感变化数值", () => {
  it("送礼/聊天为正，偷窃/杀人为负", () => {
    expect(baseDelta("gift", "success")).toBe(3);
    expect(baseDelta("talk", "success")).toBe(2);
    expect(baseDelta("steal", "success")).toBeLessThan(0);
    expect(baseDelta("kill", "success")).toBe(-40);
  });

  it("失败比成功更伤（偷与杀）", () => {
    expect(baseDelta("steal", "fail")).toBeLessThan(baseDelta("steal", "success"));
    expect(baseDelta("kill", "fail")).toBeLessThan(0);
  });

  it("没有目标或纯描述时，不产生任何变化", () => {
    expect(deltasFor({ verb: "talk", outcome: "success" })).toEqual([]);
    expect(deltasFor({ verb: "describe", outcome: "success", target: "陈伯" })).toEqual([]);
  });

  it("目击者按 0.3 折算，折算为 0 就不记", () => {
    const d = deltasFor({ verb: "talk", outcome: "success", target: "陈伯", witnesses: ["李四", "路人"] });
    const byName = Object.fromEntries(d.map((x) => [x.name, x.delta]));
    expect(byName["陈伯"]).toBe(2);
    // 2 × 0.3 取整为 0 → 干脆不记，避免"看一眼就记一笔"
    expect(byName["李四"]).toBeUndefined();
    expect(byName["路人"]).toBeUndefined();
  });

  it("当事人不会被重复算成目击者", () => {
    const d = deltasFor({ verb: "talk", outcome: "success", target: "陈伯", witnesses: ["陈伯"] });
    expect(d).toHaveLength(1);
  });

  it("上下限夹住，到顶不再涨", () => {
    const prev: RelationMap = { 陈伯: { level: 99, reason: "" } };
    const { next } = applyRelations(prev, [{ verb: "gift", outcome: "success", target: "陈伯" }]);
    expect(next["陈伯"].level).toBe(100);
  });

  it("变化里带 before/after，可直接做回执", () => {
    const { next, changes } = applyRelations({}, [{ verb: "gift", outcome: "success", target: "陈伯" }]);
    expect(next["陈伯"].level).toBe(3);
    expect(changes[0]).toMatchObject({ name: "陈伯", before: 0, after: 3, delta: 3 });
    // 3 落在 0~19 区间，是「平常」；要到 20 才叫「亲近」
    expect(describeChange(changes[0])).toContain("平常");
  });

  it("没变化时不产生变更条目（防回执凑数）", () => {
    const prev: RelationMap = { 陈伯: { level: 100, reason: "" } };
    const { changes } = applyRelations(prev, [{ verb: "gift", outcome: "success", target: "陈伯" }]);
    expect(changes).toEqual([]);
  });

  it("模型给了原因就用模型的，没给就用默认文案", () => {
    const a = deltasFor({ verb: "talk", outcome: "fail", target: "陈伯", reason: "你提到了他儿子" });
    expect(a[0].reason).toBe("你提到了他儿子");
    const b = deltasFor({ verb: "talk", outcome: "fail", target: "陈伯" });
    expect(b[0].reason).toBe("你把话说拧了");
  });
});

describe("好感只改难度，不删选项", () => {
  it("五档修正值", () => {
    expect(relationAdjustment(-60)).toBe(-30);
    expect(relationAdjustment(-25)).toBe(-15);
    expect(relationAdjustment(0)).toBe(0);
    expect(relationAdjustment(25)).toBe(10);
    expect(relationAdjustment(60)).toBe(20);
  });

  it("五档档位词", () => {
    expect(relationTier(-60)).toBe("仇视");
    expect(relationTier(-5)).toBe("冷淡");
    expect(relationTier(0)).toBe("平常");
    expect(relationTier(25)).toBe("亲近");
    expect(relationTier(60)).toBe("生死之交");
  });

  it("读不存在的角色当 0，不抛错", () => {
    expect(levelOf(null, "谁")).toBe(0);
    expect(levelOf({}, "谁")).toBe(0);
  });
});

describe("回合结果 → 好感口径", () => {
  it("有预掷骰就按骰", () => {
    expect(outcomeFromTurn({ actionType: "custom", preRolledSuccess: true })).toBe("success");
    expect(outcomeFromTurn({ actionType: "custom", preRolledSuccess: false })).toBe("fail");
  });

  it("对抗类默认有代价，其余按顺利完成", () => {
    expect(outcomeFromTurn({ actionType: "combat" })).toBe("cost");
    expect(outcomeFromTurn({ actionType: "dialogue" })).toBe("success");
  });
});
