/**
 * 游戏本地图 —— 纯函数单测
 *
 * 重点不在"画得好看"，在**能核对**：
 * 同一份数据两次布局必须一致；不知道位置的人不能出现在图上；
 * 放不下的人要报数，不能静默消失。
 */

import { describe, it, expect } from "vitest";
import { buildSagaMap, cellLabel, relationLabel, MAP_PER_CELL } from "./saga-map";

describe("buildSagaMap —— 位置由数据唯一决定", () => {
  it("空输入不崩，统计为 0", () => {
    const m = buildSagaMap({ places: [] });
    expect(m.stats.places).toBe(0);
    expect(m.stats.people).toBe(0);
    expect(m.cells.length).toBeGreaterThan(0);
  });

  it("同一份数据两次布局完全一致（可核对的前提）", () => {
    const input = {
      places: ["旧城图书馆", "老纺织厂", "林氏旧宅"],
      currentPlace: "老纺织厂",
      playerName: "沈砚",
      people: [{ name: "沈砚", place: "老纺织厂" }, { name: "陈伯", place: "旧城图书馆" }],
    };
    const a = buildSagaMap(input);
    const b = buildSagaMap(input);
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
  });

  it("当前所在排第一格，坐标是 A1", () => {
    const m = buildSagaMap({
      places: ["旧城图书馆", "老纺织厂"],
      currentPlace: "老纺织厂",
    });
    expect(m.cells[0]?.place).toBe("老纺织厂");
    expect(m.cells[0]?.label).toBe("A1");
    expect(m.cells[0]?.isCurrent).toBe(true);
  });

  it("主角在格内排第一", () => {
    const m = buildSagaMap({
      places: ["老纺织厂"],
      currentPlace: "老纺织厂",
      playerName: "沈砚",
      people: [
        { name: "陈伯", place: "老纺织厂", level: 60 },
        { name: "沈砚", place: "老纺织厂" },
      ],
    });
    expect(m.cells[0]?.people[0].name).toBe("沈砚");
    expect(m.cells[0]?.people[0].isPlayer).toBe(true);
  });

  it("没有位置的人进行踪不明，不硬塞进格子", () => {
    const m = buildSagaMap({
      places: ["老纺织厂"],
      people: [{ name: "黑衬衫男人" }],
    });
    expect(m.unplaced.map((p) => p.name)).toEqual(["黑衬衫男人"]);
    expect(m.cells.every((c) => !c || c.people.every((p) => p.name !== "黑衬衫男人"))).toBe(true);
  });

  it("档案写了位置但世界书没登记：仍然上图（人的位置比地名表可信）", () => {
    const m = buildSagaMap({
      places: ["旧城图书馆"],
      people: [{ name: "陈伯", place: "城南破庙" }],
    });
    expect(m.cells.some((c) => c?.place === "城南破庙")).toBe(true);
  });

  it("格内超过上限要报数，不静默丢人", () => {
    const people = Array.from({ length: MAP_PER_CELL + 2 }, (_, i) => ({
      name: `角色${i}`,
      place: "老纺织厂",
    }));
    const m = buildSagaMap({ places: ["老纺织厂"], people });
    const cell = m.cells.find((c) => c?.place === "老纺织厂");
    expect(cell?.people.length).toBe(MAP_PER_CELL);
    expect(cell?.overflow).toBe(2);
  });

  it("窄栏最多两列：六个地点排成 2×3", () => {
    const m = buildSagaMap({
      places: ["一", "二", "三", "四", "五", "六"],
      maxCols: 2,
    });
    expect(m.cols).toBe(2);
    expect(m.rows).toBe(3);
    expect(m.cells).toHaveLength(6);
  });

  it("地点多于格子上限时截断，但统计按实际画出的算", () => {
    const m = buildSagaMap({ places: ["一", "二", "三", "四", "五", "六", "七"], maxCells: 6 });
    expect(m.stats.places).toBe(6);
  });
});

describe("关系分档 —— 数字要翻成人话", () => {
  it("七档边界", () => {
    expect(relationLabel(90)).toBe("生死之交");
    expect(relationLabel(80)).toBe("生死之交");
    expect(relationLabel(50)).toBe("亲厚");
    expect(relationLabel(20)).toBe("相熟");
    expect(relationLabel(0)).toBe("泛泛");
    expect(relationLabel(-19)).toBe("泛泛");
    expect(relationLabel(-20)).toBe("有隙");
    expect(relationLabel(-50)).toBe("仇怨");
    expect(relationLabel(-80)).toBe("不共戴天");
  });

  it("关系清单按轻重排序，重色在前", () => {
    const m = buildSagaMap({
      places: ["老纺织厂"],
      playerName: "沈砚",
      relations: {
        陈伯: { level: 12 },
        黑衬衫男人: { level: -85 },
        林振山: { level: 55 },
      },
    });
    expect(m.relations.map((r) => r.name)).toEqual(["黑衬衫男人", "林振山", "陈伯"]);
    expect(m.relations[0].label).toBe("不共戴天");
  });

  it("坐标标签：列在前、行在后", () => {
    expect(cellLabel(0, 0)).toBe("A1");
    expect(cellLabel(1, 2)).toBe("B3");
  });
});
