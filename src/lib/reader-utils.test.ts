import { describe, it, expect } from "vitest";
import {
  clampFontSize,
  computeReadingProgress,
  neighborIndices,
  pickInitialChapterId,
  cycleTheme,
  READER_THEMES,
  MIN_FONT_SIZE,
  MAX_FONT_SIZE,
  DEFAULT_FONT_SIZE,
} from "./reader-utils";

describe("clampFontSize", () => {
  it("夹在最小/最大区间内", () => {
    expect(clampFontSize(10)).toBe(MIN_FONT_SIZE);
    expect(clampFontSize(999)).toBe(MAX_FONT_SIZE);
    expect(clampFontSize(18)).toBe(18);
  });
  it("非数字回退默认值", () => {
    expect(clampFontSize(NaN)).toBe(DEFAULT_FONT_SIZE);
    expect(clampFontSize(Infinity)).toBe(DEFAULT_FONT_SIZE);
  });
});

describe("computeReadingProgress", () => {
  it("顶部为 0、底部为 1、中段按比例", () => {
    expect(computeReadingProgress(0, 2000, 500)).toBe(0);
    expect(computeReadingProgress(1500, 2000, 500)).toBe(1);
    // (1000)/(2000-500)=0.666...
    expect(computeReadingProgress(1000, 2000, 500)).toBeCloseTo(2 / 3, 5);
  });
  it("无滚动空间返回 0", () => {
    expect(computeReadingProgress(0, 500, 500)).toBe(0);
    expect(computeReadingProgress(50, 300, 500)).toBe(0);
  });
  it("异常输入安全归零", () => {
    expect(computeReadingProgress(NaN, 2000, 500)).toBe(0);
  });
});

describe("neighborIndices", () => {
  const ids = ["a", "b", "c"];
  it("首章无上一章、有下一章", () => {
    expect(neighborIndices(ids, "a")).toEqual({ prev: -1, next: 1 });
  });
  it("中间章两侧都有", () => {
    expect(neighborIndices(ids, "b")).toEqual({ prev: 0, next: 2 });
  });
  it("末章无下一章", () => {
    expect(neighborIndices(ids, "c")).toEqual({ prev: 1, next: -1 });
  });
  it("找不到当前章返回双 -1", () => {
    expect(neighborIndices(ids, "zzz")).toEqual({ prev: -1, next: -1 });
  });
});

describe("pickInitialChapterId", () => {
  const ids = ["a", "b", "c"];
  it("记住的章还在书里就用它", () => {
    expect(pickInitialChapterId(ids, "b")).toBe("b");
  });
  it("记住的章已被删除则退回第一章", () => {
    expect(pickInitialChapterId(ids, "zzz")).toBe("a");
  });
  it("没记住过就从第一章开始", () => {
    expect(pickInitialChapterId(ids, null)).toBe("a");
  });
  it("空书返回 null", () => {
    expect(pickInitialChapterId([], "b")).toBe(null);
  });
});

describe("cycleTheme", () => {
  it("按顺序循环并回到默认", () => {
    expect(cycleTheme("default")).toBe("night");
    expect(cycleTheme("night")).toBe("sepia");
    expect(cycleTheme("sepia")).toBe("default");
  });
  it("未知主题回到默认值", () => {
    expect(cycleTheme("bogus")).toBe(READER_THEMES[0]);
  });
});
