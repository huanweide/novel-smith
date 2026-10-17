/**
 * Buffer 版 epub/docx → 纯文本（Import Novel · M1）
 *
 * 为什么不在这里重写 epub 解析：src/lib/manuscript-parse.ts 已有经过实战验证的实现
 * （含「href 在前 id 在后」的兼容修复），且已被浏览器端 ImportWizard 使用。
 * 这里只做一层薄薄的「Buffer → ArrayBuffer」适配，直接复用那四个纯函数，
 * 保证 CLI（Node）与浏览器端解析结果完全一致——否则同一本书在两边切出不同章节，
 * 那才是真的坑。
 */

import JSZip from "jszip";
import { parseManifest, parseSpine, stripHtml, docxToText } from "../manuscript-parse";
import { countWords, type ParsedChapter } from "./types";

/** Buffer 与 ArrayBuffer 在 Buffer.from 下互通，这里显式转换让 JSZip 类型匹配 */
function toArrayBuffer(buf: Buffer): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

/**
 * 从 xhtml 里取章节标题：优先 <title>（epub 里几乎必带，且就是章名），
 * 其次首个 h1~h3。取不到返回空串由调用方兜底。
 */
function extractTitle(xhtml: string): string {
  const decode = (s: string) =>
    s
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .trim();

  const t = (xhtml.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1];
  if (t) {
    const d = decode(t);
    if (d) return d.slice(0, 60);
  }
  return "";
}

/** 取首个 h1~h3 作为标题 */
function extractHeading(xhtml: string): string {
  const heading = (xhtml.match(/<h[123][^>]*>([\s\S]*?)<\/h[123]>/i) || [])[1];
  if (!heading) return "";
  return heading
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim()
    .slice(0, 60);
}

/**
 * 清洗 epub 常见的垃圾标题形态：
 *   - "chapter 1 - 0"（多看/微信排版工具把文件名塞进每章 <title>，尾部带序号）
 *   - "正文" / "chapter" / "untitled" 等无信息量标题
 * 这类标题等于没有标题，必须换用正文首行兜底。
 */
function isJunkTitle(t: string): boolean {
  if (!t) return true;
  const s = t.trim().toLowerCase();
  // 纯占位词
  if (/^(正文|目录|无标题|untitled|title|index)$/i.test(s)) return true;
  // "chapter" / "chapter 1" / "chapter 1 - 0" / "part.2" / "page 3"
  if (/^(chapter|part|section|page)\b[\s\-—–.·:：]*\d*[\s\-—–.·:：]*\d*$/.test(s)) return true;
  return false;
}

/**
 * 从正文中取首行作标题兜底（当 <title> 是垃圾标题时）。
 * 只取短行——长行一定是正文段落而不是标题。
 */
function titleFromContent(content: string): string {
  for (const line of content.split("\n")) {
    const t = line.trim();
    if (!t || t.length > 40) continue;
    if (/[。！？，、；]$/.test(t)) continue;
    return t;
  }
  return "";
}

/**
 * 非正文章节的文件名（封面 / 书名页 / 版权页…）。
 * spine 里常把封面放在第一位，不滤掉会在目录最前面留一个 0 字章。
 */
const NON_CHAPTER_RE =
  /cover|封面|扉页|书名页|版权|copyright|titlepage|版权页|插图|目录$|contents$|index$/i;

/**
 * 目录页判定。
 *
 * 两条线索，从强到弱：
 *  1. **结构标签**：EPUB3 目录页必有 `<nav epub:type="toc">`（或 nav 里的 toc）。
 *     这是最权威的证据，直接判死。
 *  2. **文本形态**：「一串条目 + 结尾页码」→ 无句读 + 多个数字 token。
 *
 * 为什么不只看「无句读」：正文也可能只有一句话（样章、楔子、作者公告），
 * 会被连带误杀——实测里短章节就是这样丢的。宁可漏判一个目录页，也不能吃掉真章节。
 * 同理不用「行数多」当判据：stripHtml 会把 <br/> 压成空格，目录页会变成一行。
 */
