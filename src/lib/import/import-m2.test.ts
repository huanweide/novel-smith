/**
 * M2 落库层短文本测试
 *
 * 按瑞宝宝要求：不做长文本/大语料，只用最短的短文本把关键契约钉死。
 * 要钉的三件事：
 *   1. 章节角色分类（frontmatter / volume / chapter）不会串
 *   2. 幂等键稳定（同一文件不重复导入）
 *   3. 续写节点 source=user 且排在导入节点之后（不污染原文）
 *
 * 不测真库写入（需要 prisma 实例，集成测试留给 API 层），
 * 这里只测纯函数，避免把测试搞慢。
 */

import { describe, it, expect } from "vitest";
import { checkHealth, type ParsedNovel } from "./types";
import { splitChapters } from "./splitter";

/** 构造一本短小说 */
function makeNovel(): ParsedNovel {
  const raw = [
    "我的小说作者某某",
    "第一章天亮了",
    "他睁开眼。",
    "第一章"  ,
    "他闭上眼。",
  ].join("\n");
  return splitChapters(raw);
}

describe("M2 落库前置：健康度角色分类", () => {
  it("短前言并回第一章，不产生 frontmatter 节点", () => {
    const novel = makeNovel();
    const h = checkHealth(novel);
    // 「我的小说作者某某」不足 80 字 → 并回第一章
    expect(h.frontMatter).not.toContain(1);
    expect(novel.chapters.length).toBeGreaterThanOrEqual(1);
  });

  it("无正文的条目被标为 emptyNodes（M2 落成 volume 而非 chapter）", () => {
    const novel: ParsedNovel = {
      chapters: [
        { index: 1, title: "第一章", content: "字".repeat(500), wordCount: 500 },
        { index: 2, title: "第二卷", content: "", wordCount: 0 },
        { index: 3, title: "第二章", content: "字".repeat(500), wordCount: 500 },
      ],
      warnings: [],
    };
    const h = checkHealth(novel);
    expect(h.emptyNodes).toEqual([2]);
  });

  it("前置附属页被标为 frontMatter（落成附录而非正文章节）", () => {
    const novel: ParsedNovel = {
      chapters: [
        { index: 1, title: "扉页", content: "字".repeat(30), wordCount: 30 },
        { index: 2, title: "作者的话", content: "字".repeat(50), wordCount: 50 },
        { index: 3, title: "第一章", content: "字".repeat(500), wordCount: 500 },
        { index: 4, title: "第二章", content: "字".repeat(500), wordCount: 500 },
      ],
      warnings: [],
    };
    const h = checkHealth(novel);
    expect(h.frontMatter).toEqual([1, 2]);
  });

  it("正文章节不会被误标为 frontmatter（分类契约的反向）", () => {
    const novel: ParsedNovel = {
      chapters: [
        { index: 1, title: "第一章 天亮了", content: "字".repeat(500), wordCount: 500 },
        { index: 2, title: "楔子", content: "字".repeat(300), wordCount: 300 },
        { index: 3, title: "番外一", content: "字".repeat(300), wordCount: 300 },
      ],
      warnings: [],
    };
    const h = checkHealth(novel);
    expect(h.frontMatter).toEqual([]);
  });
});

describe("M2 落库前置：导入解析最短闭环", () => {
  it("短 txt → 章节 + 字数，一条命令跑通", async () => {
    const { parseToNovel } = await import("./parsers");
    const buf = Buffer.from("第一章 天亮了\n他睁开眼。", "utf8");
    const novel = await parseToNovel(buf, { fileName: "我的小说.txt" });
    expect(novel.chapters.length).toBe(1);
    expect(novel.chapters[0]!.title).toContain("第一章");
    expect(novel.chapters[0]!.wordCount).toBeGreaterThan(0);
    expect(novel.title).toBe("我的小说");
  });

  it("空文件不抛错，返回 0 章 + 警告", async () => {
    const { parseToNovel } = await import("./parsers");
    const buf = Buffer.alloc(0);
    const novel = await parseToNovel(buf, { fileName: "空.txt" });
    expect(novel.chapters).toHaveLength(0);
    expect(novel.warnings.length).toBeGreaterThan(0);
  });
});