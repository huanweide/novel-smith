/**
 * EPUB 结构化解析测试（M1）
 *
 * 与 import-m1.test.ts 分开的原因：这里要造真实 zip 容器（JSZip），
 * 比纯文本测试慢且依赖文件系统，独立成文件更清晰、失败更好定位。
 *
 * 固化的是一条被真实 epub 教出来的规则：
 *   EPUB 自带章节结构（spine 一个文件 = 一章），**绝不能再交给文本分章器猜**。
 *   否则目录页会被当成章、标题全是 "chapter N - 0"、正文被切碎。
 */

import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { parseToNovel } from "./parsers";

/** 造一个最小可用 epub：n 个章节文件 + OPF + container */
async function makeEpub(
  chapters: { file: string; title: string; body: string }[],
  opts: { navSpine?: boolean } = {},
): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    "mimetype",
    "application/epub+zip",
  );
  zip.file(
    "META-INF/container.xml",
    `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`,
  );

  const manifestItems: string[] = [];
  const spineItems: string[] = [];
  chapters.forEach((c, i) => {
    const href = `ch${i + 1}.xhtml`;
    manifestItems.push(`<item id="c${i + 1}" href="${href}" media-type="application/xhtml+xml"/>`);
    spineItems.push(`<itemref idref="c${i + 1}"/>`);
    zip.file(
      `OEBPS/${href}`,
      `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>${c.title}</title></head>
<body><h1>${c.title}</h1>${c.body}</body></html>`,
    );
  });

  zip.file(
    "OEBPS/content.opf",
    `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bid">
  <metadata><dc:title xmlns:dc="http://purl.org/dc/elements/1.1/">测试书</dc:title></metadata>
  <manifest>${manifestItems.join("")}${opts.navSpine ? "" : ""}</manifest>
  <spine>${spineItems.join("")}</spine>
</package>`,
  );

  const buf = await zip.generateAsync({ type: "nodebuffer" });
  return buf;
}

