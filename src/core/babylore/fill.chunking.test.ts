import { describe, it, expect, vi, beforeEach } from "vitest";

// 阶段 A1 判别测试：证明「章节正文被硬截断到 12000 字」是确定性漏抽根因。
// 用 2 万字章节、把关键事实只放在第 1.5 万字处：
//   旧实现（slice(0,12000)）→ 模型根本看不到该事实 → applied=0（红）
//   新实现（分块+重叠）    → 至少一块含该事实   → applied>=1（绿）
// 全程 mock，不连真 LLM / 真 DB。

const updateCalls: any[] = [];
const fillPrompts: string[] = [];
let fetchImpl: (ctx: { prompt: string }) => string;
let fetchDelay = 0;
let inFlight = 0;
let maxInFlight = 0;

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
          rows: [],
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

import { babyloreFill, splitChapterText } from "@/core/babylore/fill";

const MARKER = "李富贵在旧城图书馆交出青铜账册";

function installFetch() {
  (globalThis as any).fetch = vi.fn(async (_url: string, init: any) => {
    const body = JSON.parse(init.body);
    const prompt = String(body?.messages?.[1]?.content ?? "");
    // babyloreFill 之后还会调 syncChapterEntities（另一次 LLM），这里只统计填表抽取调用
    const isFill = prompt.includes("【结构化表格定义】");
    if (isFill) fillPrompts.push(prompt);
    if (isFill && fetchDelay > 0) {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, fetchDelay));
      inFlight--;
    }
    return {
      ok: true,
      json: async () => ({
        choices: [{ message: { content: fetchImpl({ prompt }) } }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
    };
  });
}

beforeEach(() => {
  updateCalls.length = 0;
  fillPrompts.length = 0;
  fetchDelay = 0;
  inFlight = 0;
  maxInFlight = 0;
  installFetch();
});

describe("splitChapterText · 分块纯函数", () => {
  it("短章（≤12000 字）返回单块且逐字不变——旧行为零变化", () => {
    const text = "甲".repeat(12000);
    expect(splitChapterText(text)).toEqual([text]);
    expect(splitChapterText("短章")).toEqual(["短章"]);
  });

  it("空/无正文安全返回空数组，不产生空块", () => {
    expect(splitChapterText("")).toEqual([]);
  });

  it("长章被切成多块，且原文任意位置都被至少一块覆盖（无盲区）", () => {
    const text = "甲乙丙丁".repeat(6000); // 24000 字
    const chunks = splitChapterText(text);
    expect(chunks.length).toBeGreaterThan(1);
    // 尾部内容必须在某个块里（旧实现这里整段丢失）
    expect(chunks.some((c) => c.endsWith("甲乙丙丁"))).toBe(true);
    // 用唯一标记验证中段不丢
    const marked = "甲".repeat(15000) + MARKER + "乙".repeat(5000);
    expect(splitChapterText(marked).some((c) => c.includes(MARKER))).toBe(true);
  });

  it("相邻块有重叠窗口，边界处的事实不会被切成两半", () => {
    const text = "甲".repeat(11990) + MARKER + "乙".repeat(12000);
    const chunks = splitChapterText(text);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.some((c) => c.includes(MARKER))).toBe(true);
  });

  it("块尺寸可控：自定义 chunkSize/overlap 生效且不长出无限小块", () => {
    const chunks = splitChapterText("甲".repeat(1000), 400, 50);
    expect(chunks.length).toBeLessThan(6);
    expect(chunks.every((c) => c.length <= 400)).toBe(true);
  });
});

describe("babyloreFill · 长章尾部事实不再被静默丢弃（baseline 红 → 绿）", () => {
  it("2 万字章节、关键事实只在第 1.5 万字处 → 该事实必须落地", async () => {
    const longChapter = "甲".repeat(15000) + MARKER + "乙".repeat(5000);
    fetchImpl = ({ prompt }) =>
      prompt.includes(MARKER)
        ? JSON.stringify({
            operations: [{ table: "geo", op: "insert", values: { name: "旧城图书馆" } }],
          })
        : JSON.stringify({ operations: [] });

    const r = await babyloreFill("proj-chunk", longChapter);
    expect(r.applied).toBeGreaterThanOrEqual(1);
    expect(r.ok).toBe(true);
    expect(fillPrompts.length).toBeGreaterThan(1); // 确实分了块，不是靠调大截断值蒙混
    expect(fillPrompts.some((p) => p.includes(MARKER))).toBe(true);
    // 落库的行里必须出现这个名称
    const written = updateCalls.flatMap((c: any) => c?.data?.rows ?? []);
    expect(written.some((row: any) => row.name === "旧城图书馆")).toBe(true);
  });

  it("短章仍只调用一次填表抽取（零额外成本、零行为变化）", async () => {
    fetchImpl = () =>
      JSON.stringify({ operations: [{ table: "geo", op: "insert", values: { name: "青龙镇" } }] });
    const r = await babyloreFill("proj-short", "第一章 青龙镇外，少年踏入江湖。");
    expect(r.ok).toBe(true);
    expect(fillPrompts).toHaveLength(1);
  });
});

describe("阶段 B · 长章多块抽取并行（baseline 红 → 绿）", () => {
  const longChapter = "甲".repeat(15000) + MARKER + "乙".repeat(5000);

  it("多块同时发出，峰值并发 >1（串行实现下恒为 1）", async () => {
    fetchDelay = 20;
    fetchImpl = () =>
      JSON.stringify({ operations: [{ table: "geo", op: "insert", values: { name: "旧城图书馆" } }] });
    await babyloreFill("proj-parallel", longChapter);
    expect(fillPrompts.length).toBeGreaterThan(1);
    expect(maxInFlight).toBeGreaterThan(1);
  });

  it("短章并发恒为 1，不因并行化产生额外调用", async () => {
    fetchDelay = 20;
    fetchImpl = () =>
      JSON.stringify({ operations: [{ table: "geo", op: "insert", values: { name: "青龙镇" } }] });
    await babyloreFill("proj-parallel-short", "第一章 青龙镇外，少年踏入江湖。");
    expect(fillPrompts).toHaveLength(1);
    expect(maxInFlight).toBe(1);
  });

  it("并行不破坏保序：合并后的 ops 仍按块序落地（不变量锁）", async () => {
    // 三个名称都是 MARKER 的子串，能过 A2 原文命中闸门
    const names = ["旧城图书馆", "青铜账册", "账册"];
    fetchImpl = ({ prompt }) => {
      const seg = /【章节分段】本段为第 (\d+)\//.exec(prompt);
      const idx = seg ? Number(seg[1]) : 1;
      return JSON.stringify({
        operations: [{ table: "geo", op: "insert", values: { name: names[(idx - 1) % 3], _seg: idx } }],
      });
    };
    const r = await babyloreFill("proj-order", longChapter);
    expect(r.ok).toBe(true);
    // 每个 op 都会写一次全量 rows，只取最后一次快照，避免把历史快照重复计入
    const last = updateCalls[updateCalls.length - 1];
    const written = (last?.data?.rows ?? []) as any[];
    const segs = written.map((row: any) => row._seg).filter((v: any) => v != null);
    expect(segs.length).toBeGreaterThan(1);
    expect(segs).toEqual([...segs].sort((a: any, b: any) => a - b));
  });
});
