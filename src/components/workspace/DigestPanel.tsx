"use client";
import { describeHttpError } from "@/lib/stream-error";

import { useState } from "react";
import { useProjectStore } from "@/store";
import { Icon, type IconName } from "@/components/ui/icons";
import type { StoryNodeData } from "./types";

/**
 * 全局总览面板（v1.8.23 摘要大纲 → 用户可控升级）
 *
 * 三块「被 AI 长期记忆读取」的全局内容，全部支持手动编辑：
 *  - 主线总纲（synopsis）：作品骨架，写入全局系统提示词
 *  - 时间线摘要大纲（timelineDigest）：按章序聚合"此前各章发生了什么"
 *  - 故事线摘要大纲（storylineDigest）：主线大事件聚合"什么故事线在推进"
 *
 * 用户改了总览 = 直接改写 AI 下一章的上下文记忆——这是"让 AI 串联整个故事不出现矛盾"
 * 的用户级操控入口：发现 AI 记错/偏航，直接把正确的事实写回总览即可纠正。
 * 「重新生成」会用各章摘要重建两个 digest（会覆盖手动编辑，总纲不受影响）。
 */

type DigestField = "synopsis" | "timelineDigest" | "storylineDigest";

export function DigestPanel({
  projectId,
  onRefresh,
  selectedNode,
  onSummarizeCurrent,
  summarizing,
}: {
  projectId: string;
  onRefresh: () => void;
  selectedNode?: StoryNodeData | null;
  onSummarizeCurrent?: () => void;
  summarizing?: boolean;
}) {
  const project = useProjectStore((s) => s.project);
  const patchProject = useProjectStore((s) => s.patchProject);
  const [rebuilding, setRebuilding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 编辑态：editing === null 时全部只读；否则记录正在编辑的字段与草稿
  const [editing, setEditing] = useState<DigestField | null>(null);
  const [draft, setDraft] = useState("");
  const [savingField, setSavingField] = useState<DigestField | null>(null);

  const synopsis = project?.synopsis?.trim() || "";
  const timelineDigest = project?.timelineDigest?.trim() || "";
  const storylineDigest = project?.storylineDigest?.trim() || "";
  const digestEmpty = !timelineDigest && !storylineDigest;

  const startEdit = (field: DigestField, current: string) => {
    setEditing(field);
    setDraft(current);
    setError(null);
  };

  const cancelEdit = () => {
    setEditing(null);
    setDraft("");
  };

  const saveEdit = async (field: DigestField) => {
    setSavingField(field);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: draft }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({ error: "未知错误" }));
        { const _f = describeHttpError(res.status, d); throw new Error(_f.description); }
      }
      // 就地更新 store，面板立刻显示新内容（synopsis 变更由 onRefresh 兜底同步 globalPrompt 渲染源）
      patchProject({ [field]: draft } as never);
      if (field === "synopsis") onRefresh();
      setEditing(null);
      setDraft("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSavingField(null);
    }
  };

  const handleRebuild = async () => {
    setRebuilding(true);
    setError(null);
    try {
      const res = await fetch("/api/generate/digest/rebuild", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({ error: "未知错误" }));
        { const _f = describeHttpError(res.status, d); throw new Error(_f.description); }
      }
      onRefresh(); // 刷新 store，panel 自动显示新大纲
    } catch (e) {
      setError(e instanceof Error ? e.message : "重建失败");
    } finally {
      setRebuilding(false);
    }
  };

  const renderEditableSection = (
    field: DigestField,
    title: string,
    icon: IconName,
    current: string,
    hint: string,
    placeholder: string,
  ) => {
    const isEditing = editing === field;
    return (
      <section className="mx-1 bg-[var(--nv-surface-2)] rounded-lg p-3">
        <div className="flex items-center justify-between mb-1.5">
          <h4 className="text-[11px] font-semibold text-[var(--nv-text-secondary)] flex items-center gap-1">
            <Icon name={icon} size={12} /> {title}
          </h4>
          {!isEditing && (
            <button
              onClick={() => startEdit(field, project?.[field] ?? "")}
              className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-md border border-transparent text-[var(--nv-text-tertiary)] hover:text-[var(--nv-text-primary)] hover:border-[var(--nv-border-3)] transition-colors"
              title={`手动编辑${title}——AI 写下一章时会读取你写的内容`}
            >
              <Icon name="pencil" size={11} /> 编辑
            </button>
          )}
        </div>
        {isEditing ? (
          <div>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={Math.min(14, Math.max(4, draft.split("\n").length + 2))}
              placeholder={placeholder}
              aria-label={`编辑${title}`}
              className="w-full text-[12px] leading-relaxed rounded-md border border-[var(--nv-border-2)] bg-[var(--nv-surface-1)] text-[var(--nv-text-primary)] px-2.5 py-2 focus:outline-none focus:border-[var(--nv-primary)] resize-y"
            />
            <div className="flex items-center gap-2 mt-1.5">
              <button
                onClick={() => saveEdit(field)}
                disabled={savingField === field}
                className="flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-md bg-[var(--nv-primary)] text-white disabled:opacity-50"
              >
                {savingField === field ? <Icon name="loader" size={11} className="animate-spin" /> : <Icon name="check" size={11} />}
                {savingField === field ? "保存中…" : "保存"}
              </button>
              <button
                onClick={cancelEdit}
                disabled={savingField === field}
                className="text-[11px] px-2.5 py-1 rounded-md border border-[var(--nv-border-2)] text-[var(--nv-text-secondary)] hover:border-[var(--nv-border-3)] disabled:opacity-50"
              >
                取消
              </button>
              <span className="text-[10px] text-[var(--nv-text-tertiary)]">
                {hint}
              </span>
            </div>
          </div>
        ) : current ? (
          <p className="text-[12px] text-[var(--nv-text-primary)] leading-relaxed whitespace-pre-line">
            {current}
          </p>
        ) : (
          <p className="text-[11px] text-[var(--nv-text-tertiary)] leading-relaxed">
            尚无内容。点击「编辑」亲手写下{title}——AI 写每一章都会读取它。
          </p>
        )}
      </section>
    );
  };

  return (
    <div className="flex flex-col gap-3 p-1">
      <div className="flex items-center justify-between px-1">
        <span className="text-[11px] text-[var(--nv-text-tertiary)]">
          总纲 + 时间线 / 故事线摘要（被写作 / 章纲读取，可手动编辑纠偏）
        </span>
        <button
          onClick={handleRebuild}
          disabled={rebuilding}
          className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-md border border-[var(--nv-border-2)] text-[var(--nv-text-secondary)] hover:text-[var(--nv-text-primary)] hover:border-[var(--nv-border-3)] transition-colors disabled:opacity-50"
          title="基于现有各章摘要与主线事件重新生成两个摘要大纲（会覆盖手动编辑的总纲内容；主线总纲不受影响）"
        >
          <Icon name="refresh" size={12} className={rebuilding ? "animate-spin" : ""} />
          {rebuilding ? "生成中…" : "重新生成"}
        </button>
      </div>

      {error && (
        <div className="mx-1 text-[11px] text-[var(--nv-danger)] bg-[var(--nv-danger)]/10 rounded-md px-2 py-1.5">
          {error}
        </div>
      )}

      {renderEditableSection(
        "synopsis",
        "主线总纲",
        "pin",
        synopsis,
        "保存后写入作品骨架，全局提示词随之刷新",
        "整本书的主线走向、核心冲突与结局方向。AI 生成每一章都会参考。",
      )}

      {digestEmpty && !synopsis && (
        <div className="mx-1 text-[12px] text-[var(--nv-text-tertiary)] leading-relaxed bg-[var(--nv-surface-2)] rounded-lg px-3 py-4">
          尚无摘要大纲。写完至少一个章节（或点击「重新生成」）后，系统会自动把各章摘要与时间线 / 主线大事件聚合成精简大纲，并在你写下一章、写章纲时作为长期记忆注入。你也可以直接手动编辑上面三块内容。
        </div>
      )}

      {renderEditableSection(
        "timelineDigest",
        "时间线摘要大纲",
        "history",
        timelineDigest,
        "AI 写下一章 / 章纲时把这段作为「此前发生了什么」注入",
        "按章节顺序写下已发生的关键事实：谁做了什么、世界状态变化。发现 AI 记错剧情时，把正确事实写回这里。",
      )}

      {renderEditableSection(
        "storylineDigest",
        "故事线摘要大纲",
        "bookmarked",
        storylineDigest,
        "AI 写下一章 / 章纲时把这段作为主线推进方向注入",
        "主线大事件与各故事线的推进状态：哪条线推进到哪、伏笔挂在哪、下一幕该收/放哪条线。",
      )}

      {/* #291：当前章摘要入口（原顶栏「摘要」按钮能力迁移至此，统一摘要枢纽） */}
      <section className="mx-1 bg-[var(--nv-surface-2)] rounded-lg p-3 border border-[var(--nv-border-2)]">
        <h4 className="text-[11px] font-semibold text-[var(--nv-text-secondary)] mb-1.5 flex items-center gap-1">
          <Icon name="package" size={12} /> 当前章摘要
        </h4>
        {selectedNode ? (
          <>
            <p className="text-[12px] text-[var(--nv-text-primary)] leading-relaxed mb-2 truncate">
              《{selectedNode.title || "未命名章节"}》
            </p>
            <button
              onClick={onSummarizeCurrent}
              disabled={summarizing || !selectedNode.content}
              className="flex items-center gap-1 text-[11px] px-2.5 py-1.5 rounded-md border border-[var(--nv-border-2)] text-[var(--nv-text-secondary)] hover:text-[var(--nv-text-primary)] hover:border-[var(--nv-border-3)] transition-colors disabled:opacity-50"
            >
              {summarizing ? <Icon name="loader" size={12} className="animate-spin" /> : <Icon name="refresh" size={12} />}
              {summarizing ? "生成中…" : (selectedNode.content ? "重新生成本章摘要" : "本章暂无正文")}
            </button>
            <p className="text-[10px] text-[var(--nv-text-tertiary)] mt-2 leading-relaxed">
              章节写完后系统会自动生成摘要并聚入上方大纲；此处可手动重算当前选中章。
            </p>
          </>
        ) : (
          <p className="text-[11px] text-[var(--nv-text-tertiary)] leading-relaxed">
            未选中章节。在左侧大纲点选一章后，可在此手动生成 / 重算该章摘要。
          </p>
        )}
      </section>
    </div>
  );
}
