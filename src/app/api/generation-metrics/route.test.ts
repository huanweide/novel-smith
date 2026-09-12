import { describe, it, expect, vi } from "vitest";

// 离线单测：mock prisma，不依赖真实数据库 / LLM / 网络
const { findMany } = vi.hoisted(() => ({ findMany: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: { llmCallLog: { findMany } },
}));

import { GET } from "@/app/api/generation-metrics/route";

function makeReq(url: string): Request {
  return new Request(url);
}

describe("generation-metrics 路由", () => {
  it("无 projectId 且库空时返回 empty:true（空态分支）", async () => {
    findMany.mockResolvedValueOnce([]);
    const res = await GET(makeReq("http://localhost/api/generation-metrics"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.empty).toBe(true);
  });

  it("带 projectId 且存在日志时返回聚合指标（聚合分支）", async () => {
    const now = new Date().toISOString();
    findMany.mockResolvedValueOnce([
      { durationMs: 1000, firstTokenMs: 100, completionTokens: 50, baseURL: "http://localhost:11434", createdAt: now },
      { durationMs: 3000, firstTokenMs: 200, completionTokens: 80, baseURL: "https://api.openai.com", createdAt: now },
    ]);
    const res = await GET(makeReq("http://localhost/api/generation-metrics?projectId=proj-1"));
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.empty).toBe(false);
    expect(body.sampleSize).toBe(2);
    expect(body.total).toBeTruthy();
    expect(body.byProvider.local).toBeTruthy();
    expect(body.byProvider.cloud).toBeTruthy();
    // P95 总延迟 = 3000 > 2000 阈值 → overThreshold=true
    expect(body.overThreshold).toBe(true);
    expect(body.thresholdMs).toBe(2000);
  });


  it("错误时返回脱敏响应不回显原始异常（SEC-LEAK-GENMETRICS）", async () => {
    findMany.mockRejectedValueOnce(
      new Error('column llm_call_log.duration_ms does not exist — SELECT "duration_ms" FROM "llm_call_log"')
    );
    const res = await GET(makeReq("http://localhost/api/generation-metrics?projectId=proj-x"));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.ok).not.toBe(true);
    expect(body.code).toBeTruthy();
    // 关键断言：原始 SQL / 表名不得回显给前端
    expect(JSON.stringify(body)).not.toContain("llm_call_log");
    expect(JSON.stringify(body)).not.toContain("does not exist");
    expect(typeof body.error).toBe("string");
    expect(body.error.length).toBeGreaterThan(0);
    expect(body.hint).toBeTruthy();
  });

  it("projectId 过滤条件被传入查询", async () => {
    findMany.mockResolvedValueOnce([]);
    await GET(makeReq("http://localhost/api/generation-metrics?projectId=abc"));
    const where = findMany.mock.lastCall![0].where;
    expect(where.projectId).toBe("abc");
    expect(where.role).toEqual({ not: { startsWith: "fail:" } });
  });
});
