/**
 * 共享 JSON 解析器 —— 容错 AI 输出的各种格式问题
 *
 * 所有 API 路由统一使用此函数，不再各写各的。
 * 处理：BOM、markdown 代码块、尾逗号、最外层大括号提取、
 *        字符串内未转义控制字符、未闭合括号补全。
 *
 * v2: 新增字符串内容清理——AI 在 JSON 字符串值里写真实换行符
 *     是 "Expected ',' or '}'" 错误的头号根因。
 */

/**
 * 修复 JSON 字符串值中的未转义控制字符
 *
 * AI 经常在 background/content 等长文本字段中写入真实换行符、
 * tab、或其他控制字符，导致 JSON.parse 失败。
 * 此函数扫描 JSON 字符串，在识别到的字符串字面量内部，
 * 将控制字符替换为转义形式。
 */
function sanitizeStringLiterals(s: string): string {
  const out: string[] = [];
  let i = 0;
  let inString = false;
  let escape = false;

  while (i < s.length) {
    const ch = s[i];

    if (!inString) {
      // 不在字符串内——原样输出
      out.push(ch);
      if (ch === '"' && !escape) {
        inString = true;
      }
      escape = false;
      i++;
      continue;
    }

    // 在字符串内
    if (escape) {
      out.push(ch);
      escape = false;
      i++;
      continue;
    }

    if (ch === '\\') {
      out.push(ch);
      escape = true;
      i++;
      continue;
    }

    if (ch === '"') {
      // 字符串结束
      out.push(ch);
      inString = false;
      i++;
      continue;
    }

    // 字符串内的控制字符 → 转义
    if (ch === '\n') {
      out.push('\\n');
    } else if (ch === '\r') {
      // 跳过 \r，或者转义
      if (i + 1 < s.length && s[i + 1] === '\n') {
        out.push('\\n');
        i++; // 跳过 \r\n 中的 \n
      } else {
        out.push('\\r');
      }
    } else if (ch === '\t') {
      out.push('\\t');
    } else if (ch < ' ' && ch !== '\n' && ch !== '\r' && ch !== '\t') {
      // 其他控制字符 → 移除
    } else {
      out.push(ch);
    }
    i++;
  }

  return out.join('');
}

/**
 * 修复 JSON 中字符串值内的未转义双引号
 *
 * AI 偶尔在字符串值中直接写双引号（如对话内容），
 * 导致字符串提前闭合。典型场景：\"他说：\"你好\"\"
 * 修复策略：在字符串值内部，如果双引号前后有中文字符或常见标点，
 * 将其转义。
 */
function sanitizeUnescapedQuotes(s: string): string {
  // AI 经常在 JSON 字符串值里直接写 ASCII 双引号——
  // 比如 "他说"你好"" 或 "被称为"剑圣""。
  // 这些引号不是 JSON 结构，必须转义，否则 JSON.parse 炸。
  //
  // 策略：在字符串内部遇到未转义的 " 时，看后面跟着什么。
  // 下一个非空白字符是 JSON 结构符（, } ] :）→ 真·字符串结束
  // 否则 → 内容引号，转义为 \"
  const out: string[] = [];
  let i = 0;
  let inString = false;
  let escape = false;

  while (i < s.length) {
    const ch = s[i];

    if (!inString) {
      out.push(ch);
      if (ch === '"' && !escape) inString = true;
      escape = false;
      i++;
      continue;
    }

    if (escape) {
      out.push(ch);
      escape = false;
      i++;
      continue;
    }

    if (ch === '\\') {
      out.push(ch);
      escape = true;
      i++;
      continue;
    }

    if (ch === '"') {
      // 往前看到下一个非空白字符
      let j = i + 1;
      while (j < s.length && (s[j] === ' ' || s[j] === '\t' || s[j] === '\n' || s[j] === '\r')) j++;
      // 末尾也当作结构结束
      if (j >= s.length || s[j] === ',' || s[j] === '}' || s[j] === ']' || s[j] === ':') {
        out.push(ch);
        inString = false;
      } else {
        out.push('\\');
        out.push('"');
      }
      i++;
      continue;
    }

    out.push(ch);
    i++;
  }

  return out.join('');
}

