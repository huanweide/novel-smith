import { describe, it, expect } from "vitest";
import {
  elementsFor,
  stripElements,
  THREE_ELEMENTS,
  ELEMENT_META,
} from "./constants";

describe("elementsFor", () => {
  it("主线返回三要素（origin / process / result）", () => {
    const r = elementsFor("main");
    expect(r).toBe(THREE_ELEMENTS);
    expect(r.map((e) => e.key)).toEqual(["origin", "process", "result"]);
  });

  it("支线 / 主线以外 / undefined 一律返回七要素", () => {
    expect(elementsFor("side").map((e) => e.key)).toEqual(
      ELEMENT_META.map((e) => e.key),
    );
    expect(elementsFor("thread").map((e) => e.key)).toEqual(
      ELEMENT_META.map((e) => e.key),
    );
    expect(elementsFor(undefined).map((e) => e.key)).toEqual(
      ELEMENT_META.map((e) => e.key),
    );
    expect(elementsFor("whatever").map((e) => e.key)).toEqual(
      ELEMENT_META.map((e) => e.key),
    );
  });
});

describe("stripElements", () => {
  it("主线只保留三要素，丢弃七要素残留（防止类型切换时字段污染保存）", () => {
    const input = {
      origin: "起因",
      process: "经过",
      result: "结果",
      desire: "欲望",
      obstacle: "阻碍",
      action: "行动",
      twist: "意外",
      turn: "转折",
      ending: "结局",
    };
    const out = stripElements(input, "main");
    expect(Object.keys(out).sort()).toEqual(["origin", "process", "result"]);
    expect(out.origin).toBe("起因");
    expect(out.result).toBe("结果");
    // 残留七要素不污染主线 payload
    expect(out).not.toHaveProperty("desire");
    expect(out).not.toHaveProperty("ending");
  });

  it("支线只保留七要素，丢弃主线残留", () => {
    const input = {
      desire: "欲望",
      obstacle: "阻碍",
      action: "行动",
      result: "结果",
      twist: "意外",
      turn: "转折",
      ending: "结局",
      origin: "主线起因残留",
      process: "主线经过残留",
    };
    const out = stripElements(input, "side");
    expect(Object.keys(out).sort()).toEqual(
      ["action", "desire", "ending", "obstacle", "result", "turn", "twist"].sort(),
    );
    expect(out).not.toHaveProperty("origin");
    expect(out).not.toHaveProperty("process");
  });

  it("主线 result 与七要素 result 同名不冲突，均映射到 result", () => {
    const out = stripElements({ result: "主线结果", origin: "o" }, "main");
    expect(out.result).toBe("主线结果");
    expect(out.origin).toBe("o");
  });

  it("null / undefined 要素值归一为空字符串（保存时空值统一）", () => {
    const out = stripElements(
      { desire: null, obstacle: undefined, action: "行动" },
      "side",
    );
    expect(out.desire).toBe("");
    expect(out.obstacle).toBe("");
    expect(out.action).toBe("行动");
  });

  it("空对象返回空对象", () => {
    expect(stripElements({}, "main")).toEqual({});
  });
});
