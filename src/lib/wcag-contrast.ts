/**
 * WCAG 对比度计算工具 —— 纯函数、零依赖
 *
 * 用途：给「虚空玻璃」多主题设计令牌做 WCAG AA 合规校验。
 *
 * 为什么不用 axe 自动算：本项目所有 surface-* 令牌都是**半透明 rgba**（叠加在页面底色之上），
 * 而 jsdom 无真实布局、拿不到合成后的实际背景色，axe 的 color-contrast 规则会直接
 * 标 incomplete（既不算通过也不算违规）。因此这里改走「解析 CSS 变量 + 手工合成 + 精确计算」，
 * 结果反而比浏览器更可控（排除了阴影/叠层的干扰），也没放进 browser 依赖。
 *
 * 合成约定：页面底（--nv-void / --nv-surface）→ 容器底（--nv-abyss / --nv-surface-2）
 * → 浮起面（--nv-surface-3）。半透明面按 alpha 混合叠加到页面底上得到实际 RGB。
 */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export interface Rgba extends Rgb {
  a: number;
}

export interface Surface {
  /** 表面语义名：void=页面底 / abyss=容器底 / surface-3=浮起面 */
  name: string;
  rgb: Rgb;
}

export interface ThemeBlock {
  /** CSS 选择器，如 ":root" / ".light" / "[data-game-theme='day']" */
  selector: string;
  /** 该块内的 CSS 自定义属性：键为 "--nv-text-primary"，值为原始色彩串 */
  vars: Record<string, string>;
}

/** WCAG 2.1 AA：普通正文最低对比度 */
export const AA_NORMAL = 4.5;
/** WCAG 2.1 AA：大字号（≥18.66px 且加粗，或 ≥24px）最低对比度 */
export const AA_LARGE = 3;

/** 解析十六进制色（#abc / #abc123 均支持） */
export function parseHex(value: string): Rgb | null {
  const h = value.trim().replace(/^#/, "");
  if (/^[0-9a-fA-F]{3}$/.test(h)) {
    return { r: parseInt(h[0] + h[0], 16), g: parseInt(h[1] + h[1], 16), b: parseInt(h[2] + h[2], 16) };
  }
  if (/^[0-9a-fA-F]{6}$/.test(h)) {
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
    };
  }
  return null;
}

/** 解析 rgb()/rgba()，含 alpha */
export function parseRgba(value: string): Rgba | null {
  const m = value.match(/rgba?\(\s*([^)]+?)\s*\)/i);
  if (!m) return null;
  const parts = m[1].split(",").map((x) => parseFloat(x.trim()));
  if (parts.length < 3 || parts.some((n) => Number.isNaN(n))) return null;
  return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
}

/** 把任意色彩串解析成 {r,g,b,a}（不支持的 OKLCH 等返回 null） */
export function toRgba(value: string | undefined): Rgba | null {
  if (!value) return null;
  const v = value.trim();
  if (v.startsWith("#")) {
    const rgb = parseHex(v);
    return rgb ? { ...rgb, a: 1 } : null;
  }
  return parseRgba(v);
}

/** 只取不透明色（面板/文字用）；半透明返回 null */
export function toOpaqueRgb(value: string | undefined): Rgb | null {
  const c = toRgba(value);
  return c && c.a === 1 ? { r: c.r, g: c.g, b: c.b } : null;
}

/** 相对亮度（WCAG 2.1 定义） */
export function relativeLuminance(rgb: Rgb): number {
  const chan = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * chan(rgb.r) + 0.7152 * chan(rgb.g) + 0.0722 * chan(rgb.b);
}

/** 两色对比度比值（1~21，越大越清晰） */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

/** 半透明前景色叠加到不透明背景色之上，得到实际呈现色（alpha 混合） */
export function compositeOver(fg: Rgba, bg: Rgb): Rgb {
  const mix = (f: number, b: number) => Math.round(f * fg.a + b * (1 - fg.a));
  return { r: mix(fg.r, bg.r), g: mix(fg.g, bg.g), b: mix(fg.b, bg.b) };
}

/**
 * 解析 CSS 里所有「定义了 --nv-text-primary 的块」＝一套主题。
 * 用花括号栈做简单状态机，能自然穿透 @media 等嵌套包裹。
 */
export function collectThemeBlocks(css: string): ThemeBlock[] {
  const lines = css.split(/\r?\n/);
  const stack: ThemeBlock[] = [];
  const out: ThemeBlock[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (line.includes("{") && !trimmed.startsWith("--") && !trimmed.startsWith("/*")) {
      stack.push({ selector: line.slice(0, line.indexOf("{")).trim(), vars: {} });
    }
    if (stack.length) {
      const m = line.match(/(--nv-[a-z0-9-]+)\s*:\s*([^;]+);/);
      if (m) stack[stack.length - 1].vars[m[1]] = m[2].trim();
    }
    if (trimmed === "}" || (line.includes("}") && trimmed.endsWith("}"))) {
      if (stack.length) out.push(stack.pop() as ThemeBlock);
    }
  }

  return out.filter((b) => b.vars["--nv-text-primary"]);
}

/**
 * 取一套主题的三类关键表面，按「由深到浅 / 由底到浮」的层级排好。
 * 半透明的 surface-3 会被合成到页面底上，得到真实呈现色。
 */
export function surfacesOf(theme: ThemeBlock): Surface[] {
  const pageBottom = toOpaqueRgb(theme.vars["--nv-void"] ?? theme.vars["--nv-surface"]);
  const container = toOpaqueRgb(theme.vars["--nv-abyss"] ?? theme.vars["--nv-surface-2"]);
  if (!pageBottom || !container) return [];

  const rawS3 = toRgba(theme.vars["--nv-surface-3"]);
  let floating: Rgb;
  if (!rawS3) floating = container;
  else if (rawS3.a < 1) floating = compositeOver(rawS3, pageBottom);
  else floating = { r: rawS3.r, g: rawS3.g, b: rawS3.b };

  return [
    { name: "void", rgb: pageBottom },
    { name: "abyss", rgb: container },
    { name: "surface-3", rgb: floating },
  ];
}

/** 取某主题某个文字级令牌的实际 RGB（不支持的色空间返回 null） */
export function textColorOf(theme: ThemeBlock, level: string): Rgb | null {
  return toOpaqueRgb(theme.vars[`--nv-text-${level}`]);
}

/** 某文字级在三类表面上的最低对比度（用于「是否处处达标」的判断） */
export function worstContrast(fg: Rgb, surfaces: Surface[]): { value: number; surface: string } {
  let worst = { value: Number.POSITIVE_INFINITY, surface: surfaces[0]?.name ?? "" };
  for (const s of surfaces) {
    const v = contrastRatio(fg, s.rgb);
    if (v < worst.value) worst = { value: v, surface: s.name };
  }
  return worst;
}