/**
 * 多层容错解析核心：对已经「提取出候选串」的 s 做逐级修复 + 解析。
 *
 * 供 `parseAIJson` 与 `parseAIArray` 共用同一套修复管线，
 * 避免对象解析与数组解析各写一套导致行为漂移。
 *
 * @param s 已剥离 BOM/围栏、已提取最外层括号的候选 JSON 文本
 * @param repairBrackets 是否尝试补未闭合括号
 * @param expectArray 候选是否为数组（决定补括号时补 `]` 还是 `}`）
 * @returns 解析出的对象或数组
 * @throws 全部失败时抛错（带截断原文）
 */
function repairAndParse(s: string, repairBrackets: boolean, expectArray: boolean): unknown {
  // ── 第3层：去尾逗号 ──
  s = s.replace(/,(\s*[}\]])/g, "$1");

  // ── 第4层：标准解析 ──
  try { return JSON.parse(s); } catch { /* 继续 */ }

  // ── 第5层：修复字符串内未转义控制字符 ──
  try {
    let cleaned = sanitizeStringLiterals(s);
    cleaned = sanitizeUnescapedQuotes(cleaned);
    return JSON.parse(cleaned);
  } catch { /* 继续 */ }

  // ── 第6层：修复控制字符 + 去尾逗号 ──
  try {
    let cleaned = sanitizeStringLiterals(s);
    cleaned = sanitizeUnescapedQuotes(cleaned);
    const retried = cleaned.replace(/,(\s*[}\]])/g, "$1");
    return JSON.parse(retried);
  } catch { /* 继续 */ }

  if (!repairBrackets) {
    throw new Error(`JSON解析失败: ${s.slice(0, 200)}`);
  }

  // ── 第7层：修复控制字符 + 未转义引号 + 补未闭合括号 ──
  try {
    let repaired = sanitizeStringLiterals(s);
    repaired = sanitizeUnescapedQuotes(repaired);
    let braces = 0, brackets = 0, inString = false, escape = false;
    for (const ch of repaired) {
      if (escape) { escape = false; continue; }
      if (ch === '\\') { escape = true; continue; }
      if (ch === '"' && !escape) { inString = !inString; continue; }
      if (inString) continue;
      if (ch === '{') braces++;
      else if (ch === '}') braces--;
      else if (ch === '[') brackets++;
      else if (ch === ']') brackets--;
    }
    while (brackets > 0) { repaired += ']'; brackets--; }
    while (braces > 0) { repaired += '}'; braces--; }
    if (repaired.endsWith(',')) repaired = repaired.slice(0, -1);

    return JSON.parse(repaired);
  } catch { /* 继续 */ }

  // ── 全失败 ──
  // 最后一次尝试，拿到 JSON.parse 的真实错误
  try {
    let final = sanitizeStringLiterals(s);
    final = sanitizeUnescapedQuotes(final);
    JSON.parse(final);
  } catch (lastErr) {
    const parseMsg = lastErr instanceof SyntaxError ? lastErr.message : String(lastErr);
    throw new Error(`JSON解析失败: ${parseMsg} —— 原文前200字: ${s.slice(0, 200)}`);
  }
  throw new Error(`JSON解析失败: ${s.slice(0, 200)}`);
}

/**
 * 从 AI 原始响应中提取并解析 JSON
 *
 * 容错层级（逐层加深）：
 *   1. 去 BOM + markdown 代码块 + 提取最外层大括号
 *   2. 去尾逗号 → JSON.parse
 *   3. 失败 → 修复字符串内未转义控制字符 → JSON.parse
 *   4. 失败 → 补未闭合括号 → JSON.parse
 *   5. 全失败 → 抛错（带上下文截断）
 *
 * 注意：本函数对「裸数组」输入（如 `[1,2,3]`）也会返回数组，
 *       调用方若只允许对象应自行断言。
 *
 * @param raw AI 返回的原始文本
 * @param repairBrackets 是否尝试修复未闭合的括号（默认 true）
 * @returns 解析出的对象或数组
 * @throws 解析失败时抛错，带截断原文
 */