describe("EPUB 结构化解析 · 走 spine 而非文本分章器", () => {
  it("按 spine 顺序切出章节，标题取自章节文件", async () => {
    const buf = await makeEpub([
      { file: "a", title: "第一章 天亮了", body: "<p>他睁开眼，阳光很刺眼。</p>" },
      { file: "b", title: "第二章 下雨", body: "<p>雨下了整夜。</p>" },
      { file: "c", title: "第三章 结束", body: "<p>一切都结束了。</p>" },
    ]);
    const r = await parseToNovel(buf, { format: "epub" });
    expect(r.chapters).toHaveLength(3);
    expect(r.chapters[0]!.title).toContain("第一章");
    expect(r.chapters[1]!.title).toContain("第二章");
    expect(r.chapters[2]!.title).toContain("第三章");
    // 正文不能丢失
    expect(r.chapters[0]!.content).toContain("他睁开眼");
    expect(r.chapters[0]!.wordCount).toBeGreaterThan(0);
  });

  it("章节标题行不在正文里重复出现", async () => {
    const buf = await makeEpub([
      { file: "a", title: "第一章 天亮了", body: "<p>他睁开眼。</p>" },
    ]);
    const r = await parseToNovel(buf, { format: "epub" });
    const c = r.chapters[0]!.content;
    // 标题在 <h1> 里已经出现，正文不应再重复一遍
    expect(c).toContain("他睁开眼");
    expect(c.split("第一章").length - 1).toBeLessThanOrEqual(1);
  });

  it("垃圾标题（chapter N - 0）会被清洗并从正文首行取真标题", async () => {
    // 真实 epub（多看阅读版）就是这样：每章 <title> 都是 "chapter 3 - 0"
    const zip = new JSZip();
    zip.file("mimetype", "application/epub+zip");
    zip.file(
      "META-INF/container.xml",
      `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
    );
    zip.file(
      "OEBPS/ch1.xhtml",
      `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>chapter 1 - 0</title></head><body><p>重生的第一天，他去了公司。</p></body></html>`,
    );
    zip.file(
      "OEBPS/content.opf",
      `<?xml version="1.0" encoding="utf-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bid"><metadata><dc:title xmlns:dc="http://purl.org/dc/elements/1.1/">测试</dc:title></metadata><manifest><item id="c1" href="ch1.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c1"/></spine></package>`,
    );
    const buf = await zip.generateAsync({ type: "nodebuffer" });

    const r = await parseToNovel(buf, { format: "epub" });
    expect(r.chapters).toHaveLength(1);
    expect(r.chapters[0]!.title).not.toBe("chapter 1 - 0");
    expect(r.chapters[0]!.content).toContain("重生的第一天");
  });

  it("目录页不会被当成正文章节", async () => {
    // 真实 EPUB3 目录页形态：<nav epub:type="toc"> + 一串条目 + 页码
    const zip = new JSZip();
    zip.file("mimetype", "application/epub+zip");
    zip.file(
      "META-INF/container.xml",
      `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
    );
    zip.file(
      "OEBPS/nav.xhtml",
      `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>目录</title></head>
<body><nav epub:type="toc"><ol><li><a href="ch1.xhtml">第一章 天亮了</a></li><li><a href="ch2.xhtml">第二章 下雨</a></li><li><a href="ch3.xhtml">第三章 结束</a></li></ol></nav></body></html>`,
    );
    zip.file(
      "OEBPS/ch1.xhtml",
      `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>第一章 天亮了</title></head><body><h1>第一章 天亮了</h1><p>他睁开眼，阳光很刺眼。</p></body></html>`,
    );
    zip.file(
      "OEBPS/ch2.xhtml",
      `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>第二章 下雨</title></head><body><h1>第二章 下雨</h1><p>雨下了整夜，很安静。</p></body></html>`,
    );
    zip.file(
      "OEBPS/content.opf",
      `<?xml version="1.0" encoding="utf-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bid"><metadata><dc:title xmlns:dc="http://purl.org/dc/elements/1.1/">测试</dc:title></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml"/><item id="c1" href="ch1.xhtml" media-type="application/xhtml+xml"/><item id="c2" href="ch2.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="nav"/><itemref idref="c1"/><itemref idref="c2"/></spine></package>`,
    );
    const buf = await zip.generateAsync({ type: "nodebuffer" });

    const r = await parseToNovel(buf, { format: "epub" });
    // 目录页被跳过 → 只剩 2 章
    expect(r.chapters).toHaveLength(2);
    expect(r.warnings.some((w) => w.includes("跳过"))).toBe(true);
    expect(r.chapters[0]!.content).toContain("他睁开眼");
  });

  it("无 nav 标签但有页码串的目录页也能识别（文本形态判据）", async () => {
    const zip = new JSZip();
    zip.file("mimetype", "application/epub+zip");
    zip.file(
      "META-INF/container.xml",
      `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
    );
    zip.file(
      "OEBPS/toc.xhtml",
      `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>目录</title></head><body><p>第一章 天亮了 1</p><p>第二章 下雨 2</p><p>第三章 结束 3</p><p>第四章 后续 4</p></body></html>`,
    );
    zip.file(
      "OEBPS/ch1.xhtml",
      `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>第一章 天亮了</title></head><body><h1>第一章 天亮了</h1><p>他睁开眼，阳光很刺眼。</p></body></html>`,
    );
    zip.file(
      "OEBPS/content.opf",
      `<?xml version="1.0" encoding="utf-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bid"><metadata><dc:title xmlns:dc="http://purl.org/dc/elements/1.1/">测试</dc:title></metadata><manifest><item id="toc" href="toc.xhtml" media-type="application/xhtml+xml"/><item id="c1" href="ch1.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="toc"/><itemref idref="c1"/></spine></package>`,
    );
    const buf = await zip.generateAsync({ type: "nodebuffer" });
    const r = await parseToNovel(buf, { format: "epub" });
    expect(r.chapters).toHaveLength(1);
    expect(r.chapters[0]!.content).toContain("他睁开眼");
  });

  it("只有一句正文的短章节不会被误判为目录页（回归）", async () => {
    // 曾经判据是「字数少且无句读」，结果把这种真章节一起杀了
    const buf = await makeEpub([
      { file: "a", title: "楔子", body: "<p>甲。</p>" },
      { file: "b", title: "第一章", body: "<p>乙。</p>" },
    ]);
    const r = await parseToNovel(buf, { format: "epub" });
    expect(r.chapters).toHaveLength(2);
  });

  it("每章 title 都含书名前缀时，自动剥掉公共前缀", async () => {
    const buf = await makeEpub([
      { file: "a", title: "重生之都市传说-第一章", body: "<p>甲。</p>" },
      { file: "b", title: "重生之都市传说-第二章", body: "<p>乙。</p>" },
      { file: "c", title: "重生之都市传说-第三章", body: "<p>丙。</p>" },
    ]);
    const r = await parseToNovel(buf, { format: "epub" });
    const titles = r.chapters.map((c) => c.title);
    expect(new Set(titles).size).toBe(3);
    expect(titles[0]).not.toContain("重生之都市传说-");
  });

  it("封面文件不会被当成 0 字正文章（回归）", async () => {
    // spine 第一项常是 cover.xhtml，滤掉才不在目录最前面留 0 字章
    const zip = new JSZip();
    zip.file("mimetype", "application/epub+zip");
    zip.file(
      "META-INF/container.xml",
      `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
    );
    zip.file(
      "OEBPS/cover.xhtml",
      `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>Cover</title></head><body><img src="cover.jpg"/></body></html>`,
    );
    zip.file(
      "OEBPS/ch1.xhtml",
      `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>第一章</title></head><body><h1>第一章</h1><p>他睁开眼。</p></body></html>`,
    );
    zip.file(
      "OEBPS/content.opf",
      `<?xml version="1.0" encoding="utf-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bid"><metadata><dc:title xmlns:dc="http://purl.org/dc/elements/1.1/">测试</dc:title></metadata><manifest><item id="cov" href="cover.xhtml" media-type="application/xhtml+xml"/><item id="c1" href="ch1.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="cov"/><itemref idref="c1"/></spine></package>`,
    );
    const buf = await zip.generateAsync({ type: "nodebuffer" });
    const r = await parseToNovel(buf, { format: "epub" });
    expect(r.chapters).toHaveLength(1);
    expect(r.chapters[0]!.wordCount).toBeGreaterThan(0);
  });

  it("无效 epub 返回明确警告而不是抛错", async () => {
    const zip = new JSZip();
    zip.file("random.txt", "not an epub");
    const buf = await zip.generateAsync({ type: "nodebuffer" });
    const r = await parseToNovel(buf, { format: "epub" });
    expect(r.chapters).toHaveLength(0);
    expect(r.warnings.some((w) => w.includes("EPUB 解析失败"))).toBe(true);
  });

  it("空 epub 给出明确警告", async () => {
    const zip = new JSZip();
    zip.file(
      "META-INF/container.xml",
      `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
    );
    zip.file(
      "OEBPS/content.opf",
      `<?xml version="1.0" encoding="utf-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bid"><metadata><dc:title xmlns:dc="http://purl.org/dc/elements/1.1/">空</dc:title></metadata><manifest></manifest><spine></spine></package>`,
    );
    const buf = await zip.generateAsync({ type: "nodebuffer" });
    const r = await parseToNovel(buf, { format: "epub" });
    expect(r.chapters).toHaveLength(0);
    expect(r.warnings.length).toBeGreaterThan(0);
  });
});