import { describe, it, expect } from "vitest";
import { resolveRefineIntent, resolveRefineMode } from "@/lib/refine-intent";

const SEL = "配送费九十九，收件人：林砚。";
const base = { hasContent: true, instruction: "润色这段文字" };

describe("resolveRefineIntent · 选中即改优先于增量续写", () => {
  it("带选中 + 指令含「续写」→ 绝不能走增量追加（回归守卫）", () => {
    // 工具条「续写」按钮旧预设：真机曾导致选中段被复述、新内容拼到章末
    const r = resolveRefineIntent({
      hasContent: true,
      instruction: "从选中文字之后自然接续，续写约300字，文风与前文一致",
      selectedText: SEL,
    });
    expect(r.hasSelectedText).toBe(true);
    expect(r.isContinuationIntent).toBe(false);
    expect(r.isTargetedFix).toBe(false);
  });

  it("工具条四条真实预设指令：只有 polish/expand/custom 走局部替换，continue 也不得命中续写", () => {
    const presets: Record<string, string> = {
      polish: "润色选中的这段文字，提升文笔与流畅度，保持原意、人称与视角不变",
      expand: "扩写选中的这段文字，补充细节、感官描写与张力，不偏离原意",
      // 修复后的 continue 预设：措辞避开续写正则，并要求输出原样包含选中文字
      continue: "以选中文字原样开头，紧接着它把情节顺势增添约300字，文风与前文一致；输出必须完整包含选中文字，不得只给新增部分",
      custom: "",
    };
    for (const [action, instruction] of Object.entries(presets)) {
      const r = resolveRefineIntent({ hasContent: true, instruction, selectedText: SEL });
      expect(r.hasSelectedText, action).toBe(true);
      expect(r.isContinuationIntent, `${action} 不应落到增量追加`).toBe(false);
    }
  });

  it("不带选中 + 续写类指令 → 保留原有增量续写行为", () => {
    for (const ins of [
      "续写约300字", "继续写", "接着写", "往下写", "补 300 字", "加200字",
      "把这段延长", "展开来写", "写出后续", "推进剧情", "往下",
    ]) {
      const r = resolveRefineIntent({ hasContent: true, instruction: ins });
      expect(r.isContinuationIntent, ins).toBe(true);
      expect(r.hasSelectedText, ins).toBe(false);
    }
  });

  it("不带选中 + 润色/精修 → 走全文重输出，不误判为续写", () => {
    for (const ins of ["润色这段文字", "提升文笔与流畅度", "精准修复人物年龄矛盾"]) {
      const r = resolveRefineIntent({ hasContent: true, instruction: ins });
      expect(r.isContinuationIntent, ins).toBe(false);
    }
    expect(resolveRefineIntent({ hasContent: true, instruction: "精准修复人物年龄矛盾" }).isTargetedFix).toBe(true);
  });

  it("精准修复即使带续写词也不走增量追加", () => {
    const r = resolveRefineIntent({
      hasContent: true,
      instruction: "精准修复并续写这一段",
      selectedText: undefined,
    });
    expect(r.isTargetedFix).toBe(true);
    expect(r.isContinuationIntent).toBe(false);
  });

  it("空正文 / 空白选区不误触发", () => {
    expect(resolveRefineIntent({ hasContent: false, instruction: "续写", selectedText: SEL })).toEqual({
      isTargetedFix: false, hasSelectedText: true, isContinuationIntent: false,
    });
    expect(resolveRefineIntent({ hasContent: true, instruction: "续写", selectedText: "   " }).hasSelectedText).toBe(false);
    expect(resolveRefineIntent({ hasContent: true, instruction: "续写", selectedText: "   " }).isContinuationIntent).toBe(true);
  });

  it("默认指令（用户没填）命中续写，行为与旧版一致", () => {
    const r = resolveRefineIntent({
      ...base,
      instruction: "请在现有正文基础上自然续写，保持文风一致，推进剧情。",
    });
    expect(r.isContinuationIntent).toBe(true);
  });
});

describe("resolveRefineMode · 阶段3 整章重掷（显式 mode，不靠关键词猜）", () => {
  it("只有 mode === 'roll' 才进入整章重掷", () => {
    const on = resolveRefineMode("roll");
    expect(on.isFullRewrite).toBe(true);
    expect(on.ignoreSelectedText).toBe(true);
    expect(on.forceNotContinuation).toBe(true);
    expect(on.allowShorterOutput).toBe(true);

    for (const m of [undefined, null, "", "refine", "write", "ROLL"]) {
      expect(resolveRefineMode(m).isFullRewrite, String(m)).toBe(false);
    }
  });

  it("非 roll 时四项开关全关，既有微调/续写行为一字不变", () => {
    expect(resolveRefineMode()).toEqual({
      isFullRewrite: false,
      ignoreSelectedText: false,
      forceNotContinuation: false,
      allowShorterOutput: false,
    });
  });

  it("关键词绝不误判：「重写这段对话」仍是普通微调", () => {
    // 真实指令文本（不是 mode 参数）里含「重写」，但 mode 未指定 → 不允许整章推翻
    const r = resolveRefineIntent({ hasContent: true, instruction: "重写这段对话，让两人更有火药味", selectedText: "A：走吧。" });
    expect(r.hasSelectedText).toBe(true);
    expect(resolveRefineMode(undefined).isFullRewrite).toBe(false);
  });
});
