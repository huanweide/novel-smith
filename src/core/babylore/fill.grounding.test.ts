import { describe, it, expect, vi, beforeEach } from "vitest";

// 阶段 A2/A3 判别测试：
//  A2 落库前「名称必须逐字命中正文或已有权威名录」的确定性闸门，
//     把 buildWarnings 的事后字符串告警升级为事前拦截 + 结构化 skippedOps。
//  A3 ops 形状校验：非法 op / 未知表 / 缺 match 不再被静默吞掉。
// 全程 mock，不连真 LLM / 真 DB。

const updateCalls: any[] = [];
let fetchImpl: () => string;

vi.mock("@/lib/prisma", () => ({
  prisma: {
    loreTable: {
      findMany: vi.fn(async () => [
        {
          id: "t1",
          key: "geo",
          name: "地点",
          note: "",
          category: "geo",
          columns: [
            { key: "name", label: "名称", type: "text" },
            { key: "related", label: "关联", type: "text" },
          ],
          rows: [{ row_id: 1, name: "青龙镇", related: "" }],
        },
      ]),
      update: vi.fn(async (args: any) => {
        updateCalls.push(args);
        return { id: args.where.id, ...(args.data || {}) };
      }),
    },
    storyNode: { findMany: vi.fn(async () => []) },
  },
}));

vi.mock("@/lib/llm", () => ({
  getSettings: vi.fn(async () => ({ baseUrl: "https://api.example.com/v1", apiKey: "k", model: "m" })),
  recordLlmCall: vi.fn(),
}));

vi.mock("@/core/llm/client", () => ({
  buildProjectOverrides: vi.fn(() => ({})),
}));

vi.mock("fs", () => {
  const store: Record<string, string> = {};
  const mocked = {
    readFileSync: vi.fn((p: string) => {
      if (store[p] !== undefined) return store[p];
      throw new Error("ENOENT");
    }),
    writeFileSync: vi.fn((p: string, d: string) => {
      store[p] = d;
    }),
    mkdirSync: vi.fn(),
  };
  return { ...mocked, default: mocked };
});

import {
  babyloreFill,
  isNameGrounded,
  validateOps,
} from "@/core/babylore/fill";
import { safeJoin } from "@/lib/utils";

function installFetch() {
  (globalThis as any).fetch = vi.fn(async (_url: string, init: any) => {
    const body = JSON.parse(init.body);
    const prompt = String(body?.messages?.[1]?.content ?? "");
    // 实体同步那条调用不返回 operations
    const content = prompt.includes("【结构化表格定义】")
      ? fetchImpl()
      : JSON.stringify({ operations: [] });
    return {
      ok: true,
      json: async () => ({
        choices: [{ message: { content } }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
    };
  });
}

function ops(...o: any[]) {
  return JSON.stringify({ operations: o });
}

beforeEach(() => {
  updateCalls.length = 0;
  installFetch();
});

describe("isNameGrounded · 纯函数", () => {
  it("逐字命中正文 → true", () => {
    expect(isNameGrounded("旧城图书馆", "李富贵在旧城图书馆交出账册")).toBe(true);
  });
  it("不在正文但在已有权威名录 → true（复用已有行合法）", () => {
    expect(isNameGrounded("青龙镇", "本章没提这个地方", ["青龙镇"])).toBe(true);
  });
  it("既不在正文也不在名录 → false（疑似杜撰）", () => {
    expect(isNameGrounded("子虚乌有城", "本章写的是青龙镇", ["青龙镇"])).toBe(false);
  });
  it("容忍首尾空白与内部空白差异，不做模糊匹配", () => {
    expect(isNameGrounded("  青龙 镇 ", "他回到了青龙镇")).toBe(true);
    expect(isNameGrounded("青龙城", "他回到了青龙镇")).toBe(false);
  });
  it("空名 → false（不许插空主键行）", () => {
    expect(isNameGrounded("  ", "任意正文")).toBe(false);
  });
});

describe("validateOps · 纯函数（A3）", () => {
  const allowed = new Set(["geo", "person"]);
  const ok = (o: any) => validateOps([o], allowed).valid.length === 1;

  it("合法 insert / update / delete 全通过", () => {
    expect(ok({ table: "geo", op: "insert", values: { name: "青龙镇" } })).toBe(true);
    expect(ok({ table: "geo", op: "update", match: { col: "name", val: "青龙镇" }, values: { related: "x" } })).toBe(true);
    expect(ok({ table: "geo", op: "delete", match: { col: "name", val: "青龙镇" } })).toBe(true);
  });
  it("非法 op 枚举 / 未知表 / 缺 match.col / values 非对象 → 判无效并给理由", () => {
    for (const bad of [
      { table: "geo", op: "upsert", values: { name: "x" } },
      { table: "unknown_table", op: "insert", values: { name: "x" } },
      { table: "geo", op: "update", match: {}, values: { name: "x" } },
      { table: "geo", op: "insert", values: "不是对象" },
    ]) {
      const r = validateOps([bad as any], allowed);
      expect(r.valid, JSON.stringify(bad)).toHaveLength(0);
      expect(r.invalid[0].reason).toBeTruthy();
    }
  });
  it("混合数组：合法的留下、非法的被摘出，顺序不变", () => {
    const r = validateOps(
      [
        { table: "geo", op: "insert", values: { name: "甲" } },
        { table: "geo", op: "bad", values: { name: "乙" } },
        { table: "person", op: "insert", values: { name: "丙" } },
      ] as any,
      allowed,
    );
    expect(r.valid).toHaveLength(2);
    expect((r.valid[0] as any).values.name).toBe("甲");
    expect((r.valid[1] as any).values.name).toBe("丙");
    expect(r.invalid).toHaveLength(1);
  });
});

describe("babyloreFill · 杜撰名称不再落库（baseline 红 → 绿）", () => {
  const CHAPTER = "第一章 青龙镇外，少年踏入江湖，远处是白帝城。";

  it("名称在正文里 → 正常落库（绿对照，不误伤）", async () => {
    fetchImpl = () => ops({ table: "geo", op: "insert", values: { name: "白帝城" } });
    const r = await babyloreFill("proj-g1", CHAPTER);
    expect(r.applied).toBe(1);
    expect(r.ok).toBe(true);
  });

  it("名称既不在正文也不在名录 → 不落库、warnings 明确报「防杜撰」", async () => {
    fetchImpl = () => ops({ table: "geo", op: "insert", values: { name: "子虚乌有城" } });
    const r = await babyloreFill("proj-g2", CHAPTER);
    expect(r.applied).toBe(0);
    expect(updateCalls.length).toBe(0);
    expect(safeJoin(r.warnings, "")).toContain("防杜撰");
  });

  it("已有名录里的名称（复用已有行）→ 不误杀", async () => {
    fetchImpl = () => ops({ table: "geo", op: "insert", values: { name: "青龙镇", related: "少年" } });
    const r = await babyloreFill("proj-g3", "本章完全没提旧地名，只写少年远行。");
    expect(r.applied).toBe(1);
  });

  it("非法 op 被摘出后不影响同批合法 op 落库", async () => {
    fetchImpl = () =>
      ops(
        { table: "geo", op: "upsert", values: { name: "白帝城" } },
        { table: "geo", op: "insert", values: { name: "白帝城" } },
      );
    const r = await babyloreFill("proj-g4", CHAPTER);
    expect(r.applied).toBe(1);
    expect(safeJoin(r.warnings, "")).toContain("非法操作");
  });
});
