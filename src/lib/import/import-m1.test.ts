/**
 * M1 分层测试：编码嗅探 + 分章 + 健康度
 *
 * 固化的是「导入地基」的正确性：分章错了后面全错，所以每条规则都要钉死。
 */

import { describe, it, expect } from "vitest";
import { decodeBuffer, looksMojibake } from "./encoding";
import { splitChapters } from "./splitter";
import { countWords, checkHealth } from "./types";
import { detectFormat, guessTitle } from "./parsers";

describe("编码嗅探 · 国内 txt 乱码是一等痛点", () => {
  it("严格 UTF-8 能解码时判为 utf-8 且高置信", () => {
    const buf = Buffer.from("第一章 天亮了\n他睁开眼。", "utf8");
    const r = decodeBuffer(buf);
    expect(r.encoding).toBe("utf-8");
    expect(r.confidence).toBeGreaterThan(0.9);
    expect(r.text).toContain("天亮了");
  });

  it("GBK 字节能被识别为双字节中文编码而非乱码", () => {
    // 「第一章 风云起」的 GBK 字节（由 .NET Encoding(936) 实测取得，勿凭记忆写）：
    // 第=0xB5DA 一=0xD2BB 章=0xD5C2 ' '=0x20 风=0xB7E7 云=0xD4C6 起=0xC6F0
    const gbkBytes = Buffer.from([
      0xb5, 0xda, 0xd2, 0xbb, 0xd5, 0xc2, 0x20, 0xb7, 0xe7, 0xd4, 0xc6, 0xc6, 0xf0,
    ]);
    const r = decodeBuffer(gbkBytes);
    // 关键断言：不能判成 utf-8（否则必然乱码），且解码结果不含替换字符
    expect(r.encoding).not.toBe("utf-8");
    expect(r.text).not.toContain("\ufffd");
    expect(r.text).toContain("第一章");
    expect(r.text).toContain("风云起");
  });

  it("带 BOM 时按 BOM 定编码，置信度为 1", () => {
    const buf = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("第一章", "utf8")]);
    const r = decodeBuffer(buf);
    expect(r.encoding).toBe("utf-8-bom");
    expect(r.confidence).toBe(1);
    // BOM 字符本身必须被剥掉，否则正文首部会多一个 U+FEFF
    expect(r.text.charCodeAt(0)).not.toBe(0xfeff);
    expect(r.text).toBe("第一章");
  });

  it("带 BOM 的文件不会因编码标签不被支持而抛异常", () => {
    // 回归：曾把可读名 'utf-8-bom' 直接喂给 TextDecoder，Node 不认该标签 → 抛错，
    // 导致所有带 BOM 的 txt 导入直接崩。现已映射到标准标签 'utf-8'。
    const buf = Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from("第一章 天亮了", "utf8"),
    ]);
    let r: ReturnType<typeof decodeBuffer> | null = null;
    expect(() => {
      r = decodeBuffer(buf);
    }).not.toThrow();
    expect(r!.text).toBe("第一章 天亮了");
  });

  it("UTF-16LE BOM 文件能正确解码中文", () => {
    const buf = Buffer.concat([
      Buffer.from([0xff, 0xfe]),
      Buffer.from("第一章 天亮了", "utf16le"),
    ]);
    const r = decodeBuffer(buf);
    expect(r.encoding).toBe("utf-16le");
    expect(r.text).toBe("第一章 天亮了");
  });

  it("空文件返回空文本与警告，不抛错", () => {
    const r = decodeBuffer(Buffer.alloc(0));
    expect(r.text).toBe("");
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it("looksMojibake 能识别替换字符(U+FFFD)堆积的字符串", () => {
    // 能可靠识别的是 U+FFFD 型乱码（非法字节序列）。
    // 注意：「锟斤拷」是合法汉字串，靠纯 JS 启发式无法可靠与真中文区分，
    // 故不在此断言——真遇到时靠 decodeBuffer 的 warning 提示用户手动指定编码。
    expect(looksMojibake("\ufffd\ufffd\ufffd\ufffd\ufffd\ufffd\ufffd")).toBe(true);
    expect(looksMojibake("正常的中文内容")).toBe(false);
  });
});

