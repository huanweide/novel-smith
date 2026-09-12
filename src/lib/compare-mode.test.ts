import { describe, it, expect } from "vitest";
import {
  shouldEnterCompare,
  contentStats,
  describeDelta,
  COMPARE_SIDE_LABEL,
} from "./compare-mode";

/**
 * v3.1.133 对比模式：统一判定「这次生成要不要进左右对比」。
 * 规则：原有内容非空 且 新内容非空 → 进对比；任一为空 → 直接采用（首次生成无对照物）。
 */
describe("对比模式 · shouldEnterCompare 统一判据", () => {
  it("两侧都有内容 → 进对比", () => {
    expect(shouldEnterCompare("旧正文", "新正文")).toBe(true);
  });

  it("原有内容为空（首次生成）→ 不进对比", () => {
    expect(shouldEnterCompare("", "新正文")).toBe(false);
    expect(shouldEnterCompare(null, "新正文")).toBe(false);
    expect(shouldEnterCompare(undefined, "新正文")).toBe(false);
  });

  it("新内容为空（生成失败/空产出）→ 不进对比", () => {
    expect(shouldEnterCompare("旧正文", "")).toBe(false);
    expect(shouldEnterCompare("旧正文", "   ")).toBe(false);
  });

  it("仅空白字符视为空（不因换行/空格误判有内容）", () => {
    expect(shouldEnterCompare("   \n  ", "新正文")).toBe(false);
    expect(shouldEnterCompare("旧正文", "\n\t ")).toBe(false);
  });

  it("两侧都空 → 不进对比", () => {
    expect(shouldEnterCompare("", "")).toBe(false);
  });
});

describe("对比模式 · contentStats", () => {
  it("统计字符数与段落数", () => {
    const s = contentStats("第一段\n\n第二段\n第三段");
    expect(s.chars).toBe("第一段\n\n第二段\n第三段".length);
    expect(s.paragraphs).toBe(3);
  });

  it("空白内容段落数为 0", () => {
    expect(contentStats("").paragraphs).toBe(0);
    expect(contentStats("   \n  ").paragraphs).toBe(0);
  });
});

describe("对比模式 · describeDelta", () => {
  it("增加时给绝对量与百分比", () => {
    expect(describeDelta("abcd", "abcdef")).toBe("字数 +2（+50%）");
  });

  it("减少时用负号", () => {
    expect(describeDelta("abcdefgh", "abcdef")).toBe("字数 −2（−25%）");
  });

  it("不变时提示字数不变", () => {
    expect(describeDelta("abc", "xyz")).toBe("字数不变");
  });

  it("原有为 0 时只给绝对增量", () => {
    expect(describeDelta("", "abc")).toBe("字数 +3");
  });
});

describe("对比模式 · 标签", () => {
  it("两侧标签固定为「原有内容 / 新生成内容」", () => {
    expect(COMPARE_SIDE_LABEL.original).toBe("原有内容");
    expect(COMPARE_SIDE_LABEL.new).toBe("新生成内容");
  });
});
