/**
 * 选中即改悬浮工具条定位计算（纯函数，便于单测与复用）
 *
 * 问题：工具条默认用 `-translate-y-full` 渲染在选区「上方」，且 left 取选区中心点；
 * 当选区贴近视口顶边时，工具条会被顶出屏幕（用户选中却看不到）；选区贴左右边缘时
 * 工具条会溢出屏幕外。这里统一收敛定位逻辑：
 *   - left 夹取到 [120, viewportWidth-120]，避免贴边溢出；
 *   - top <= 56 时改放到选区「下方」（去掉 -translate-y-full），保证始终可见。
 */

export interface SelRect {
  top: number;
  bottom: number;
  left: number;
  width: number;
}

export interface SelToolbarPlacement {
  top: number;
  left: number;
  placeAbove: boolean;
}

export function computeSelToolbarPlacement(rect: SelRect, viewportWidth: number): SelToolbarPlacement {
  const centerX = rect.left + rect.width / 2;
  // 横向夹取：工具条约 230px 宽，半宽约 115px，留 5px 余量取 120 作安全边距
  const clampedLeft = Math.max(120, Math.min(viewportWidth - 120, centerX));
  // 选区顶边距视口顶不足 56px（工具条高≈36 + 间距）→ 翻到选区下方，避免被顶出屏幕
  const placeAbove = rect.top > 56;
  return {
    top: placeAbove ? rect.top - 8 : rect.bottom + 8,
    left: clampedLeft,
    placeAbove,
  };
}