describe("章节切分 · 中文章节识别器", () => {
  it("识别中文数字章：第一章/第1章/第十二回", () => {
    const text = [
      "第一章 天亮了",
      "正文一。",
      "第2章 夜里",
      "正文二。",
      "第十二回 结局",
      "正文三。",
    ].join("\n");
    const r = splitChapters(text);
    expect(r.chapters).toHaveLength(3);
    expect(r.chapters[0]!.title).toContain("第一章");
    expect(r.chapters[1]!.title).toContain("第2章");
    expect(r.chapters[2]!.title).toContain("第十二回");
  });

  it("识别特殊篇：序章/楔子/番外", () => {
    const text = ["楔子", "很久以前。", "第一章 开始", "正文。", "番外 后续", "番外故事继续。"].join("\n");
    const r = splitChapters(text);
    expect(r.chapters.length).toBeGreaterThanOrEqual(3);
    expect(r.chapters.some((c) => c.title.includes("楔子"))).toBe(true);
    expect(r.chapters.some((c) => c.title.includes("番外"))).toBe(true);
  });

  it("正文句不会因含篇名词被误判成标题（回归：番外内容。整段被吃掉）", () => {
    // 曾经「番外内容。」被 番外 分支当成新章节标题，导致上一章正文被截断丢失。
    // 现在靠"句末标点 = 正文"这道防线挡住。
    const text = [
      "番外一 旧事",
      "他推开门，屋里没人。",
      "番外内容。",
      "她低声说了句什么。",
    ].join("\n");
    const r = splitChapters(text);
    expect(r.chapters).toHaveLength(1);
    expect(r.chapters[0]!.content).toContain("他推开门");
    // 关键：被误判吃掉的那句必须还在正文里
    expect(r.chapters[0]!.content).toContain("番外内容。");
    expect(r.chapters[0]!.content).toContain("她低声说了句什么");
  });

  it("以句末标点结尾的行一律不作标题（楔子有感。 这类正文句）", () => {
    const text = ["楔子有感。", "正文内容。", "第一章 开始", "正文。"].join("\n");
    const r = splitChapters(text);
    expect(r.chapters.some((c) => c.title === "楔子有感。")).toBe(false);
    expect(r.chapters[0]!.content).toContain("楔子有感。");
  });

  it("识别英文 Chapter", () => {
    const text = ["Chapter 1 The Start", "Body one.", "Chapter 2 Next", "Body two."].join("\n");
    const r = splitChapters(text);
    expect(r.chapters).toHaveLength(2);
    expect(r.chapters[0]!.title).toContain("Chapter 1");
  });

  it("长行不算标题（避免正文里的『第一章』误判）", () => {
    const longLine = "第一章 这是一个特别长的句子，长到超过了标题长度限制，所以它应该被当作正文内容而不是标题来处理才对";
    const r = splitChapters(longLine);
    // 没有真实标题 → 触发兜底强切
    expect(r.warnings.some((w) => w.includes("未匹配到任何章节标题"))).toBe(true);
  });

  it("无章节标题时兜底强切并明确警告", () => {
    const body = "这是一段没有任何章节标题的正文。".repeat(50);
    const r = splitChapters(body, { fallbackChunkWords: 200 });
    expect(r.warnings.some((w) => w.includes("未匹配到"))).toBe(true);
    expect(r.chapters.length).toBeGreaterThan(0);
  });

  it("自定义正则可覆盖内置识别器", () => {
    const text = ["【01】开篇", "正文一。", "【02】承接", "正文二。"].join("\n");
    const r = splitChapters(text, { chapterRegex: "^【\\d+】" });
    expect(r.chapters).toHaveLength(2);
    expect(r.chapters[0]!.title).toContain("【01】");
  });

  it("有实质篇幅的前言保留为独立首章（≥80 字）", () => {
    const longPreamble = "作者的话：".concat("这是一段足够长的前言内容，用来验证它会被识别成独立章节。".repeat(4));
    const text = [longPreamble, "第一章 开始", "正文。"].join("\n");
    const r = splitChapters(text);
    expect(r.chapters.length).toBeGreaterThanOrEqual(2);
    expect(r.chapters[0]!.title).toBe("前言");
  });

  it("短前言并回第一章而不是单独成章，且内容一个字不丢", () => {
    // 真实案例：txt 开头常有「书名 / 作者：xxx / 01-51完整版」这类文件头残留，
    // 单独切成一个 10~20 字的章是噪声。并回第一章 = 不丢内容 + 不产生噪声章。
    const text = ["我的小说", "作者：某某", "第一章 开始", "正文。"].join("\n");
    const r = splitChapters(text);
    expect(r.chapters).toHaveLength(1);
    expect(r.chapters[0]!.title).toContain("第一章");
    const first = r.chapters[0]!.content;
    expect(first).toContain("我的小说");
    expect(first).toContain("作者：某某");
    expect(first).toContain("正文。");
  });

  it("正文内容不丢：任何情况下总字数都覆盖全文", () => {
    const text = ["作者的话：这是一段前言。", "第一章 开始", "正文。"].join("\n");
    const r = splitChapters(text);
    const total = r.chapters.reduce((s, c) => s + c.wordCount, 0);
    expect(total).toBeGreaterThan(0);
    // 前言的字必须出现在某章里（独立成章或并入第一章都算）
    const all = r.chapters.map((c) => c.content).join("\n");
    expect(all).toContain("作者的话");
  });
});

