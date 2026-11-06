import { describe, it, expect, vi } from "vitest";

/**
 * AI 写作辅助链路的「配置错误」HTTP 映射判别测试。
 *
 * 背景（maxloop 全链路 HTTP 评判实跑发现）：无 Key / Key 非法时，不同端点给用户的
 * 信号不一致——有的返回 400 CONFIG「请在设置页填 Key」，有的却把同一句错误伪装成
 * 500/502「服务器内部错误，请查看日志」。后者会让第一次用 AI 写作的人以为服务挂了。
 *
 * 这三组测试把「配置类错误必须收敛为 400 CONFIG」钉死，且验证不回显 LLM 原始
 * 内部错误（L2-003）：非配置的 llm 异常仍是泛化 502。
 *
 * 全部纯 mock，不联网、不调 LLM、不需要真 Key。
 */

// ── chapter-outline：core 抛 OutlineError("llm", 泛化文案, 原始配置错误) ──
const chapterOutlineMock = vi.hoisted(() => ({
  generateChapterOutline: vi.fn(),
  OutlineError: class OutlineError extends Error {
    constructor(public code: string, message: string, public readonly cause?: unknown) {
      super(message);
      this.name = "OutlineError";
    }
  },
  rateLimitOk: { ok: true },
}));

vi.mock("@/core/pipeline/generate-chapter-outline", () => ({
  generateChapterOutline: chapterOutlineMock.generateChapterOutline,
  OutlineError: chapterOutlineMock.OutlineError,
}));
vi.mock("@/lib/rate-limit", () => ({
  rateLimit: () => chapterOutlineMock.rateLimitOk,
  clientIp: () => "127.0.0.1",
  rateLimitResponse: () => ({ payload: { error: "rate limited" }, status: 429 }),
}));
vi.mock("next/server", () => ({
  NextResponse: {
    json: (payload: unknown, init?: { status?: number }) => ({
      payload,
      status: init?.status ?? 200,
    }),
  },
}));

import { POST as chapterOutlinePOST } from "./chapter-outline/route";
import { classifyError } from "@/lib/api-error";

const KEY_ERROR = new Error(
  "LLM API Key 含非法字符（仅支持英文 / 数字，不能含中文或全角符号）——请检查环境变量 (.env)页面填入的 Key 是否多了空格或中文。",
);

const makeReq = (body: unknown) => ({ json: async () => body }) as any;

describe("配置错误映射 · chapter-outline", () => {
  it("底层抛配置错误 → 400 CONFIG + 可读文案，不回显「服务器内部错误」", async () => {
    chapterOutlineMock.generateChapterOutline.mockRejectedValue(
      new chapterOutlineMock.OutlineError("llm", "服务器内部错误，请查看日志", KEY_ERROR),
    );
    const res: any = await chapterOutlinePOST(
      makeReq({ projectId: "p1", nodeId: "n1" }),
    );
    expect(res.status).toBe(400);
    expect(res.payload.code).toBe("CONFIG");
    expect(res.payload.error).toContain("API Key");
    expect(res.payload.error).not.toContain("服务器内部错误");
    expect(res.payload.hint).toContain("设置");
  });

  it("非配置的 llm 异常 → 仍泛化 502，不回显原始 message（L2-003 回归守卫）", async () => {
    chapterOutlineMock.generateChapterOutline.mockRejectedValue(
      new chapterOutlineMock.OutlineError(
        "llm",
        "服务器内部错误，请查看日志",
        new Error("connect ECONNREFUSED 10.0.0.1:443 internal"),
      ),
    );
    const res: any = await chapterOutlinePOST(
      makeReq({ projectId: "p1", nodeId: "n1" }),
    );
    expect(res.status).toBe(502);
    expect(res.payload.error).toBe("服务器内部错误，请查看日志");
    expect(JSON.stringify(res.payload)).not.toContain("10.0.0.1");
  });

  it("既有业务边界错误不受影响：notFound → 404", async () => {
    chapterOutlineMock.generateChapterOutline.mockRejectedValue(
      new chapterOutlineMock.OutlineError("notFound", "项目或章节不存在"),
    );
    const res: any = await chapterOutlinePOST(
      makeReq({ projectId: "p1", nodeId: "n1" }),
    );
    expect(res.status).toBe(404);
    expect(res.payload.error).toContain("不存在");
  });
});

// ── classifyError 本身：CONFIG 判别的地基 ──
describe("配置错误映射 · classifyError 地基", () => {
  it("API Key 非法 → 400 CONFIG", () => {
    const info = classifyError(KEY_ERROR);
    expect(info.status).toBe(400);
    expect(info.code).toBe("CONFIG");
  });

  it("Prisma schema 不匹配 → 503 且不再误导为 Key 问题", () => {
    const info = classifyError(
      Object.assign(new Error("Prisma 客户端与数据库结构不匹配 Unknown arg `foo`"), { code: "P2010" }),
    );
    expect(info.status).toBe(503);
    expect(info.code).not.toBe("CONFIG");
  });
});
