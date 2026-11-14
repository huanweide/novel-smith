import { describe, expect, it } from "vitest";
import { parseDiscovery, staggerDelays } from "./discovery-view";

describe("discovery-view · 浮体三段", () => {
  it("物品：拆掉前缀，只留名字", () => {
    const d = parseDiscovery("获得物品·屠龙刀", { inBag: true });
    expect(d.kind).toBe("item");
    expect(d.cat).toBe("物品");
    expect(d.text).toBe("屠龙刀");
    expect(d.sub).toBe("已进背包");
  });

  it("称号走绿色一列，不进背包", () => {
    const d = parseDiscovery("获得称号·剑道之首", { inBag: true });
    expect(d.kind).toBe("title");
    expect(d.sub).toBe("已记在名下");
  });

  it("关系变化认得出", () => {
    const d = parseDiscovery("陈伯 → 亲近+3");
    expect(d.kind).toBe("relation");
    expect(d.text).toContain("陈伯");
  });

  it("线索不进物品列", () => {
    const d = parseDiscovery("发现线索·旧报纸的下落");
    expect(d.kind).toBe("clue");
    expect(d.text).toBe("旧报纸的下落");
  });

  it("时间类认得出「第三日」", () => {
    expect(parseDiscovery("第三日 · 暮").kind).toBe("time");
  });

  it("认不出的一律算变故——不许丢，丢了就是瞒着玩家", () => {
    const d = parseDiscovery("巷口那盏灯灭了");
    expect(d.kind).toBe("event");
    expect(d.text).toBe("巷口那盏灯灭了");
  });

  it("不给 inBag 时绝不编小注", () => {
    const d = parseDiscovery("获得物品·屠龙刀");
    expect(d.sub).toBeUndefined();
  });

  it("空串不崩", () => {
    expect(() => parseDiscovery("")).not.toThrow();
    expect(parseDiscovery("").kind).toBe("event");
  });
});

describe("discovery-view · 一个个渲染上去", () => {
  it("三条以内给足时间看清", () => {
    expect(staggerDelays(3)).toEqual([0, 160, 320]);
  });

  it("条数多就收紧，别拖过一秒", () => {
    const d = staggerDelays(8);
    expect(d[7]).toBeLessThanOrEqual(700);
  });

  it("零条不给排期", () => {
    expect(staggerDelays(0)).toEqual([]);
  });
});
