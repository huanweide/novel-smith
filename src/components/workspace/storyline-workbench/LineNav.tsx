/**
 * 故事线工作台：左侧单条故事线导航（原 StorylineWorkbench.tsx 私有组件 LineNav）
 */

import { Icon } from "@/components/ui/icons";
import { computeStorylineProgress } from "@/lib/storyline-progress";
import type { StorylineData } from "../StorylineList";

export function LineNav({
  s,
  selected,
  onSelect,
  onToggle,
  collapsible,
  collapsed,
  childCount,
  onToggleCollapse,
}: {
  s: StorylineData;
  selected: boolean;
  onSelect: () => void;
  onToggle: () => void;
  collapsible?: boolean;
  collapsed?: boolean;
  childCount?: number;
  onToggleCollapse?: () => void;
}) {
  const p = computeStorylineProgress(s);
  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={`${s.title}${selected ? "，已选中" : ""}`}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      className={`group w-full cursor-pointer rounded-lg border px-2.5 py-2 text-left transition-colors ${
        selected
          ? "border-[var(--nv-accent)]/50 bg-[var(--nv-accent-soft)]"
          : "border-transparent hover:bg-[var(--nv-surface-2)]"
      }`}
    >
      <div className="flex items-center gap-1.5">
        <Icon
          name={s.type === "main" ? "star" : s.type === "thread" ? "link" : "gitBranch"}
          size={13}
          className={s.type === "main" ? "text-[var(--nv-accent)]" : s.type === "thread" ? "text-[var(--nv-info)]" : "text-[var(--nv-text-tertiary)]"}
        />
        <span
          className={`flex-1 line-clamp-2 text-xs ${
            selected
              ? "font-medium text-[var(--nv-accent)]"
              : s.type === "main"
                ? "font-semibold text-[var(--nv-text-primary)]"
                : "font-normal text-[var(--nv-text-secondary)]"
          }`}
        >
          {s.title}
          {collapsible && collapsed && childCount ? (
            <span className="ml-1 text-[9px] text-[var(--nv-text-tertiary)]">({childCount})</span>
          ) : null}
        </span>
        {s.status === "completed" && (
          <span className="rounded bg-[var(--nv-success)]/15 px-1 text-[9px] text-[var(--nv-success)]">
            完结
          </span>
        )}
        {collapsible && (
          <button
            type="button"
            aria-label={collapsed ? "展开支线" : "收起支线"}
            onClick={(e) => {
              e.stopPropagation();
              onToggleCollapse?.();
            }}
            className="shrink-0 rounded-full p-0.5 text-[var(--nv-text-tertiary)] transition-colors hover:text-[var(--nv-accent)]"
            title={collapsed ? "展开支线" : "收起支线"}
          >
            <Icon name={collapsed ? "chevronRight" : "chevronDown"} size={13} />
          </button>
        )}
        <button
          type="button"
          aria-label={s.status === "completed" ? "取消完结" : "标记完结"}
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
          className="shrink-0 rounded-full text-[var(--nv-text-tertiary)] transition-colors hover:text-[var(--nv-accent)] focus-visible:ring-2 focus-visible:ring-ring/50"
          title="标记完结"
        >
          {s.status === "completed" ? (
            <Icon name="check" size={12} className="text-[var(--nv-success)]" />
          ) : (
            <Icon name="circle" size={12} />
          )}
        </button>
      </div>
      <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-[var(--nv-surface-2)]">
        <div
          className="h-full rounded-full"
          style={{
            width: `${p.overallPercent}%`,
            background: s.type === "main" ? "var(--nv-accent)" : "var(--nv-primary)",
          }}
        />
      </div>
    </div>
  );
}
