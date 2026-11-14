import { describe, expect, it } from "vitest";
import { classifyLoot, gateLoot, lootNotice, mergeTitles } from "./item-gate";

describe("拾取门槛：什么不该进背包", () => {
  it("无价值杂物判成 trinket（树枝生火不该进背包）", () => {
    expect(classifyLoot("树枝")).toBe("trinket");
    expect(classifyLoot("一块破布")).toBe("trinket");
    expect(classifyLoot("石子")).toBe("trinket");
    expect(classifyLoot("一碗水")).toBe("trinket");
  });

  it("真正的道具判成 item", () => {
    expect(classifyLoot("屠龙刀")).toBe("item");
    expect(classifyLoot("青铜令牌")).toBe("item");
    expect(classifyLoot("回魂丹")).toBe("item");
  });

  it("带价值标记的杂物也算真物品（防误杀）", () => {
    expect(classifyLoot("桃木枝")).toBe("item");
    expect(classifyLoot("镇派玉印")).toBe("item");
  });

  it("称号不是物，判成 title", () => {
    expect(classifyLoot("天下第一")).toBe("title");
    expect(classifyLoot("剑道之首")).toBe("title");
    expect(classifyLoot("榜首")).toBe("title");
  });

  it("有像样描述的按物品处理（拿不准就放行）", () => {
    expect(classifyLoot("不知名的东西", "从水里捞上来的，摸着发烫")).toBe("item");
  });

  it("空名当杂物，不会建出无名道具", () => {
    expect(classifyLoot("")).toBe("trinket");
    expect(classifyLoot("   ")).toBe("trinket");
  });
});

describe("批量过闸", () => {
  it("只拦 gain，消耗与丢弃照常放行（否则背包删不掉东西）", () => {
    const r = gateLoot([
      { operation: "gain", name: "树枝" },
      { operation: "consume", name: "干粮" },
      { operation: "discard", name: "破布" },
      { operation: "destroy", name: "旧剑" },
    ]);
    expect(r.trinkets.map((x) => x.name)).toEqual(["树枝"]);
    expect(r.keep.map((x) => x.name)).toEqual(["干粮", "破布", "旧剑"]);
  });

  it("称号单独分组，不混进背包也不混进杂物", () => {
    const r = gateLoot([
      { operation: "gain", name: "屠龙刀" },
      { operation: "gain", name: "天下第一" },
      { operation: "gain", name: "枯枝" },
    ]);
    expect(r.keep.map((x) => x.name)).toEqual(["屠龙刀"]);
    expect(r.titles.map((x) => x.name)).toEqual(["天下第一"]);
    expect(r.trinkets.map((x) => x.name)).toEqual(["枯枝"]);
  });
});

describe("称号入册", () => {
  it("去重、新的在前、上限 20", () => {
    const merged = mergeTitles(["旧称号", "天下第一"], ["天下第一", "剑道之首"]);
    expect(merged[0]).toBe("天下第一");
    expect(merged[1]).toBe("剑道之首");
    expect(merged).toContain("旧称号");
    expect(new Set(merged).size).toBe(merged.length);
  });

  it("超长称号截断，空值丢弃", () => {
    const merged = mergeTitles([], ["", "   ", "一".repeat(50)]);
    expect(merged).toHaveLength(1);
    expect(merged[0].length).toBe(20);
  });
});

describe("提示文案", () => {
  it("物品与称号用不同说法", () => {
    expect(lootNotice({ operation: "gain", name: "屠龙刀" }, "item")).toBe("发现物品：屠龙刀");
    expect(lootNotice({ operation: "gain", name: "天下第一" }, "title")).toBe("得到称号：天下第一");
  });
});
