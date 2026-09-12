"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/ui/icons";
import { useFocusTrap } from "@/hooks/use-focus-trap";
import {
  contentStats,
  describeDelta,
  COMPARE_SIDE_LABEL,
  type CompareSide,
} from "@/lib/compare-mode";

interface CompareModeModalProps {
  open: boolean;
  /** 生成前的原有内容 */
  originalContent: string;
  /** 本次生成的新内容 */
  newContent: string;
  /** 场景标签，如「正文生成」「精修」「续写」「游戏模式导出」 */
  modeLabel?: string;
  /** 用户选定要保留的一边；DB 侧已落新内容，选 original 由调用方负责回写还原 */
  onKeep: (side: CompareSide) => void;
  /** 关闭 = 暂不决定（保持当前 DB 状态），由调用方刷新 */
  onClose: () => void;
  /** 保留操作进行中（禁用按钮，防重复提交） */
  busy?: boolean;
}

/**
 * v3.1.133 对比模式（Compare Mode）—— 左右两侧同时观看生成效果，由作者选择保留哪一边。
 *
 * 统一入口：正文生成 / 精修 / 续写 / 游戏模式导出，只要目标章节**已有内容**（非空），
 * 生成完成后都进入本界面，而不是静默覆盖原稿（判据见 @/lib/compare-mode）。
 *
 * 交互：左右两栏均可点击选中（高亮 + 勾选角标），底部两个按钮直接落定要保留的一边；
 * Esc / 关闭 = 暂不决定。左栏只读展示原稿，右栏展示本次生成结果，避免「覆盖了都不知道」。
 */
export function CompareModeModal({
  open,
  originalContent,
  newContent,
  modeLabel,
  onKeep,
  onClose,
  busy = false,
}: CompareModeModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  // 焦点陷阱：Esc 关闭、Tab 在面板内循环，避免键盘焦点逃逸到背后页面
  useFocusTrap(panelRef, open, onClose);
  const [picked, setPicked] = useState<CompareSide | null>(null);

  // 每次打开重置选择，避免上一轮的选中态残留
  useEffect(() => {
    if (open) setPicked(null);
  }, [open]);

  if (!open) return null;

  const oldStats = contentStats(originalContent);
  const newStats = contentStats(newContent);
  const deltaText = describeDelta(originalContent, newContent);

  const sideCard = (side: CompareSide) => {
    const isNew = side === "new";
    const text = isNew ? newContent : originalContent;
    const stats = isNew ? newStats : oldStats;
    const active = picked === side;
    return (
      <div className="flex flex-col min-h-0">
        <button
          type="button"
          onClick={() => setPicked(side)}
          aria-pressed={active}
          aria-label={`选择${COMPARE_SIDE_LABEL[side]}`}
          className={`w-full text-left rounded-t-xl border border-b-0 px-3 py-2 transition-colors ${
            active
              ? "border-[var(--nv-primary)] bg-[var(--nv-primary-soft)]"
              : "border-[var(--nv-border-2)] bg-[var(--nv-surface-1)] hover:bg-[var(--nv-surface-2)]"
          }`}
        >
          <div className="flex items-center gap-1.5">
            <Icon name={isNew ? "sparkles" : "file"} size={12} />
            <span className="text-xs font-semibold text-[var(--nv-text-primary)]">
              {COMPARE_SIDE_LABEL[side]}
            </span>
            <span className="text-[10px] text-[var(--nv-text-tertiary)]">
              {stats.chars} 字 · {stats.paragraphs} 段
            </span>
            {active && (
              <span className="ml-auto inline-flex items-center gap-1 text-[10px] text-[var(--nv-primary)]">
                <Icon name="check" size={12} /> 已选
              </span>
            )}
          </div>
        </button>
        <div
          className={`flex-1 min-h-0 overflow-auto rounded-b-xl border p-3 text-sm leading-relaxed whitespace-pre-wrap transition-colors ${
            active
              ? "border-[var(--nv-primary)] bg-[var(--nv-surface-1)] text-[var(--nv-text-primary)]"
              : "border-[var(--nv-border-2)] bg-[var(--nv-surface-1)] " +
                (isNew ? "text-[var(--nv-text-primary)]" : "text-[var(--nv-text-secondary)]")
          }`}
        >
          {text || "（空）"}
        </div>
      </div>
    );
  };

  const keepBtn = (side: CompareSide, primary: boolean) => (
    <button
      type="button"
      disabled={busy}
      onClick={() => onKeep(side)}
      className={`flex-1 text-sm rounded-xl py-2.5 inline-flex items-center justify-center gap-1.5 font-medium transition-all disabled:opacity-50 ${
        primary
          ? "btn-primary"
          : "border border-[var(--nv-border-2)] text-[var(--nv-text-secondary)] hover:bg-[var(--nv-surface-2)]"
      }`}
    >
      <Icon name={side === "original" ? "refresh" : "check"} size={14} />
      保留{COMPARE_SIDE_LABEL[side]}（{(side === "original" ? oldStats : newStats).chars} 字）
    </button>
  );

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-[var(--nv-void)]/70 p-4 backdrop-blur-sm">
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="左右对比：请选择保留哪一边"
        className="surface-floating w-full max-w-6xl max-h-[88vh] flex flex-col rounded-2xl p-6 animate-spring"
      >
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2">
            <Icon name="scale" size={18} className="text-accent-label" />
            <h2 className="text-lg font-bold tracking-tight">左右对比 · 选择保留哪一边</h2>
            {modeLabel && (
              <span className="text-[10px] px-2 py-0.5 rounded-full border border-[var(--nv-border-2)] text-[var(--nv-text-tertiary)]">
                {modeLabel}
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            disabled={busy}
            className="text-[var(--nv-text-tertiary)] hover:text-[var(--nv-text-primary)] disabled:opacity-50"
            aria-label="关闭"
          >
            <Icon name="x" size={16} />
          </button>
        </div>

        <p className="text-xs text-[var(--nv-text-tertiary)] mb-3">
          该章节已有正文，本次生成结果<strong className="font-semibold text-[var(--nv-text-secondary)]">不会自动覆盖</strong>。原文 {oldStats.chars} 字 → 新生成{" "}
          {newStats.chars} 字（{deltaText}）。点击一栏选中，再点底部按钮确认保留；未保留的一边不会丢失（可在版本历史找回）。
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 flex-1 min-h-0">
          {sideCard("original")}
          {sideCard("new")}
        </div>

        <div className="flex items-center gap-2 pt-4 mt-2 border-t border-[var(--nv-border-2)]">
          {keepBtn("original", picked === "original")}
          {keepBtn("new", picked === "new" || picked === null)}
        </div>
      </div>
    </div>
  );
}
