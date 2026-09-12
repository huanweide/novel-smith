import { describe, it, expect, vi, beforeEach } from "vitest";

// v1.6.40 回归：PATCH 漏同步 globalPrompt 修复。
// 用 vi.mock 隔离 prisma 与 syncGlobalPrompt，断言「改作品信息字段→触发同步 / 手动覆盖 globalPrompt→不触发」。

const { updateCalls, syncMock } = vi.hoisted(() => ({
  updateCalls: [] as any[],
  syncMock: vi.fn(async () => "synced"),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    project: {
      update: vi.fn(async (args: any) => {
        updateCalls.push(args);
        return { id: args.where.id, ...args.data };
      }),
      findUnique: vi.fn(async () => ({ deletedAt: null })),
    },
  },
}));

vi.mock("@/core/sync-global-prompt", () => ({ syncGlobalPrompt: syncMock }));

import { PATCH } from "@/app/api/projects/[id]/route";

function makePatch(body: unknown): Request {
  return new Request("http://localhost/api/projects/p1", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const params = { params: Promise.resolve({ id: "p1" }) };

beforeEach(() => {
  updateCalls.length = 0;
  syncMock.mockClear();
});

describe("v1.6.40 PATCH 漏同步修复", () => {
  it("改 genre → 触发 syncGlobalPrompt(projectId)", async () => {
    const res = await PATCH(makePatch({ genre: ["科幻"] }), params);
    expect(res.status).toBe(200);
    expect(syncMock).toHaveBeenCalledWith("p1");
  });

  it("改 synopsis → 触发 syncGlobalPrompt", async () => {
    const res = await PATCH(makePatch({ synopsis: "新总纲" }), params);
    expect(res.status).toBe(200);
    expect(syncMock).toHaveBeenCalledWith("p1");
  });

  it("改 toneKeywords → 触发 syncGlobalPrompt", async () => {
    const res = await PATCH(makePatch({ toneKeywords: ["热血"] }), params);
    expect(res.status).toBe(200);
    expect(syncMock).toHaveBeenCalledWith("p1");
  });

  it("改 authorNote → 触发 syncGlobalPrompt", async () => {
    const res = await PATCH(makePatch({ authorNote: "作者指令" }), params);
    expect(res.status).toBe(200);
    expect(syncMock).toHaveBeenCalledWith("p1");
  });

  it("显式传 globalPrompt（手动覆盖）→ 不触发 sync，保留手动内容", async () => {
    const res = await PATCH(makePatch({ genre: ["科幻"], globalPrompt: "手动覆盖内容" }), params);
    expect(res.status).toBe(200);
    expect(syncMock).not.toHaveBeenCalled();
    expect(updateCalls[0].data.globalPrompt).toBe("手动覆盖内容");
  });

  it("仅改 name（非作品信息字段）→ 不触发 sync", async () => {
    const res = await PATCH(makePatch({ name: "新书名" }), params);
    expect(res.status).toBe(200);
    expect(syncMock).not.toHaveBeenCalled();
  });
});

/**
 * v3.1.126：这两个字段是 Json 数组（schema `@default("'[]'")`），前端保存时发的也是数组，
 * 消费端（core/presets、生成路由的正则后处理）一律 Array.isArray。
 * 之前 PATCH 用 optObj 校验 → 合法数组被判「必须是对象」→ UI「保存规则 / 保存黑名单」永远 400。
 */
describe("v3.1.126 PATCH 的 Json 数组字段", () => {
  it("postProcessingRules 传数组 → 200，且原样落库（UI「保存规则」不再 400）", async () => {
    const rules = [{ name: "去空格", pattern: "\\s+", flags: "g", replace: "" }];
    const res = await PATCH(makePatch({ postProcessingRules: rules }), params);
    expect(res.status).toBe(200);
    expect(updateCalls[0].data.postProcessingRules).toEqual(rules);
  });

  it("customSafetyRules 传数组 → 200，且原样落库（UI「保存黑名单」不再 400）", async () => {
    const rules = [{ id: "r1", pattern: "违禁词", enabled: true }];
    const res = await PATCH(makePatch({ customSafetyRules: rules }), params);
    expect(res.status).toBe(200);
    expect(updateCalls[0].data.customSafetyRules).toEqual(rules);
  });

  it("postProcessingRules 传单个对象 → 400，且绝不落库", async () => {
    const res = await PATCH(makePatch({ postProcessingRules: { name: "x" } }), params);
    expect(res.status).toBe(400);
    expect(updateCalls.length).toBe(0);
  });

  it("数组里混入非对象元素 → 400，且绝不落库", async () => {
    const res = await PATCH(makePatch({ postProcessingRules: [{ name: "x" }, "坏数据"] }), params);
    expect(res.status).toBe(400);
    expect(updateCalls.length).toBe(0);
  });

  it("null 仍是清空语义（200，写 null 而不是报错）", async () => {
    const res = await PATCH(makePatch({ postProcessingRules: null }), params);
    expect(res.status).toBe(200);
    expect(updateCalls[0].data.postProcessingRules).toBeNull();
  });

  it("llmConfig 仍按对象校验（别把数组规则误套到对象字段上）", async () => {
    const res = await PATCH(makePatch({ llmConfig: [{ model: "x" }] }), params);
    expect(res.status).toBe(400);
    expect(updateCalls.length).toBe(0);
  });
});
