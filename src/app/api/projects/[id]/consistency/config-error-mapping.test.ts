import { describe, it, expect, vi } from "vitest";

/**
 * consistency 子树的错误映射判别测试。
 *
 * 背景（maxloop 全链路 HTTP 评判实跑）：
 *  - POST /consistency（抽取事实基线，调 LLM）无 Key → 旧代码 500，修后应为 400 CONFIG。
 *  - POST /consistency/conflicts/suggest（真冲突记录，调 LLM）无 Key → 旧代码 500，
 *    且丢 code；修后应为 400 CONFIG。
 *  - 子树内 5 个 route 的 catch 原都是 jsonError(msg, 500) 硬编码，绕过统一分类，
 *    导致 Prisma 异常也被误报成「服务器故障」。现统一交给 classifyError。
 *
 * 全部纯 mock，不联网、不调 LLM、不需要真 Key。
 */

const mocks = vi.hoisted(() => ({
  extractConsistencyFacts: vi.fn(),
  getConsistencyFacts: vi.fn(),
  suggestConflictFix: vi.fn(),
}));

vi.mock("@/core/consistency/extractFacts", () => ({
  extractConsistencyFacts: mocks.extractConsistencyFacts,
  getConsistencyFacts: mocks.getConsistencyFacts,
  getConsistencyBaselineText: vi.fn().mockResolvedValue(""),
}));
vi.mock("@/core/consistency/suggestFix", () => ({
  suggestConflictFix: mocks.suggestConflictFix,
}));
vi.mock("next/server", () => ({
  NextResponse: {
    json: (payload: unknown, init?: { status?: number }) => ({
      payload,
      status: init?.status ?? 200,
    }),
  },
}));

import { POST as extractPOST } from "./route";
import { POST as suggestPOST } from "./conflicts/suggest/route";

const KEY_ERROR = new Error(
  "LLM API Key 含非法字符（仅支持英文 / 数字，不能含中文或全角符号）——请检查环境变量 (.env)页面填入的 Key 是否多了空格或中文。",
);
const makeParams = (id: string) => ({ params: Promise.resolve({ id }) }) as any;
const makeReq = (body: unknown) =>
  ({ json: async () => body, nextUrl: new URL("http://x/") }) as any;

describe("配置错误映射 · consistency POST（抽取基线）", () => {
  it("无 Key → 400 CONFIG，不再是 500 服务器故障", async () => {
    mocks.extractConsistencyFacts.mockRejectedValue(KEY_ERROR);
    const res: any = await extractPOST(makeReq({}), makeParams("p1"));
    expect(res.status).toBe(400);
    expect(res.payload.code).toBe("CONFIG");
    expect(res.payload.error).toContain("API Key");
  });

  it("项目不存在 → 仍 404（原业务语义回归守卫）", async () => {
    mocks.extractConsistencyFacts.mockRejectedValue(new Error("Project p1 not found"));
    const res: any = await extractPOST(makeReq({}), makeParams("p1"));
    expect(res.status).toBe(404);
  });

  it("Prisma 异常 → 503 而非 500（统一分类生效）", async () => {
    mocks.extractConsistencyFacts.mockRejectedValue(
      Object.assign(new Error("Prisma P2021 数据库表不存在"), { code: "P2021" }),
    );
    const res: any = await extractPOST(makeReq({}), makeParams("p1"));
    expect(res.status).toBe(503);
    expect(res.payload.code).toBe("P2021");
  });
});

describe("配置错误映射 · conflicts/suggest（冲突修正建议）", () => {
  it("真冲突 + 无 Key → 400 CONFIG，不再是 500", async () => {
    mocks.suggestConflictFix.mockRejectedValue(KEY_ERROR);
    const res: any = await suggestPOST(
      makeReq({ id: "conflict-1" }),
      makeParams("p1"),
    );
    expect(res.status).toBe(400);
    expect(res.payload.code).toBe("CONFIG");
    expect(res.payload.error).toContain("API Key");
  });

  it("缺少冲突 id → 400 参数校验（回归守卫）", async () => {
    const res: any = await suggestPOST(makeReq({}), makeParams("p1"));
    expect(res.status).toBe(400);
    expect(res.payload.error).toContain("缺少冲突 id");
  });

  it("无权访问 → 404（业务语义回归守卫）", async () => {
    mocks.suggestConflictFix.mockRejectedValue(new Error("冲突不存在或无权访问"));
    const res: any = await suggestPOST(
      makeReq({ id: "conflict-1" }),
      makeParams("p1"),
    );
    expect(res.status).toBe(404);
  });
});
