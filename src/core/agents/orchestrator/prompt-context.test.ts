import { describe, it, expect } from "vitest";
import { buildPromptContext } from "@/core/agents/orchestrator/prompt-context";

function makeProject(genre: string[]) {
  return {
    id: "p1",
    name: "测试书",
    genre,
    llmConfig: {},
    globalPrompt: "",
    synopsis: "",
    toneKeywords: [],
  } as any;
}

function makeNode() {
  return { id: "n1", order: 0, title: "第1章", outline: "", type: "chapter" } as any;
}

const baseArgs = {
  project: makeProject(["都市"]),
  currentNode: makeNode(),
  previousNodes: [],
  characters: [],
  loreEntries: [],
  chapterSummaries: [],
} as any;

describe("buildPromptContext · 通用体裁去AI味（好看基本盘）", () => {
  it("非修仙体裁的 systemPrompt 必须包含去AI味/结构/对话/描写节奏铁律", () => {
    const ctx = buildPromptContext({ ...baseArgs, project: makeProject(["都市"]) });
    expect(ctx.systemPrompt).toContain("去 AI 味");
    expect(ctx.systemPrompt).toContain("结构铁律");
    expect(ctx.systemPrompt).toContain("对话铁律");
    // 通用块独有标头（修仙引擎不叫这个名字），用作「通用块已注入」的判别锚点
    expect(ctx.systemPrompt).toContain("描写与节奏");
    expect(ctx.systemPrompt).toContain("慢（铺垫）→ 中（推进）");
    // 通用块独有：篇幅段（好看基本盘——避免非修仙书写太薄章）
    expect(ctx.systemPrompt).toContain("篇幅（本章目标字数优先）");
    expect(ctx.systemPrompt).toContain("2000 字");
    // 判别锁：作者目标字数必须是最高优先级，且不得残留旧版「不得低于下限」的冲突句
    // （旧句曾把用户设的 600 字短章顶到 1721 字，并让续写撞 max_tokens 截断）
    expect(ctx.systemPrompt).toContain("最高优先级约束");
    expect(ctx.systemPrompt).toContain("不得为了凑下限把它拉长");
    expect(ctx.systemPrompt).not.toContain("不得低于上述下限");
    // 通用块独有：钩子与悬念（追更感——读者为什么翻下一章）
    expect(ctx.systemPrompt).toContain("钩子与悬念");
    expect(ctx.systemPrompt).toContain("开篇钩子");
    expect(ctx.systemPrompt).toContain("章末钩子");
    expect(ctx.systemPrompt).toContain("中段防坠");
    // 通用分支仍用资深小说作家角色
    expect(ctx.systemPrompt).toContain("资深小说作家");
  });

  it("修仙体裁仍走原引擎，不被通用块覆盖（回归守卫）", () => {
    const ctx = buildPromptContext({ ...baseArgs, project: makeProject(["修仙"]) });
    // 修仙路径独有标头，证明原引擎完整保留
    expect(ctx.systemPrompt).toContain("白金级玄幻修仙网文作家");
    // 修仙路径不挂通用块（避免冗余/风险），用通用块独有短语判别
    expect(ctx.systemPrompt).not.toContain("慢（铺垫）→ 中（推进）");
    // 修仙引擎自带 2500 字硬约束，不挂通用块的篇幅段（避免双重约束打架）
    expect(ctx.systemPrompt).not.toContain("篇幅（本章目标字数优先）");
    // 修仙引擎自带其节奏/钩子体系，不挂通用块的钩子节（避免双重约束打架）
    expect(ctx.systemPrompt).not.toContain("钩子与悬念");
  });

  it("多体裁命中修仙关键词时仍走引擎，不误伤", () => {
    const ctx = buildPromptContext({ ...baseArgs, project: makeProject(["都市", "玄幻"]) });
    expect(ctx.systemPrompt).toContain("白金级玄幻修仙网文作家");
    expect(ctx.systemPrompt).not.toContain("慢（铺垫）→ 中（推进）");
    expect(ctx.systemPrompt).not.toContain("篇幅（本章目标字数优先）");
    expect(ctx.systemPrompt).not.toContain("钩子与悬念");
  });
});
