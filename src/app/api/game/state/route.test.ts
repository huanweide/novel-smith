import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

// 真实 classifyError（不 mock），验证泄露修复：原始 err.message 不得透传
const prismaMock = vi.hoisted(() => ({
  gameSession: { findUnique: vi.fn(), update: vi.fn() },
  gameState: { deleteMany: vi.fn(), findMany: vi.fn() },
}));

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/core/game/game-engine", () => ({ getSessionSummary: vi.fn() }));
vi.mock("next/server", () => ({
  NextResponse: {
    json: (payload: unknown, init?: { status?: number }) => ({
      payload,
      status: init?.status ?? 200,
    }),
  },
}));

import { DELETE, GET } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
});

function makeReq(url: string): NextRequest {
  return new Request(url) as unknown as NextRequest;
}

describe("game/state 接口错误脱敏（SEC-LEAK-GAMESTATE / v3.1.122）", () => {
  it("DELETE 未知内部错误不再泄露原始 message，返回泛化文案 + 500", async () => {
    const leaky = new Error(
      "Error: column game_session.deleted_at does not exist\nSQL: SELECT * FROM game_session WHERE id = 'x'"
    );
    prismaMock.gameSession.findUnique.mockRejectedValueOnce(leaky);

    const res = (await DELETE(
      makeReq("http://localhost/api/game/state?sessionId=s1&round=2")
    )) as any;

    expect(res.status).toBe(500);
    expect(res.payload.ok).toBe(false);
    expect(res.payload.code).toBe("INTERNAL");
    expect(res.payload.error).toBe("服务器内部错误，请查看日志");
    // 关键：原始 SQL / 列名不得出现在响应里
    expect(JSON.stringify(res.payload)).not.toContain("does not exist");
    expect(JSON.stringify(res.payload)).not.toContain("game_session");
    expect(res.payload.hint).toBeTruthy();
  });

  it("GET Prisma 表不存在错误收敛为可读 503，不泄露原始码", async () => {
    const prismaErr: any = new Error(
      "Invalid `prisma.gameSession.findUnique()` invocation: The table `game_session` does not exist"
    );
    prismaErr.code = "P2021";
    prismaMock.gameSession.findUnique.mockRejectedValueOnce(prismaErr);

    const res = (await GET(
      makeReq("http://localhost/api/game/state?sessionId=s1")
    )) as any;

    expect(res.status).toBe(503);
    expect(res.payload.ok).toBe(false);
    expect(res.payload.code).toBe("P2021");
    expect(res.payload.error).toBe("数据库表不存在");
    expect(JSON.stringify(res.payload)).not.toContain("does not exist");
    expect(JSON.stringify(res.payload)).not.toContain("prisma.gameSession");
    expect(res.payload.hint).toBeTruthy();
  });
});
