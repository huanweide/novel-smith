/**
 * 编码嗅探层（Import Novel · M1）
 *
 * 为什么它是「一等公民」而不是工具函数：
 *   国内网文 txt 绝大多数是 GBK / GB18030 编码。用 UTF-8 硬读会满屏「锟斤拷」乱码，
 *   而这个 bug 在浏览器端极难定位（看着像解析错，其实是解码错）。所以先定死解码，
 *   再谈切章节——顺序反了，后面所有识别器都在给乱码打工。
 *
 * 策略（全部零依赖，纯 JS）：
 *   1. 有 BOM → 直接按 BOM 定编码（最权威）
 *   2. 无 BOM → 严格校验 UTF-8；能严格解码就是 UTF-8
 *   3. 严格 UTF-8 失败 → 判 GBK / GB18030 / Big5，用「中文可打印率 + 常见字打分」择优
 *   4. 全程不可靠 → 返回 warnings，让上层提示用户手动指定编码，不静默产出乱码
 *
 * 设计取舍：
 *   - 不用 iconv-lite / chardet：GBK 与 GB18030 的差异（生僻字）对小说分章无实质影响，
 *     Node 内置 Buffer 已能解 GBK；引入外部依赖反而增加 CLI 与浏览器两端不一致的风险。
 *   - 纯函数、零 IO：便于 vitest 固化和在 Worker 里跑。
 */

export type Encoding =
  | "utf-8"
  | "utf-8-bom"
  | "gbk"
  | "gb18030"
  | "big5"
  | "utf-16le"
  | "utf-16be"
  // UTF-32 极少见于小说文件，但 BOM 里确实存在（如某些排版工具导出）
  | "utf-32le"
  | "utf-32be";

export interface DecodeResult {
  text: string;
  encoding: Encoding | null;
  /** 解码可信度：0~1。低置信度由上层决定是否提示用户 */
  confidence: number;
  warnings: string[];
}

/**
 * BOM 签名表：按出现顺序匹配（UTF-32LE 必须排在 UTF-16LE 前，否则前缀误判）
 *
 * 注意 `label` ≠ `enc`：我们对外用可读的 `utf-8-bom` 表达「这份是带 BOM 的 UTF-8」，
 * 但 TextDecoder 只认标准标签（`utf-8`）。直接传 `utf-8-bom` 会抛
 * "The 'utf-8-bom' encoding is not supported"，带 BOM 的 txt 全程导入失败——所以必须映射。
 */
const BOMS: Array<{ bytes: number[]; enc: Encoding; label: string; name: string }> = [
  { bytes: [0x00, 0x00, 0xfe, 0xff], enc: "utf-32be", label: "utf-32be", name: "UTF-32BE" },
  { bytes: [0xff, 0xfe, 0x00, 0x00], enc: "utf-32le", label: "utf-32le", name: "UTF-32LE" },
  { bytes: [0xef, 0xbb, 0xbf], enc: "utf-8-bom", label: "utf-8", name: "UTF-8" },
  { bytes: [0xfe, 0xff], enc: "utf-16be", label: "utf-16be", name: "UTF-16BE" },
  { bytes: [0xff, 0xfe], enc: "utf-16le", label: "utf-16le", name: "UTF-16LE" },
];

/**
 * 可读编码名 → TextDecoder 标准标签。
 * 与 hint 路径共用；找不到映射就交给调用方的 try/catch 回退自动嗅探。
 */
const DECODER_LABEL: Record<string, string> = {
  "utf-8": "utf-8",
  "utf-8-bom": "utf-8",
  "utf-16le": "utf-16le",
  "utf-16be": "utf-16be",
  "utf-32le": "utf-32le",
  "utf-32be": "utf-32be",
  "gbk": "gbk",
  "gb18030": "gb18030",
  "big5": "big5",
};

/** 安全解码：标签不被运行时支持时返回 null 而不是抛异常 */
function safeDecode(buf: Buffer, label: string): string | null {
  try {
    return new TextDecoder(label, { fatal: false }).decode(buf);
  } catch {
    return null;
  }
}

/** 去掉 UTF-8 BOM 字符本身（解码后仍可能残留 U+FEFF） */
export function stripBomChar(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * 严格 UTF-8 校验（Buffer.toString 会把非法字节替换成 U+FFFD，
 * 这会导致「看起来有内容、其实是乱码」的假成功，所以这里手动走 TextDecoder(fatal)）。
 */
function decodeStrictUtf8(buf: Buffer): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    return null;
  }
}

/**
 * 中文可打印率：统计 CJK 统一表意文字 + 中文标点占「非空白字符」的比例。
 * 真实中文小说这个值通常 > 0.3；若解码错（GBK 被当 Big5 读）会骤降甚至为 0。
 */
function cjkRatio(text: string): number {
  let cjk = 0;
  let other = 0;
  for (const ch of text) {
    if (/\s/.test(ch)) continue;
    const code = ch.codePointAt(0)!;
    const isCjk =
      (code >= 0x4e00 && code <= 0x9fff) || // CJK 统一表意
      (code >= 0x3400 && code <= 0x4dbf) || // 扩展 A
      (code >= 0x3000 && code <= 0x303f) || // 中文标点
      (code >= 0xff00 && code <= 0xffef); // 全角字符
    if (isCjk) cjk++;
    else other++;
  }
  const total = cjk + other;
  return total === 0 ? 0 : cjk / total;
}

/**
 * 替换字符（U+FFFD）占比：任何被误解码的字节序列都会产生大量 U+FFFD，
 * 是「解码失败」最直接的信号，比 cjkRatio 更灵敏。
 */
