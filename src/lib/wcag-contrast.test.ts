/**
 * 虚空玻璃多主题 · WCAG AA 对比度永久回归守卫
 *
 * 背景：本站 surface-* 令牌是**半透明 rgba**（叠加在页面底色之上），
 * jsdom 没有真实布局，axe 的 color-contrast 规则拿不到合成后的背景色，
 * 只能标 incomplete（既不通过也不违规）。所以对比度这一层**必须手工精算**，
 * 并把结果固化成测试，防止以后改色悄悄回退。
 *
 * 设计契约（本次确认并固化）：
 *   1. primary / secondary / tertiary 三级主文字：落在**任何**表面都要 ≥ 4.5:1
 *   2. muted（最弱一级）：页面底 / 容器面必须 ≥ 4.5:1
 *   3. 备了专用变体 muted-on-surface-3 的主题：该变体在浮起面必须 ≥ 4.5:1
 *   4. **没有**该变体兜底的主题（阅读器夜间/纸感）：muted 必须自己在所有表面达标
 *   5. 层级不倒挂：primary > secondary > tertiary > muted（同一表面上一目了然）
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import {
  collectThemeBlocks,
  surfacesOf,
  textColorOf,
  contrastRatio,
  worstContrast,
  AA_NORMAL,
  type Surface,
  type ThemeBlock,
} from "./wcag-contrast";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CSS = readFileSync(path.resolve(__dirname, "../app/globals.css"), "utf8");
const THEMES: ThemeBlock[] = collectThemeBlocks(CSS);

const MAIN_LEVELS = ["primary", "secondary", "tertiary"] as const;
const VARIANT_TOKEN = "muted-on-surface-3";

describe("虚空玻璃主题 · WCAG AA 对比度永久回归", () => {
  it("能从 globals.css 解析出全部十三套主题（防止解析逻辑被改坏却静默通过）", () => {
    expect(THEMES).toHaveLength(13);
    expect(THEMES.map((t) => t.selector).sort()).toEqual(
      [
        ":root",
        ".light",
        ".reader-theme-night",
        ".reader-theme-sepia",
        '[data-game-theme="day"]',
        "html.azure",
        "html.theme-github",
        "html.theme-dracula",
        "html.theme-nord",
        "html.theme-tokyo",
        "html.theme-gruvbox",
        "html.theme-solarized",
        "html.theme-catppuccin",
      ].sort()
    );
  });

  describe.each(THEMES.map((theme) => ({ theme, selector: theme.selector })))(
    "主题 $selector",
    ({ theme }) => {
      const surfaces = surfacesOf(theme);

      it("三类表面都被正确解析", () => {
        expect(surfaces.map((s: Surface) => s.name)).toEqual(["void", "abyss", "surface-3"]);
      });

      it.each(MAIN_LEVELS)("主文字 %s 落在任何表面都 ≥ 4.5:1", (level) => {
        const fg = textColorOf(theme, level);
        expect(fg, `${level} 应为可解析的 hex 色`).not.toBeNull();
        const worst = worstContrast(fg!, surfaces);
        expect(
          worst.value,
          `${level} 在 ${worst.surface} 上仅 ${worst.value.toFixed(2)}:1（未达 WCAG AA）`
        ).toBeGreaterThanOrEqual(AA_NORMAL);
      });

      it("muted 落在页面底 / 容器面 ≥ 4.5:1", () => {
        const fg = textColorOf(theme, "muted");
        expect(fg, "muted 应为可解析的 hex 色").not.toBeNull();
        const basics = surfaces.filter((s: Surface) => s.name !== "surface-3");
        const worst = worstContrast(fg!, basics);
        expect(
          worst.value,
          `muted 在 ${worst.surface} 上仅 ${worst.value.toFixed(2)}:1（未达 WCAG AA）`
        ).toBeGreaterThanOrEqual(AA_NORMAL);
      });

      const hasVariant = Boolean(theme.vars[`--nv-text-${VARIANT_TOKEN}`]);

      if (hasVariant) {
        it("专用变体 muted-on-surface-3 落在浮起面 ≥ 4.5:1", () => {
          const fg = textColorOf(theme, VARIANT_TOKEN);
          expect(fg).not.toBeNull();
          const s3 = surfaces.find((s: Surface) => s.name === "surface-3")!;
          const v = contrastRatio(fg!, s3.rgb);
          expect(v, `muted-on-surface-3 在浮起面上仅 ${v.toFixed(2)}:1`).toBeGreaterThanOrEqual(AA_NORMAL);
        });
      } else {
        it("无兜底变体 → muted 必须自己在所有表面（含浮起面）达标 ≥ 4.5:1", () => {
          const fg = textColorOf(theme, "muted");
          expect(fg).not.toBeNull();
          const worst = worstContrast(fg!, surfaces);
          expect(
            worst.value,
            `muted 在 ${worst.surface} 上仅 ${worst.value.toFixed(2)}:1——本主题没有 ${VARIANT_TOKEN} 兜底，必须自身达标`
          ).toBeGreaterThanOrEqual(AA_NORMAL);
        });
      }

      it("层级不倒挂：primary > secondary > tertiary > muted", () => {
        const base = surfaces[0]!.rgb;
        const seq = [...MAIN_LEVELS, "muted"].map((lv) => ({
          lv,
          v: contrastRatio(textColorOf(theme, lv)!, base),
        }));
        for (let i = 1; i < seq.length; i++) {
          expect(
            seq[i]!.v,
            `${seq[i]!.lv}(${seq[i]!.v.toFixed(2)}) 应弱于 ${seq[i - 1]!.lv}(${seq[i - 1]!.v.toFixed(2)})，层级倒挂`
          ).toBeLessThan(seq[i - 1]!.v);
        }
      });
    }
  );
});
