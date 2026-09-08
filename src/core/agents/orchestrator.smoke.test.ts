import { describe, it, expect, vi } from "vitest";
import { AgentOrchestrator } from "./orchestrator";

/**
 * Orchestrator 冒烟测试（P1-8 R3 收敛配套）
 *
 * 目标：覆盖三态 —— 正常 / 超时 / 脏 JSON。
 * 做法：通过构造函数注入假 LLMClient（仅实现 chat），完全不触 DB、不触真 LLM。
 */

type ChatFn = (req: any) => Promise<{ content: string }>;

function makeOrchestrator(chat: ChatFn): AgentOrchestrator {
  const client: any = {
    chat: vi.fn(chat),
    chatStream: vi.fn(),
  };
  return new AgentOrchestrator(client as any, {} as any);
}

const minimalProject: any = {
  name: "测试之书",
  genre: ["玄幻"],
  targetWordCount: 100000,
  synopsis: "总纲",
  toneKeywords: ["热血"],
};

describe("AgentOrchestrator 冒烟（P1-8）：三态覆盖", () => {
  it("正常态：generateOutline 调 chat 后原样返回内容", async () => {
    const orch = makeOrchestrator(async () => ({ content: "起承转合：主角觉醒" }));
    const out = await orch.generateOutline(minimalProject, [], [], "");
    expect(out).toBe("起承转合：主角觉醒");
  });

  it("正常态：reviewContent 收到合法 JSON → 解析为 ReviewLog(passed=true)", async () => {
    const orch = makeOrchestrator(async () => ({
      content: JSON.stringify({ passed: true, issues: [], summary: "审校通过" }),
    }));
    const log = await orch.reviewContent("正文", "大纲", [], [], []);
    expect(log.passed).toBe(true);
    expect(Array.isArray(log.issues)).toBe(true);
  });

  it("脏 JSON 态：reviewContent 收到非法 JSON → safeParseAIJson 兜底，返回 ReviewLog 不抛错", async () => {
    const orch = makeOrchestrator(async () => ({
      content: "模型抽风了 {{{ 这不是 json ",
    }));
    // 不应抛错，应优雅降级为文本判断
    const log = await orch.reviewContent("正文", "大纲", [], [], []);
    expect(log).toBeTruthy();
    expect(typeof log.passed).toBe("boolean");
    // 无「审校通过」等关键字 → 判为不通过，issues 含一条兜底项
    expect(log.passed).toBe(false);
    expect(log.issues.length).toBeGreaterThan(0);
  });

  it("超时态：chat 抛错（超时）→ reviewContent 向上抛出", async () => {
    const orch = makeOrchestrator(async () => {
      throw new Error("AbortError: LLM 请求超时");
    });
    await expect(orch.reviewContent("正文", "大纲", [], [], [])).rejects.toThrow(
      /超时|AbortError|timeout/i,
    );
  });
});