function replacementRatio(text: string): number {
  if (!text.length) return 0;
  let bad = 0;
  // 只采样前 20 万字符：长篇小说几十万字，全量扫描没必要
  const sample = text.length > 200_000 ? text.slice(0, 200_000) : text;
  for (const ch of sample) if (ch === "�") bad++;
  return bad / sample.length;
}

/**
 * 常见中文正文字符打分：命中越多越像真中文。
 * 取样刻意覆盖「小说高频 + 编码歧义区」的字——歧义字是判断 GBK/Big5 的关键证据。
 */
const COMMON_HAN = "的一是了我不人在他有这个上们来到时大地为子中你说生国年着就那和要她出也得里后自以会家可下而过天去能对小多然于心学么之都好看起发当没成只如事把还用第样道想作种开美总从无情己面最女但现前些所同日手又行意动方期它头经长儿回位分爱老因很给名法间斯知世什两次使身者被高已亲其进此话常与活正感";
const AMBIGUOUS_HAN = "什么么说这那他她它我们你们天地人上下中大小来去后前时年生气 waterspace什";

function commonHanScore(text: string): number {
  const sample = text.length > 50_000 ? text.slice(0, 50_000) : text;
  let hit = 0;
  for (const ch of sample) {
    if (COMMON_HAN.includes(ch)) hit++;
  }
  const total = sample.replace(/\s/g, "").length || 1;
  return hit / total;
}

/**
 * 在候选编码里逐个解码并打分，选最高分。
 * @param candidates 需要尝试的编码列表
 */
function pickBest(
  buf: Buffer,
  candidates: Encoding[],
): { text: string; encoding: Encoding; score: number } {
  let best = { text: "", encoding: candidates[0]!, score: -1 };
  for (const enc of candidates) {
    const label = DECODER_LABEL[enc] ?? enc;
    const text = safeDecode(buf, label);
    if (text === null) continue; // 运行时不支持该标签（如 utf-32），跳过
    const repl = replacementRatio(text);
    const cjk = cjkRatio(text);
    const common = commonHanScore(text);
    // 惩罚 U+FFFD，奖励 CJK 率与常用字密度
    const score = cjk * 2 + common * 1.5 - repl * 10;
    if (score > best.score) best = { text, encoding: enc, score };
  }
  return best;
}

/**
 * 主入口：把原始字节解码成文本。
 *
 * @param buf 文件原始字节
 * @param hint 用户指定的编码（来自 UI/CLI 的下拉选择），给了就优先用它
 */
export function decodeBuffer(buf: Buffer, hint?: Encoding | string): DecodeResult {
  const warnings: string[] = [];

  if (!buf.length) {
    return { text: "", encoding: "utf-8", confidence: 1, warnings: ["文件为空"] };
  }

  // 1) BOM 优先——有 BOM 就是最权威的信号，不做任何猜测
  for (const bom of BOMS) {
    if (bom.bytes.every((b, i) => buf[i] === b)) {
      const raw = safeDecode(buf, bom.label);
      if (raw === null) {
        // 运行时不支持该标签（如 Node 无 full-icu 时缺 utf-32）→ 不硬撑，继续往下嗅探
        warnings.push(`检测到 ${bom.name} BOM，但当前运行时不支持该编码，已回退自动嗅探`);
        continue;
      }
      return {
        text: stripBomChar(raw),
        encoding: bom.enc,
        confidence: 1,
        warnings: [`检测到 ${bom.name} BOM`],
      };
    }
  }

  // 2) 用户指定优先
  if (hint) {
    const h = hint.toLowerCase().replace(/[-_]/g, "") as Encoding;
    const label = DECODER_LABEL[h] ?? h;
    const decoded = safeDecode(buf, label);
    if (decoded !== null) {
      const repl = replacementRatio(decoded);
      if (repl < 0.001) {
        return {
          text: stripBomChar(decoded),
          encoding: h,
          confidence: 0.9,
          warnings: [`按用户指定编码 ${hint} 解码`],
        };
      }
      warnings.push(`按 ${hint} 解码但出现大量乱码（${(repl * 100).toFixed(1)}%），可能选错`);
      return { text: stripBomChar(decoded), encoding: h, confidence: 0.4, warnings };
    }
    warnings.push(`不支持的编码 ${hint}，已回退自动嗅探`);
  }

  // 3) 严格 UTF-8 ——能严格解码就一定是 UTF-8，不需要再猜
  const utf8 = decodeStrictUtf8(buf);
  if (utf8 !== null) {
    return {
      text: stripBomChar(utf8),
      encoding: "utf-8",
      confidence: 0.98,
      warnings: [],
    };
  }

  // 4) 严格 UTF-8 失败 → 双字节中文编码里择优
  const best = pickBest(buf, ["gb18030", "gbk", "big5"]);
  const repl = replacementRatio(best.text);
  const cjk = cjkRatio(best.text);

  let confidence = 0.5;
  if (repl < 0.001 && cjk > 0.3) confidence = 0.85;
  if (repl > 0.01 || cjk < 0.1) {
    confidence = 0.2;
    warnings.push(
      `解码置信度低（可能是 ${best.encoding}，但只有 ${(cjk * 100).toFixed(0)}% 中文、${(repl * 100).toFixed(1)}% 乱码）`,
    );
    warnings.push("建议手动指定编码后重试，否则分章结果不可信");
  }

  return {
    text: stripBomChar(best.text),
    encoding: best.encoding,
    confidence,
    warnings,
  };
}

/** 直接从字符串推断是否像乱码（给已有 string 的场景用，如 FileReader 结果） */
export function looksMojibake(text: string): boolean {
  return replacementRatio(text) > 0.01 || cjkRatio(text) < 0.05;
}

export const __testing = { cjkRatio, replacementRatio, commonHanScore, AMBIGUOUS_HAN };