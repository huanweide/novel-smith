// P1-8 冒烟测试：planChapterStoryline 主路径（mock getSettings + fetch，不触真 DB/真 LLM）
import { describe, it, expect, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
  recordLlmCall: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock("@/lib/llm", () => ({
  getSettings: mocks.getSettings,
  recordLlmCall: mocks.recordLlmCall,
}));
vi.mock("@/core/story-status", () => ({
  STORYLINE_STATUS: { ACTIVE: "active" },
  withStorylineLock: vi.fn(),
}));

import { planChapterStoryline } from "./plan-chapter";

const BASE_SETTINGS = { apiKey: "sk-test", baseUrl: "https://api.test/v1", model: "gpt" };

describe("planChapterStoryline 冒烟（P1-8）", () => {
  it("无 apiKey → 返回 null，不发起请求", async () => {
    mocks.getSettings.mockResolvedValue({ apiKey: "" });
    const r = await planChapterStoryline({
      projectId: "p1",
      chapterOrder: 0,
      storylines: [{ type: "main", title: "主线", status: "active" }],
    });
    expect(r).toBeNull();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("无活跃剧情线 → 返回 null", async () => {
    mocks.getSettings.mockResolvedValue(BASE_SETTINGS);
    const r = await planChapterStoryline({
      projectId: "p1",
      chapterOrder: 0,
      storylines: [{ type: "main", title: "x", status: "completed" }],
    });
    expect(r).toBeNull();
  });

  it("正常：有 apiKey + 活跃线 + fetch 命中 → 返回 planText + plan 并记录用量", async () => {
    mocks.getSettings.mockResolvedValue(BASE_SETTINGS);
    vi.stubGlobal("fetch", mocks.fetch);
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({ focus: "夺宝奇兵", advance: ["推进主线"], obstacle: "", twist: "", note: "" }),
            },
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
      }),
    });
    const r = await planChapterStoryline({
      projectId: "p1",
      chapterOrder: 0,
      storylines: [{ type: "main", title: "主线", status: "active", sevenElements: {}, description: "x" }],
    });
    expect(r).not.toBeNull();
    expect(r!.plan!.focus).toBe("夺宝奇兵");
    expect(r!.planText).toContain("夺宝奇兵");
    expect(mocks.recordLlmCall).toHaveBeenCalled();
  });
});