describe("字数与健康度", () => {
  it("中文字数按汉字计，拉丁串按词计", () => {
    expect(countWords("你好世界")).toBe(4);
    expect(countWords("hello world")).toBe(2);
    expect(countWords("")).toBe(0);
  });

  it("健康度能标记异常短章", () => {
    const chapters = [
      { index: 1, title: "第一章", content: "长".repeat(1000), wordCount: 1000 },
      { index: 2, title: "第二章", content: "短", wordCount: 1 },
      { index: 3, title: "第三章", content: "长".repeat(1000), wordCount: 1000 },
    ];
    const h = checkHealth({ chapters, warnings: [] });
    expect(h.chapterCount).toBe(3);
    expect(h.suspiciousShort).toContain(2);
    expect(h.warnings.some((w) => w.includes("偏少"))).toBe(true);
  });

  it("健康度能标记异常长章，并说明多半是原书合并发布而非分章失败", () => {
    // 真实案例：网络作者为凑更早上架，把近 18 万字合并成一个"章"。
    // 解析器不该硬切（会切碎），但必须标出来（阅读体验差 + 用户可手动拆）。
    const chapters = [
      { index: 1, title: "第一章", content: "字".repeat(5000), wordCount: 5000 },
      { index: 2, title: "第四十九章", content: "字".repeat(97000), wordCount: 97000 },
      { index: 3, title: "第五十章", content: "字".repeat(5000), wordCount: 5000 },
    ];
    const h = checkHealth({ chapters, warnings: [] });
    expect(h.suspiciousLong).toContain(2);
    const w = h.warnings.find((x) => x.includes("异常长"))!;
    expect(w).toBeTruthy();
    // 措辞必须引导用户去「导入后手动拆章」，而不是去调分章正则
    expect(w).toContain("原书");
    expect(w).toContain("手动拆章");
  });

  it("正常波动不算异常长（阈值不误伤）", () => {
    const chapters = [
      { index: 1, title: "第一章", content: "字".repeat(5000), wordCount: 5000 },
      { index: 2, title: "第二章", content: "字".repeat(8000), wordCount: 8000 },
      { index: 3, title: "第三章", content: "字".repeat(5000), wordCount: 5000 },
    ];
    const h = checkHealth({ chapters, warnings: [] });
    expect(h.suspiciousLong).toEqual([]);
  });

  it("前置附属页不算异常短章（回归：曾误报 99 章）", () => {
    // 真实 epub（《风姿物语》）头部全是扉页/作者简介/人物表，只有几十到几千字，
    // 但它们不是分章出错，不该刷几十条假警淹没真问题。
    const chapters = [
      { index: 1, title: "扉页", content: "字".repeat(30), wordCount: 30 },
      { index: 2, title: "作者简介", content: "字".repeat(179), wordCount: 179 },
      { index: 3, title: "主要人物", content: "字".repeat(4122), wordCount: 4122 },
      { index: 4, title: "第一章 初识", content: "字".repeat(6000), wordCount: 6000 },
      { index: 5, title: "第二章", content: "字".repeat(7000), wordCount: 7000 },
      { index: 6, title: "第三章", content: "字".repeat(6500), wordCount: 6500 },
    ];
    const h = checkHealth({ chapters, warnings: [] });
    expect(h.suspiciousShort).toEqual([]);
    // 但它们要被单独标出来，供 M2 落库时打 kind=frontmatter
    expect(h.frontMatter).toEqual([1, 2, 3]);
  });

  it("真正的漏切短章仍会被报出（豁免只针对前置页）", () => {
    const chapters = [
      { index: 1, title: "扉页", content: "字".repeat(30), wordCount: 30 },
      { index: 2, title: "第一章", content: "字".repeat(6000), wordCount: 6000 },
      { index: 3, title: "第二章", content: "字".repeat(7000), wordCount: 7000 },
      { index: 4, title: "第三章", content: "字".repeat(6500), wordCount: 6500 },
      { index: 5, title: "第四章", content: "字".repeat(5), wordCount: 5 },
    ];
    const h = checkHealth({ chapters, warnings: [] });
    expect(h.suspiciousShort).toContain(5);
    expect(h.suspiciousShort).not.toContain(1);
  });

  it("零章节时给出明确警告", () => {
    const h = checkHealth({ chapters: [], warnings: [] });
    expect(h.warnings.some((w) => w.includes("未识别出任何章节"))).toBe(true);
  });
});

describe("格式与书名推断", () => {
  it("按扩展名判定格式", () => {
    expect(detectFormat("a.txt")).toBe("txt");
    expect(detectFormat("a.EPUB")).toBe("epub");
    expect(detectFormat("a.md")).toBe("markdown");
    expect(detectFormat("a.pdf")).toBe("pdf");
    expect(detectFormat("a.docx")).toBe("docx");
    expect(detectFormat("a.xyz")).toBeNull();
  });

  it("从文件名推断书名", () => {
    expect(guessTitle("我的小说.txt")).toBe("我的小说");
    expect(guessTitle("三体_刘慈欣.epub")).toBe("三体 刘慈欣");
  });
});