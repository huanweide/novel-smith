/**
 * 格式解析器统一入口（Import Novel · M1）
 *
 * 职责边界：本文件只做「字节/文件 → ParsedNovel」的编排，
 * 具体能力下沉到 encoding（解码）/ splitter（分章）/ manuscript-parse（epub/docx 抽文本）。
 * 新增格式只需在 detectFormat + parseToNovel 里加一个分支。
 */

import { decodeBuffer, type Encoding } from "./encoding";
import { splitChapters, type SplitOptions } from "./splitter";
import {
  emptyNovel,
  checkHealth,
  countWords,
  type ImportFormat,
  type ParsedChapter,
  type ParsedNovel,
} from "./types";
import { parseEpubChapters, parseDocxBuffer } from "./buffer-text";

/** 按文件名 / MIME 判定格式 */
export function detectFormat(fileName: string, mime = ""): ImportFormat | null {
  const n = fileName.toLowerCase();
  if (n.endsWith(".txt")) return "txt";
  if (n.endsWith(".md") || n.endsWith(".markdown")) return "markdown";
  if (n.endsWith(".epub")) return "epub";
  if (n.endsWith(".docx")) return "docx";
  if (n.endsWith(".pdf")) return "pdf";
  // 兜底按 MIME
  if (mime.includes("epub")) return "epub";
  if (mime.includes("pdf")) return "pdf";
  if (mime.includes("wordprocessingml")) return "docx";
  return null;
}

/** 从文件名去掉扩展名 + 常见噪声，作书名兜底 */
export function guessTitle(fileName: string): string {
  return fileName
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[._]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export interface ParseOptions extends SplitOptions {
  /** 用户指定编码（txt） */
  encoding?: Encoding | string;
  /** 覆盖自动判定的格式 */
  format?: ImportFormat;
  /** 标题兜底：文件名 */
  fileName?: string;
}

/**
 * 主入口：字节 → ParsedNovel。
 *
 * pdf 暂不实现（解析脆、依赖重），显式报错而不是给半成品——
 * 上层要能明确告诉用户"这个格式还没支持"，比静默返回空结果强。
 */
export async function parseToNovel(
  buf: Buffer | Uint8Array,
  opts: ParseOptions = {},
): Promise<ParsedNovel> {
  const bytes = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  const format = opts.format ?? (opts.fileName ? detectFormat(opts.fileName) : null);

  if (!format) {
    const n = emptyNovel([`无法识别的文件格式${opts.fileName ? `（${opts.fileName}）` : ""}`]);
    return n;
  }

  if (format === "pdf") {
    return emptyNovel(["PDF 解析尚未支持，请先转为 txt 或 epub 后再导入"]);
  }

  let text: string | null = null;
  let structured: ParsedNovel | null = null;
  let encoding: Encoding | null = null;
  const warnings: string[] = [];

  if (format === "epub") {
    // EPUB 自带章节结构（spine 一个文件 = 一章），比文本分章器猜得准，
    // 所以走结构化分支，不跑 splitter —— 见 buffer-text.ts 里的实测问题说明。
    try {
      const chapters = await parseEpubChapters(bytes);
      const tocSkipped = (chapters as ParsedChapter[] & { _tocSkipped?: number })._tocSkipped ?? 0;
      if (tocSkipped > 0) {
        warnings.push(`已跳过 ${tocSkipped} 个非正文页（封面 / 目录页 / 空页，均由 EPUB 自带结构识别）`);
      }
      structured = { chapters, warnings: [] };
    } catch (e) {
      return emptyNovel([`EPUB 解析失败：${(e as Error).message}`]);
    }
  } else if (format === "docx") {
    try {
      text = await parseDocxBuffer(bytes);
    } catch (e) {
      return emptyNovel([`DOCX 解析失败：${(e as Error).message}`]);
    }
  } else {
    // txt / markdown：解码
    const dec = decodeBuffer(bytes, opts.encoding);
    text = dec.text;
    encoding = dec.encoding;
    warnings.push(...dec.warnings);
  }

  if (structured) {
    structured.warnings = [...warnings, ...structured.warnings];
    if (structured.chapters.length === 0) {
      return {
        ...structured,
        warnings: [...structured.warnings, "EPUB 内没有可读正文（可能整本都是目录页）"],
      };
    }
    return structured;
  }

  if (text === null || !text.trim()) {
    return {
      title: opts.fileName ? guessTitle(opts.fileName) : undefined,
      chapters: [],
      encoding,
      warnings: [...warnings, "文件内容为空"],
    };
  }

  const novel = splitChapters(text, opts);
  novel.warnings = [...warnings, ...novel.warnings];
  novel.encoding = encoding;

  if (opts.fileName) {
    novel.title = novel.title ?? guessTitle(opts.fileName);
  }

  return novel;
}

export { checkHealth, countWords, decodeBuffer, splitChapters };
export type { ParsedNovel, ImportFormat } from "./types";
export type { SplitOptions } from "./splitter";