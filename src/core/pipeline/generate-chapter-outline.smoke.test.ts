// P1-8 冒烟测试：generateChapterOutline 两条主路径（mock loadOutlineData + completeText + prisma）
import { describe, it, expect, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadOutlineData: vi.fn(),
  extractPrevContext: vi.fn(() => ""),
  extractNextContext: vi.fn(() => ""),
  buildCharacterList: vi.fn(() => ""),
  prepareOutlineDirective: vi.fn(async () => ""),
  formatSummaries: vi.fn(() => ""),
  formatStorylines: vi.fn(() => ""),
  extractLastChapterHook: vi.fn(() => ""),
  filterActiveStorylines: vi.fn((s: any[]) => s),
  formatDigest: vi.fn(() => ""),
  formatStage: vi.fn(() => ""),
  completeText: vi.fn(),
  prisma: { storyNode: { update: vi.fn().mockResolvedValue({}) } },
}));

vi.mock("@/core/pipeline/outline-context", () => ({
  loadOutlineData: mocks.loadOutlineData,
  extractPrevContext: mocks.extractPrevContext,
  extractNextContext: mocks.extractNextContext,
  buildCharacterList: mocks.buildCharacterList,
  prepareOutlineDirective: mocks.prepareOutlineDirective,
  formatSummaries: mocks.formatSummaries,
  formatStorylines: mocks.formatStorylines,
  extractLastChapterHook: mocks.extractLastChapterHook,
  filterActiveStorylines: mocks.filterActiveStorylines,
}));
vi.mock("@/core/pipeline", () => ({ formatDigest: mocks.formatDigest, formatStage: mocks.formatStage }));
vi.mock("@/core/llm/client", () => ({ completeText: mocks.completeText }));
vi.mock("@/lib/prisma", () => ({ prisma: mocks.prisma }));

import { generateChapterOutline, OutlineError } from "./generate-chapter-outline";

const LOAD_OK = {
  project: { name: "测试之书", genre: ["玄幻"], synopsis: "总纲", authorNote: "" },
  node: { id: "n1", title: "第一章", status: "draft", outline: "", deletedAt: undefined },
  allNodes: [{ id: "n1", title: "第一章" }],
  characters: [{ id: "c1", name: "林风", role: "protagonist", aliases: [], personality: {}, relationships: [] }],
  summaries: [],
  storylines: [],
  timelineDigest: "",
  storylineDigest: "",
  narrativeStage: null,
};

describe("generateChapterOutline 冒烟（P1-8）", () => {
  it("项目/章节不存在 → 抛 OutlineError('notFound')", async () => {
    mocks.loadOutlineData.mockResolvedValue({ project: null, node: null, allNodes: [], characters: [] });
    await expect(generateChapterOutline({ projectId: "p1", nodeId: "n1" })).rejects.toBeInstanceOf(OutlineError);
  });

  it("正常：AI 选角 + 章纲生成 + 写库", async () => {
    mocks.loadOutlineData.mockResolvedValue(LOAD_OK);
    mocks.completeText
      .mockResolvedValueOnce(JSON.stringify({ selected: ["林风"], reasoning: "主角必出" }))
      .mockResolvedValueOnce("本章章纲：林风踏入禁地，遭遇守护兽，历经苦战终获传承。");
    const r = await generateChapterOutline({ projectId: "p1", nodeId: "n1" });
    expect(r.outline).toContain("林风");
    expect(r.selectedCharacters.some((c: any) => c.name === "林风")).toBe(true);
    expect(mocks.prisma.storyNode.update).toHaveBeenCalledTimes(1);
  });
});
