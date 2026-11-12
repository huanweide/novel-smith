/**
 * R1-D4 判别测试 · LoreTable.rows 并发覆盖
 *
 * 真缺陷锚点：`prisma/schema.prisma:837` rows 为 Json 整列、无 version 字段；
 * `fill.ts:617` 读进内存数组 → `:739` `prisma.loreTable.update({ data: { rows } })` 整列覆盖。
 * 两个填表任务并发时都从旧快照出发，后写者把先写者新增的行抹掉。
 */
import { describe, expect, it } from "vitest";
import { mergeLoreRows } from "./lore-rows-merge";

const A = { row_id: 1, name: "青龙镇", note: "旧" };
const B = { row_id: 2, name: "白帝城", note: "写者1新增" };
const C = { row_id: 3, name: "旧城图书馆", note: "写者2新增" };

describe("R1-D4 · 三路合并不丢并发新增行", () => {
  it("写者1 后落库时，写者2 已落库的新增行必须保留", () => {
    const base = [A];
    const incoming = [A, B]; // 写者1 的结果
    const fresh = [A, C]; // 写者2 已经先落库
    const merged = mergeLoreRows(base, incoming, fresh, "name");
    const names = merged.map((r) => r.name);
    expect(names).toContain("白帝城");
    expect(names).toContain("旧城图书馆");
    expect(names).toContain("青龙镇");
  });

  it("本次对既有行的更新要覆盖 fresh 里的旧值", () => {
    const base = [A];
    const incoming = [{ ...A, note: "写者1更新" }];
    const fresh = [{ ...A, note: "写者2更新" }];
    const merged = mergeLoreRows(base, incoming, fresh, "name");
    expect(merged).toHaveLength(1);
    expect(merged[0].note).toBe("写者1更新");
  });

  it("本次删除的行在 fresh 里也要被删掉", () => {
    const base = [A, C];
    const incoming = [A];
    const fresh = [A, C];
    const merged = mergeLoreRows(base, incoming, fresh, "name");
    expect(merged.map((r) => r.name)).toEqual(["青龙镇"]);
  });

  it("base 与 fresh 一致时，结果与 incoming 等价（零行为变化）", () => {
    const base = [A];
    const incoming = [A, B];
    const merged = mergeLoreRows(base, incoming, [A], "name");
    expect(merged).toEqual(incoming);
  });

  it("无 row_id 时按身份列归并，不产生重复行", () => {
    const base = [{ name: "青龙镇", note: "旧" }];
    const incoming = [{ name: "青龙镇", note: "新" }, { name: "白帝城" }];
    const fresh = [{ name: "青龙镇", note: "旧" }];
    const merged = mergeLoreRows(base, incoming, fresh, "name");
    expect(merged).toHaveLength(2);
    expect(merged.find((r) => r.name === "青龙镇")?.note).toBe("新");
  });
});

describe("R1-D4 · 并发写者 row_id 撞号（真实场景）", () => {
  it("两个写者各自从 maxId+1 生成同号新行时，两行都必须保留", () => {
    const base = [{ row_id: 1, name: "青龙镇" }];
    // 写者1 新增白帝城、写者2 新增旧城图书馆，两人都拿到 row_id=2
    const writer1 = [{ row_id: 1, name: "青龙镇" }, { row_id: 2, name: "白帝城" }];
    const writer2 = [{ row_id: 1, name: "青龙镇" }, { row_id: 2, name: "旧城图书馆" }];
    // 写者2 先落库，写者1 后落库
    const merged = mergeLoreRows(base, writer1, writer2, "name");
    expect(merged.map((r) => r.name).sort()).toEqual(["旧城图书馆", "白帝城", "青龙镇"]);
  });
});
