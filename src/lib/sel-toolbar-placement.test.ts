/**
 * 选中即改悬浮工具条定位单测（D1 贴边修复）
 *
 * 复现此前缺陷：工具条默认用 -translate-y-full 渲染在选区「上方」，
 * 选区贴近视口顶边时会被顶出屏幕（用户选中却看不到工具条）；选区贴左右边缘时溢出。
 * 本测试证明：near-top 选区翻到下方、左右边缘被夹取进视口，工具条始终可见。
 */
import { describe, it, expect } from "vitest";
import { computeSelToolbarPlacement } from "@/lib/sel-toolbar-placement";

describe("computeSelToolbarPlacement（选中即改 工具条定位）", () => {
  it("选区在视口中部：工具条置于选区上方（placeAbove=true, top<选区top）", () => {
    const p = computeSelToolbarPlacement({ top: 300, bottom: 320, left: 200, width: 100 }, 1280);
    expect(p.placeAbove).toBe(true);
    expect(p.top).toBe(300 - 8);
    expect(p.left).toBe(250); // 200 + 100/2
  });

  it("选区贴近视口顶边（top<=56）：翻到选区下方，top=选区bottom+8（不再被顶出屏幕）", () => {
    const p = computeSelToolbarPlacement({ top: 20, bottom: 40, left: 300, width: 80 }, 1280);
    expect(p.placeAbove).toBe(false);
    expect(p.top).toBe(40 + 8);
    expect(p.top).toBeGreaterThan(0); // 关键：不再为负 / 出屏
  });

  it("选区恰在阈值 56：仍翻到下方（严格小于等于阈值为下方）", () => {
    const p = computeSelToolbarPlacement({ top: 56, bottom: 76, left: 300, width: 80 }, 1280);
    expect(p.placeAbove).toBe(false);
    expect(p.top).toBe(76 + 8);
  });

  it("选区贴近左边缘：left 被夹取到安全边距 120 以内", () => {
    const p = computeSelToolbarPlacement({ top: 300, bottom: 320, left: 0, width: 30 }, 1280);
    expect(p.left).toBeGreaterThanOrEqual(120);
    expect(p.left).toBe(120);
  });

  it("选区贴近右边缘：left 被夹取到 viewportWidth-120 以内", () => {
    const p = computeSelToolbarPlacement({ top: 300, bottom: 320, left: 1270, width: 30 }, 1280);
    expect(p.left).toBeLessThanOrEqual(1280 - 120);
    expect(p.left).toBe(1280 - 120);
  });

  it("窄视口下仍不溢出：left 被夹取到 [120, vw-120]", () => {
    const p = computeSelToolbarPlacement({ top: 300, bottom: 320, left: 5, width: 10 }, 320);
    expect(p.left).toBe(120); // max(120, min(200, 10)) = 120
  });
});
