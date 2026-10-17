import { describe, it, expect, vi } from "vitest";

// backfill.ts 顶部 import 了 prisma 与 getSettings，直接 import 会连带初始化
// 数据库客户端（本机 better-sqlite3 原生模块未编译时整文件报错）。
// 本测试只验证纯函数 buildEmbeddingText，故把两个副作用依赖 mock 掉。
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/llm", () => ({ getSettings: vi.fn() }));
vi.mock("@/core/llm/embedding", () => ({
  embedBatch: vi.fn(),
  isEmbeddingConfigured: vi.fn(),
}));

const { buildEmbeddingText } = await import("./backfill");

describe("buildEmbeddingText —— 把一条设定拍平成待向量化的文本", () => {
  it("标题 + 正文拼接", () => {
    expect(buildEmbeddingText({ title: "北境守将", content: "曾率部倒戈" })).toBe("北境守将 曾率部倒戈");
  });

  it("带上关键词（Json 数组形态）", () => {
    expect(buildEmbeddingText({ title: "甲", keys: ["叛将", "北境"] })).toBe("甲 叛将 北境");
  });

  it("keys 是字符串时也兼容（历史脏数据）", () => {
    expect(buildEmbeddingText({ title: "甲", keys: "叛将" })).toBe("甲 叛将");
  });

  it("keys 是非法类型（数字/对象/null）时不炸，直接忽略", () => {
    expect(buildEmbeddingText({ title: "甲", keys: 123 })).toBe("甲");
    expect(buildEmbeddingText({ title: "甲", keys: { a: 1 } })).toBe("甲");
    expect(buildEmbeddingText({ title: "甲", keys: null })).toBe("甲");
  });

  it("key 数组里混入非字符串项 → 跳过该项（stringify 出 '[object Object]' 会污染语义）", () => {
    expect(buildEmbeddingText({ title: "甲", keys: ["叛将", 123, "", null, "北境"] })).toBe("甲 叛将 北境");
  });

  it("全空 → 空串（调用方据此判为不可向量化）", () => {
    expect(buildEmbeddingText({})).toBe("");
    expect(buildEmbeddingText({ title: "  ", content: "" })).toBe("");
  });

  it("首尾空白被裁剪", () => {
    expect(buildEmbeddingText({ title: "  北境守将  ", content: " 倒戈 " })).toBe("北境守将 倒戈");
  });

  it("只给正文也能用", () => {
    expect(buildEmbeddingText({ content: "曾率部倒戈" })).toBe("曾率部倒戈");
  });
});