export function parseAIJson(raw: string, repairBrackets = true): Record<string, unknown> {
  let s = raw.trim();

  // ── 第0层：BOM ──
  if (s.charCodeAt(0) === 0xFEFF) s = s.slice(1);

  // ── 第1层：去 markdown 代码块 ──
  const md = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (md) s = md[1].trim();

  // ── 第2层：提取最外层大括号 ──
  const a = s.indexOf("{"), b = s.lastIndexOf("}");
  if (a >= 0 && b > a) s = s.slice(a, b + 1);

  // ── 第2.5层：AI 可能输出多个 JSON 对象粘连（如 {"a":1} {"b":2}）
  //     只取第一个完整对象，后面的丢弃
  {
    let braceDepth = 0, inString = false, escape = false, firstEnd = -1;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (escape) { escape = false; continue; }
      if (ch === '\\') { escape = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (ch === '{') braceDepth++;
      else if (ch === '}') {
        braceDepth--;
        if (braceDepth === 0) { firstEnd = i; break; }
      }
    }
    if (firstEnd > 0 && firstEnd < s.length - 1) {
      s = s.slice(0, firstEnd + 1);
    }
  }

  return repairAndParse(s, repairBrackets, false) as Record<string, unknown>;
}

/**
 * 从 AI 原始响应中提取并解析 JSON 数组（与 parseAIJson 共享同一套容错管线）
 *
 * 适用于 AI 直接返回 `[...]` 数组的场景（如事实清单、冲突清单、选项列表）。
 * 对「裸对象」输入（如 `{"a":1}`）会抛错——调用方若想要对象请用 parseAIJson。
 *
 * @param raw AI 返回的原始文本
 * @param repairBrackets 是否尝试修复未闭合的括号（默认 true）
 * @returns 解析出的数组
 * @throws 解析失败或非数组时抛错，带截断原文
 */
export function parseAIArray(raw: string, repairBrackets = true): unknown[] {
  let s = raw.trim();

  // ── 第0层：BOM ──
  if (s.charCodeAt(0) === 0xFEFF) s = s.slice(1);

  // ── 第1层：去 markdown 代码块 ──
  const md = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (md) s = md[1].trim();

  // ── 第2层：提取最外层方括号 ──
  const a = s.indexOf("["), b = s.lastIndexOf("]");
  if (a >= 0 && b > a) s = s.slice(a, b + 1);

  // ── 第2.5层：AI 可能输出多个数组粘连，只取第一个完整数组
  {
    let depth = 0, inString = false, escape = false, firstEnd = -1;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (escape) { escape = false; continue; }
      if (ch === '\\') { escape = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (ch === '[') depth++;
      else if (ch === ']') {
        depth--;
        if (depth === 0) { firstEnd = i; break; }
      }
    }
    if (firstEnd > 0 && firstEnd < s.length - 1) {
      s = s.slice(0, firstEnd + 1);
    }
  }

  const v = repairAndParse(s, repairBrackets, true);
  if (!Array.isArray(v)) {
    throw new Error(`JSON解析失败: 期望数组但解析为对象 —— 原文前200字: ${s.slice(0, 200)}`);
  }
  return v as unknown[];
}

/**
 * 安全解析 AI JSON（不抛错）
 */
export function safeParseAIJson(raw: string): Record<string, unknown> | null {
  try { return parseAIJson(raw); } catch { return null; }
}

/**
 * 安全解析 AI JSON 数组（不抛错）
 */
export function safeParseAIArray(raw: string): unknown[] | null {
  try { return parseAIArray(raw); } catch { return null; }
}