function isTocPage(xhtml: string, text: string): boolean {
  // 1) EPUB3 目录结构标签
  if (/<nav[^>]*epub:type\s*=\s*["']toc["']/i.test(xhtml)) return true;
  if (/<nav[^>]*>\s*(?:(?!<\/nav>)[\s\S])*?(?:目录|contents?)/i.test(xhtml)) return true;
  if (/<(?:dt|dd)\b/i.test(xhtml)) return true; // 定义列表式目录
  if (/role\s*=\s*["']doc-toc["']/i.test(xhtml)) return true;

  // 2) 文本形态
  const w = countWords(text);
  if (w > 300) return false;
  const punct = (text.match(/[。！？，；：]/g) || []).length;
  if (punct > 1) return false;
  const numbers = (text.match(/\d+/g) || []).length;
  if (numbers >= 3) return true; // 一串条目 + 页码
  return false;
}

/**
 * 按 spine 顺序抽取 EPUB 章节（**结构化**）。
 *
 * 关键设计：EPUB 自带章节结构（spine 里一个 xhtml = 一章，还有 nav/目录项），
 * 这是作者/工具已经声明好的分章，**比让文本分章器去猜可靠得多**。
 * 所以 epub 不走 splitter —— 否则会出现"目录项 chapter N - 0（0 字）"
 * 被当成一章、以及正文被目录页切碎这类脏结果（真实 epub 上实测过）。
 *
 * 目录页识别：正文为空、或内容全是目录链接（stripHtml 后几乎没有正文段落）。
 */
export async function parseEpubChapters(buf: Buffer): Promise<ParsedChapter[]> {
  const zip = await JSZip.loadAsync(toArrayBuffer(buf));
  const container = zip.file("META-INF/container.xml");
  if (!container) throw new Error("无效的 EPUB：缺少 META-INF/container.xml");
  const cxml = await container.async("string");
  const opfPath = (cxml.match(/full-path="([^"]+)"/) || [])[1];
  if (!opfPath) throw new Error("无效的 EPUB：找不到 OPF 路径");

  const opfFile = zip.file(opfPath);
  if (!opfFile) throw new Error(`无效的 EPUB：找不到 OPF 文件（${opfPath}）`);
  const oxml = await opfFile.async("string");

  const manifest = parseManifest(oxml);
  const spine = parseSpine(oxml);
  const baseDir = opfPath.includes("/") ? opfPath.slice(0, opfPath.lastIndexOf("/") + 1) : "";

  // 先收集原始项，最后再统一编号（便于过滤掉目录页后重排 index）
  const raw: { title: string; content: string; toc: boolean }[] = [];
  for (const id of spine) {
    const href = manifest[id];
    if (!href) continue;
    const full = baseDir + href;
    const f = zip.file(full) || zip.file(decodeURIComponent(full));
    if (!f) continue;
    const xhtml = await f.async("string");
    const text = stripHtml(xhtml);
    if (!text.trim()) continue;
    let title = extractTitle(xhtml);
    // <title> 不可用时退回 h1，再退回正文首行
    if (isJunkTitle(title)) title = extractHeading(xhtml);
    if (isJunkTitle(title)) title = titleFromContent(text);
    // 标题行常常也在正文首行，剔除以免目录与正文重复同一行
    let body = text.trim();
    if (title && body.startsWith(title)) {
      body = body.slice(title.length).replace(/^[\s\-—–·:：]+/, "").trim();
    }
    raw.push({ title, content: body, toc: NON_CHAPTER_RE.test(href) || isTocPage(xhtml, body) });
  }

  const chapters: ParsedChapter[] = [];
  let skippedToc = 0;
  for (const item of raw) {
    if (item.toc) {
      skippedToc++;
      continue;
    }
    chapters.push({
      index: chapters.length + 1,
      title: item.title || `第 ${chapters.length + 1} 节`,
      content: item.content,
      wordCount: countWords(item.content),
    });
  }

  // epub常把每章标题写成「书名 - 章名」，去掉所有章共有的书名前缀，
  // 否则目录里 200 章全都叫同一个名字，等于没有标题。
  const prefix = commonPrefix(chapters.map((c) => c.title));
  if (prefix.length >= 2) {
    for (const c of chapters) {
      const stripped = c.title.slice(prefix.length).replace(/^[\s\-—–·:：]+/, "").trim();
      if (stripped) c.title = stripped.slice(0, 60);
    }
  }

  if (skippedToc > 0) {
    (chapters as ParsedChapter[] & { _tocSkipped?: number })._tocSkipped = skippedToc;
  }
  return chapters;
}

/** 求一组标题的公共前缀（至少 2 个标题参与才有意义） */
function commonPrefix(titles: string[]): string {
  const list = titles.filter((t) => t.length > 1);
  if (list.length < 2) return "";
  let p = list[0]!;
  for (const t of list.slice(1)) {
    let i = 0;
    while (i < p.length && i < t.length && p[i] === t[i]) i++;
    p = p.slice(0, i);
    if (!p) break;
  }
  return p;
}

/**
 * 兼容入口：只要纯文本时用这个（CLI 预览、复用旧调用方）。
 * 注意：会丢掉章节结构，需要分章请用 parseEpubChapters。
 */
export async function parseEpubBuffer(buf: Buffer): Promise<string> {
  const chapters = await parseEpubChapters(buf);
  return chapters.map((c) => c.content).join("\n\n").trim();
}

/** 抽取 DOCX 正文文本 */
export async function parseDocxBuffer(buf: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(toArrayBuffer(buf));
  const doc = zip.file("word/document.xml");
  if (!doc) throw new Error("无效的 DOCX：缺少 word/document.xml");
  const xml = await doc.async("string");
  return docxToText(xml);
}