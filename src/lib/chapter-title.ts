/**
 * 章号工具与「占位章节标题」契约（continue 建章 与 post-processor 自动命名 共用）。
 *
 * 契约：**占位标题 = 纯章号标题**（「第N章/节/卷」，中文或阿拉伯数字，可带「卷一 」类前缀），
 * 不含任何描述文字。
 * - continue 创建新章：只生成占位「第N章」，由 post-processor 在生成完成后用 LLM 短章名回填真实标题；
 * - post-processor 自动命名：仅回填占位标题，绝不覆盖用户自定义标题。
 * 两端共用本模块判定，杜绝「continue 继承旧描述 → 看似有名字 → 自动命名跳过」的契约漂移。
 */

/** 阿拉伯数字 1-999 转中文数字（十/十五/二十三/一百零五） */
export function toCnNumber(n: number): string {
  const d = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
  if (n <= 10) return n === 10 ? "十" : d[n];
  if (n < 20) return `十${d[n % 10]}`;
  if (n < 100) { const t = Math.floor(n / 10), o = n % 10; return `${d[t]}十${o ? d[o] : ""}`; }
  const h = Math.floor(n / 100), rest = n % 100;
  if (rest === 0) return `${d[h]}百`;
  if (rest < 10) return `${d[h]}百零${d[rest]}`;
  return `${d[h]}百${toCnNumber(rest)}`;
}

/** 中文/阿拉伯数字 +1：支持 一~九百九十九 与任意位数阿拉伯数字；无法解析时回退「（续）」 */
export function cnNumberIncrement(s: string): string {
  if (/^\d+$/.test(s)) return String(parseInt(s, 10) + 1);
  const digits: Record<string, number> = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  const units: Record<string, number> = { 十: 10, 百: 100, 千: 1000 };
  let total = 0, current = 0, ok = true;
  for (const ch of s) {
    if (ch in digits) current = digits[ch];
    else if (ch in units) { total += (current || 1) * units[ch]; current = 0; }
    else { ok = false; break; }
  }
  if (!ok) return `${s}（续）`;
  return toCnNumber(total + current + 1);
}

/**
 * continue 创建新章时的标题推导：
 * - 「第三章：xxx」/「第三章」→ 章号 +1 的**纯占位**（「第四章」），描述交由 post-processor 自动命名回填；
 * - 「xxx 2」等数字结尾 → 数字 +1；
 * - 其余 → 「xxx（续）」；
 * - 空标题 → 「第N节」占位（N 为调用方给定的兜底序号）。
 */
export function incrementChapterTitle(title: string, fallbackOrder: number): string {
  if (!title) return `第${fallbackOrder}节`;
  const cnMatch = title.match(/^(.*?第)([零一二三四五六七八九十百千两\d]+)([章节卷])(.*)$/);
  if (cnMatch) {
    // M3 修复：不继承旧章描述（cnMatch[4]），只给纯章号占位——
    // 旧描述与新章内容必然不符，且会让 post-processor 误判为「用户自定义标题」而跳过自动命名。
    // 新占位由 post-processor 的 LLM 短章名（v2.43.0 管线）在生成完成后回填。
    return `${cnMatch[1]}${cnNumberIncrement(cnMatch[2])}${cnMatch[3]}`;
  }
  const match = title.match(/^(.+?)(\d+)$/);
  if (match) return `${match[1]}${parseInt(match[2], 10) + 1}`;
  return `${title}（续）`;
}

/**
 * 占位标题判定（post-processor 自动命名的回填守卫）：
 * 空、或「（卷N ）?第N 章/节/卷」纯章号（中文/阿拉伯数字）→ true；
 * 带描述（「第四章：雨夜追踪」）或用户自定义标题 → false，绝不回填覆盖。
 */
export function isPlaceholderChapterTitle(title: string): boolean {
  const t = String(title ?? "").trim();
  if (!t) return true;
  // M3 修复：旧正则只认阿拉伯「第\d+章」，中文数字占位（「第四章」，continue 建章产物）被误判为
  // 用户自定义标题，自动命名永远跳过。扩认：中文数字 + 卷/册前缀 + 章/节/卷类型。
  return /^(?:[卷册][零一二三四五六七八九十百千两\d]+\s*)?第\s*[零一二三四五六七八九十百千两\d]+\s*[章节卷]$/.test(t);
}

/**
 * 占位标题回填：继承原占位的「前缀 + 数字风格 + 章/节/卷类型」，拼接 LLM 生成的短章名。
 * - 「第四章」+ 4 +「雨夜追踪」→「第四章：雨夜追踪」
 * - 「第4章」+ 4 +「x」→「第4章：x」（阿拉伯风格不突变）
 * - 「卷一 第四章」+ 4 +「x」→「卷一 第四章：x」
 */
export function rebuildChapterTitle(placeholderTitle: string, chapterNumber: number, name: string): string {
  const m = String(placeholderTitle ?? "").trim().match(/^(.*?)第\s*([零一二三四五六七八九十百千两\d]+)\s*([章节卷])$/);
  if (!m) return `第${chapterNumber}章：${name}`;
  const prefix = m[1].trim() ? `${m[1].trim()} ` : "";
  const useCn = !/^\d+$/.test(m[2]);
  const num = useCn ? toCnNumber(chapterNumber) : String(chapterNumber);
  return `${prefix}第${num}${m[3]}：${name}`;
}
