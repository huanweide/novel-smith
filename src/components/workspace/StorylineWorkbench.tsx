"use client";
import { Modal } from "@/components/ui/Modal";
import { Icon, type IconName } from "@/components/ui/icons";
import { Button } from "@/components/ui/button";
import { EmptyState, ErrorState } from "@/components/ui/States";
import { DialogField, DialogInput } from "./DialogUI";
import type { StorylineData } from "./StorylineList";
import { sortChildrenByStatusThenOrder, type NarrativeRole } from "@/lib/storyline-progress";
import { LineNav } from "./storyline-workbench/LineNav";
import { ClueRow } from "./storyline-workbench/ClueRow";
import { useStorylineWorkbench } from "./storyline-workbench/useStorylineWorkbench";
import {
  UNKNOWN_ERROR,
  MAX_POLLS,
  ELEMENT_META,
  THREE_ELEMENTS,
  elementsFor,
  stripElements,
  type StorylineSuggestion,
} from "./storyline-workbench/constants";

export type { StorylineSuggestion };

export function StorylineWorkbench({
  projectId,
  initialId,
  initialSuggestions,
  initialTaskId,
  onClose,
  onRefresh,
  onTaskSettled,
  onWriteChapter,
}: {
  projectId: string;
  initialId?: string | null;
  initialSuggestions?: StorylineSuggestion[] | null;
  initialTaskId?: string | null;
  onClose: () => void;
  onRefresh: () => void;
  onTaskSettled?: () => void;
  onWriteChapter?: (storylineId?: string, opts?: { diffuseCompleted?: boolean }) => void;
}) {
  const { list, setList, loading, setLoading, error, setError, collapsed, setCollapsed, showCleanup, setShowCleanup, cleaning, setCleaning, selectedId, setSelectedId, editing, setEditing, form, setForm, generating, setGenerating, saving, setSaving, activeTab, setActiveTab, editingKey, setEditingKey, draft, setDraft, roleMap, roleFilter, setRoleFilter, roleSavingFor, setRoleSavingFor, setRole, genSuggestions, setGenSuggestions, genExtra, setGenExtra, committing, setCommitting, genTask, setGenTask, pollRef, netErrCount, pollCount, startPolling, load, selected, mains, sides, resolveParent, orphanSides, sortedMains, abandonedCount, events, timelineEvents, ownClues, aggregatedClues, causalNodes, causalClues, updateField, handleToggleComplete, handleGenerate, handleCommitGen, startEdit, handleSave, cleanupAbandoned, deletingId, deleteStoryline, newClueTag, setNewClueTag, newClueContent, setNewClueContent, handleAddClue, handleCluePatch, handleClueDelete, handleElementPatch, commitElement, updateSuggestion, updateSuggestionElement } = useStorylineWorkbench({
    projectId,
    initialId,
    initialSuggestions,
    initialTaskId,
    onClose,
    onRefresh,
    onTaskSettled,
    onWriteChapter,
  });

  return (
    <>
    <Modal
      open
      onClose={onClose}
      bare
      panelClassName="max-w-5xl w-full max-h-[92vh] flex flex-col overflow-hidden"
      labelledBy="workbench-title"
    >
      {/* 头部 */}
      <div className="flex shrink-0 items-center justify-between border-b border-[var(--nv-border-2)] px-5 py-3">
        <h2
          id="workbench-title"
          className="flex items-center gap-2 text-lg font-semibold text-[var(--nv-text-primary)]"
        >
          <Icon name="bookmarked" size={18} className="text-[var(--nv-accent)]" /> 故事线工作台
        </h2>
        <div className="flex items-center gap-2">
          {abandonedCount > 0 && (
            <button
              onClick={() => setShowCleanup(true)}
              className="flex items-center gap-1.5 rounded-lg border border-[var(--nv-danger)]/40 px-3 py-1.5 text-xs font-medium text-[var(--nv-danger)] transition-colors hover:bg-[var(--nv-danger-soft)]"
              title="删除所有已废弃的故事线"
            >
              <Icon name="trash" size={14} /> 清理废弃({abandonedCount})
            </button>
          )}
          <button
            onClick={handleGenerate}
            disabled={generating || !!genSuggestions}
            className="flex items-center gap-1.5 rounded-lg bg-[var(--nv-creative-fill)] px-3 py-1.5 text-xs font-medium text-[var(--nv-creative-text)] transition-colors hover:opacity-90 disabled:opacity-50"
          >
            {generating ? (
              <>
                <Icon name="loader" size={14} className="animate-spin" />
                {genTask?.status === "running" ? `生成中… ${genTask.progress}%` : "生成中…"}
              </>
            ) : (
              <>
                <Icon name="bot" size={14} /> AI 生成
              </>
            )}
          </button>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-[var(--nv-text-tertiary)] transition-colors hover:bg-[var(--nv-surface-2)] hover:text-[var(--nv-text-primary)]"
            aria-label="关闭"
            title="关闭"
          >
            <Icon name="x" size={16} />
          </button>
        </div>
      </div>

      {/* AI 生成中间态编辑器（覆盖主体） */}
      {genSuggestions ? (
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <div className="mb-3 flex items-center gap-2 text-sm font-medium text-[var(--nv-creative)]">
            <Icon name="bot" size={16} /> AI 生成草稿（可改，确认后保存）
          </div>
          <DialogField label="对下一次生成的补充要求（可选，本次不发送）">
            <DialogInput value={genExtra} onChange={setGenExtra} placeholder="例如：增加一条感情支线" />
          </DialogField>

          <div className="mt-3 space-y-3">
            {genSuggestions.map((s, idx) => (
              <div key={idx} className="rounded-xl border border-[var(--nv-border-2)] bg-[var(--nv-surface-1)] p-3">
                <div className="mb-2 flex items-center gap-2">
                  <span
                    className={`rounded px-2 py-0.5 text-[10px] ${
                      s.type === "main"
                        ? "bg-[var(--nv-accent-soft)] text-[var(--nv-accent)]"
                        : "bg-[var(--nv-surface-2)] text-[var(--nv-text-secondary)]"
                    }`}
                  >
                    {s.type === "main" ? "主线" : s.type === "thread" ? "伏笔" : "支线"}
                  </span>
                  <DialogInput
                    value={s.title}
                    onChange={(v) => updateSuggestion(idx, { title: v })}
                    className="flex-1"
                  />
                </div>
                <DialogField label="简述">
                  <DialogInput
                    value={s.description}
                    onChange={(v) => updateSuggestion(idx, { description: v })}
                  />
                </DialogField>
                <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {ELEMENT_META.map(({ key, label }) =>
                    key === "ending" ? (
                      // IMP-018：AI 中间态草稿的「结局」不可编辑——落库时被强制 null 静默丢弃，故改为只读提示
                      <DialogField key={key} label={label}>
                        <div className="rounded-lg border border-dashed border-[var(--nv-border-2)] bg-[var(--nv-surface-2)] px-3 py-2 text-xs leading-relaxed text-[var(--nv-text-tertiary)]">
                          结局先不填——写完这章、确定走向后再「标记收束」
                        </div>
                      </DialogField>
                    ) : (
                      <DialogField key={key} label={label}>
                        <DialogInput
                          rows={2}
                          value={s.sevenElements[key] || ""}
                          onChange={(v) => updateSuggestionElement(idx, key, v)}
                        />
                      </DialogField>
                    ),
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4 flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setGenSuggestions(null);
                setGenExtra("");
              }}
            >
              放弃
            </Button>
            <Button onClick={handleCommitGen} disabled={committing} className="btn-primary">
              {committing ? (
                <>
                  <Icon name="loader" size={14} className="animate-spin" /> 保存中…
                </>
              ) : (
                "保存到故事线"
              )}
            </Button>
          </div>
        </div>
      ) : (
        /* 正常主体：左导航 + 右详情 */
        <div className="flex min-h-0 flex-1">
          {/* 左列：主线/支线导航 */}
          <div className="w-72 shrink-0 overflow-y-auto border-r border-[var(--nv-border-2)] bg-[var(--nv-surface-1)] p-2.5">
            {loading && <div className="py-8 text-center text-xs text-[var(--nv-text-tertiary)]">加载中…</div>}
            {error && !loading && (
              <ErrorState
                title="加载失败"
                description={error}
                action={<Button variant="outline" onClick={() => void load()}>重试</Button>}
              />
            )}
            {!loading && !error && list.length === 0 && (
              <EmptyState
                icon="bookmarked"
                title="还没有故事线"
                description="让 AI 基于你的大纲自动规划主线与支线，填充七要素框架"
                action={
                  <button onClick={handleGenerate} disabled={generating} className="btn-ghost text-xs">
                    {generating ? "生成中…" : "AI 自动生成"}
                  </button>
                }
              />
            )}
            {!loading && !error && list.length > 0 && (
              <div className="space-y-1">
                {sortedMains.map((m) => {
                  const children = sortChildrenByStatusThenOrder([
                    ...sides.filter((s) => resolveParent(s)?.id === m.id),
                  ]);
                  const isCollapsed = collapsed.has(m.id);
                  return (
                    <div key={m.id}>
                      <LineNav
                        s={m}
                        selected={selectedId === m.id}
                        onSelect={() => {
                          setSelectedId(m.id);
                          setEditing(false);
                        }}
                        onToggle={() => handleToggleComplete(m)}
                        collapsible
                        collapsed={isCollapsed}
                        childCount={children.length}
                        onToggleCollapse={() =>
                          setCollapsed((prev) => {
                            const n = new Set(prev);
                            if (n.has(m.id)) n.delete(m.id);
                            else n.add(m.id);
                            return n;
                          })
                        }
                      />
                      {!isCollapsed &&
                        children.map((s) => (
                          <div key={s.id} className="ml-3">
                            <LineNav
                              s={s}
                              selected={selectedId === s.id}
                              onSelect={() => {
                                setSelectedId(s.id);
                                setEditing(false);
                              }}
                              onToggle={() => handleToggleComplete(s)}
                            />
                          </div>
                        ))}
                    </div>
                  );
                })}
                {/* 独立支线：无归属主线，与主线并列呈现（B 任务） */}
                {orphanSides.length > 0 && (
                  <>
                    <p className="px-1 pt-2 text-[10px] uppercase tracking-wider text-[var(--nv-text-tertiary)]">
                      独立支线
                    </p>
                    {sortChildrenByStatusThenOrder([...orphanSides]).map((s) => (
                      <LineNav
                        key={s.id}
                        s={s}
                        selected={selectedId === s.id}
                        onSelect={() => {
                          setSelectedId(s.id);
                          setEditing(false);
                        }}
                        onToggle={() => handleToggleComplete(s)}
                      />
                    ))}
                  </>
                )}
              </div>
            )}
          </div>

          {/* 右列：选中线详情 */}
          <div className="min-w-0 flex-1 overflow-y-auto p-5">
            {!selected ? (
              <div className="flex h-full items-center justify-center text-xs text-[var(--nv-text-tertiary)]">
                从左侧选择一条故事线查看详情
              </div>
            ) : editing ? (
              /* 编辑态 */
              <div className="space-y-3">
                <div className="mb-1 flex items-center gap-2">
                  <span className="text-[10px] text-[var(--nv-text-tertiary)]">编辑中</span>
                </div>
                <DialogField label="标题">
                  <DialogInput value={form.title || ""} onChange={(v) => updateField("title", v)} />
                </DialogField>
                <DialogField label="简述">
                  <DialogInput value={form.description || ""} onChange={(v) => updateField("description", v)} />
                </DialogField>
                <div className="grid grid-cols-2 gap-3">
                  <DialogField label="类型（主线/支线可互换）">
                    <select
                      className="input-glass w-full rounded-lg px-3 py-2 text-sm"
                      value={form.type || "side"}
                      onChange={(e) => updateField("type", e.target.value)}
                    >
                      <option value="main">主线</option>
                      <option value="side">支线</option>
                      <option value="thread">伏笔</option>
                    </select>
                  </DialogField>
                  <DialogField label="状态">
                    <select
                      className="input-glass w-full rounded-lg px-3 py-2 text-sm"
                      value={form.status || "active"}
                      onChange={(e) => updateField("status", e.target.value)}
                    >
                      <option value="active">活跃中</option>
                      <option value="completed">已完结</option>
                      <option value="abandoned">已废弃</option>
                    </select>
                  </DialogField>
                </div>
                {/* 支线/伏笔归属主线 */}
                {(form.type === "side" || form.type === "thread") && (
                  <DialogField label="所属主线">
                    <select
                      className="input-glass w-full rounded-lg px-3 py-2 text-sm"
                      value={form.parentId || ""}
                      onChange={(e) => updateField("parentId", e.target.value)}
                    >
                        <option value="">（无归属）</option>
                        {sortedMains.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.title}
                          </option>
                        ))}
                    </select>
                  </DialogField>
                )}
              {/* 七要素改走查看态 inline 编辑，编辑表单只保留元数据字段 */}

                <div className="flex justify-end gap-2 pt-1">
                  <Button variant="outline" onClick={() => setEditing(false)}>
                    取消
                  </Button>
                  <Button onClick={handleSave} disabled={saving} className="btn-primary">
                    {saving ? (
                      <>
                        <Icon name="loader" size={14} className="animate-spin" /> 保存中…
                      </>
                    ) : (
                      "保存"
                    )}
                  </Button>
                </div>
              </div>
            ) : (
              /* 查看态 */
              <div className="space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span
                        className={`rounded px-2 py-0.5 text-[10px] ${
                          selected.type === "main"
                            ? "bg-[var(--nv-accent-soft)] text-[var(--nv-accent)]"
                            : "bg-[var(--nv-surface-2)] text-[var(--nv-text-secondary)]"
                        }`}
                      >
                        {selected.type === "main" ? "主线" : selected.type === "thread" ? "伏笔" : "支线"}
                      </span>
                      <h3 className="truncate text-lg font-semibold text-[var(--nv-text-primary)]">
                        {selected.title}
                      </h3>
                    </div>
                    {selected.description && (
                      <p className="mt-1 text-sm text-[var(--nv-text-secondary)]">{selected.description}</p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <button
                      onClick={() => handleToggleComplete(selected)}
                      className="flex items-center gap-1 rounded-lg border border-[var(--nv-border-2)] px-2.5 py-1.5 text-xs text-[var(--nv-text-secondary)] transition-colors hover:border-[var(--nv-success)]/50 hover:text-[var(--nv-success)]"
                    >
                      {selected.status === "completed" ? (
                        <>
                          <Icon name="check" size={14} className="text-[var(--nv-success)]" /> 重新开启
                        </>
                      ) : selected.status === "abandoned" ? (
                        <>
                          <Icon name="check" size={14} className="text-[var(--nv-success)]" /> 重新启用
                        </>
                      ) : (
                        <>
                          <Icon name="circle" size={14} /> 标记完结
                        </>
                      )}
                    </button>
                    <button
                      onClick={() => startEdit(selected)}
                      className="flex items-center gap-1 rounded-lg border border-[var(--nv-border-2)] px-2.5 py-1.5 text-xs text-[var(--nv-text-secondary)] transition-colors hover:border-[var(--nv-primary)]/50 hover:text-[var(--nv-primary)]"
                    >
                      <Icon name="pencil" size={14} /> 编辑
                    </button>
                    <button
                      onClick={() => deleteStoryline(selected.id)}
                      disabled={deletingId === selected.id}
                      className="rounded-lg border border-[var(--nv-border-2)] px-2.5 py-1.5 text-xs text-[var(--nv-text-tertiary)] transition-colors hover:border-[var(--nv-danger)]/50 hover:text-[var(--nv-danger)] disabled:opacity-40"
                      title="删除"
                      aria-label="删除"
                    >
                      <Icon name="trash" size={14} />
                    </button>
                    {onWriteChapter && (
                      <button
                        onClick={() =>
                          onWriteChapter(selected.id, {
                            diffuseCompleted: selected.status === "completed",
                          })
                        }
                        className="flex items-center gap-1 rounded-lg border border-[var(--nv-primary)]/40 px-2.5 py-1.5 text-xs text-[var(--nv-primary)] transition-colors hover:bg-[var(--nv-primary-soft)]"
                        title="据此续写一章"
                      >
                        <Icon name="pencil" size={14} /> 据此续写
                      </button>
                    )}
                  </div>
                </div>

                {/* sticky 子标签导航：把三块变可切换视图，核心七要素常驻为默认标签，不再被埋在底部 */}
                <div className="sticky top-0 z-10 -mx-5 mb-3 border-b border-[var(--nv-border-2)] bg-[var(--nv-surface-2)] px-5 py-2 backdrop-blur-sm">
                  <div className="flex gap-1">
                    {(["elements", "timeline", "clues", "causal"] as const).map((t) => {
                      const labels: Record<"elements" | "timeline" | "clues" | "causal", string> = {
                        elements: selected.type === "main" ? "总纲·三要素" : "总纲·七要素",
                        timeline: "章节时间轴",
                        clues: `线索集 (${aggregatedClues.length})`,
                        causal: `因果链 (${causalNodes.length})`,
                      };
                      const active = activeTab === t;
                      return (
                        <button
                          key={t}
                          onClick={() => setActiveTab(t)}
                          className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                            active
                              ? "bg-[var(--nv-primary)] text-white"
                              : "text-[var(--nv-text-secondary)] hover:bg-[var(--nv-surface-1)]"
                          }`}
                        >
                          {labels[t]}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {activeTab === "elements" && (
                  <div>
                    <div className="mb-2 flex items-center gap-2 text-xs font-medium text-[var(--nv-text-tertiary)]">
                      <span>{selected.type === "main" ? "三要素 · 主线总纲" : "七要素 · 总纲"}</span>
                      {selected.status === "completed" && (
                        <span className="rounded-full border border-[var(--nv-success)] px-2 py-0.5 text-[11px] font-medium text-[var(--nv-success)]">
                          已完结 · 要素已自动补齐 ✓
                        </span>
                      )}
                    </div>
                    <p className="mb-2 text-[11px] text-[var(--nv-text-tertiary)]">
                      {selected.type === "main"
                        ? "主线线索密、事件多，用起因 / 经过 / 结果三要素提纲挈领。点任意卡片即可直接改。"
                        : "七要素是这条线的骨架。点任意卡片即可直接改，也可以先写几章、让 AI 在写作后自动回填进展。"}
                    </p>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {elementsFor(selected.type).map(({ key, icon, label, hint }) => {
                        const se =
                          selected.sevenElements && typeof selected.sevenElements === "object"
                            ? selected.sevenElements
                            : {};
                        const val = (se as Record<string, string | null | undefined>)[key] || "";
                        const isEnding = key === "ending";
                        const isEditing = editingKey === key;
                        return (
                          <div
                            key={key}
                            className={`rounded-xl border bg-[var(--nv-surface-1)] p-3 ${
                              isEditing ? "border-[var(--nv-primary)]" : "border-[var(--nv-border-2)]"
                            }`}
                          >
                            <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-[var(--nv-text-secondary)]">
                              <Icon name={icon} size={14} /> {label}
                            </div>
                            {!isEnding && !isEditing && (
                              <p className="mb-1 text-[11px] text-[var(--nv-text-tertiary)]">{hint}</p>
                            )}
                            {isEnding ? (
                              <div className="flex items-center gap-2">
                                {val ? (
                                  <span className="text-sm text-[var(--nv-success)]">已收束 ✓</span>
                                ) : (
                                  <span className="text-sm text-[var(--nv-text-tertiary)]">待收束</span>
                                )}
                                <button
                                  onClick={() => handleElementPatch("ending", val ? null : "已收束")}
                                  className="ml-auto rounded-lg border border-[var(--nv-border-2)] px-2.5 py-1 text-xs text-[var(--nv-text-secondary)] transition-colors hover:border-[var(--nv-success)]/50 hover:text-[var(--nv-success)]"
                                >
                                  {val ? "取消收束" : "标记收束"}
                                </button>
                              </div>
                            ) : isEditing ? (
                              <textarea
                                autoFocus
                                aria-label="编辑情节内容"
                                value={draft}
                                onChange={(e) => setDraft(e.target.value)}
                                onBlur={commitElement}
                                onKeyDown={(e) => {
                                  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                                    e.preventDefault();
                                    commitElement();
                                  } else if (e.key === "Escape") {
                                    setEditingKey(null);
                                  }
                                }}
                                rows={3}
                                className="w-full resize-none rounded-md border border-[var(--nv-border-2)] bg-[var(--nv-surface-2)] p-2 text-sm leading-relaxed text-[var(--nv-text-primary)] outline-none focus:border-[var(--nv-primary)]"
                              />
                            ) : (
                              <div
                                role="button"
                                tabIndex={0}
                                onClick={() => {
                                  setEditingKey(key);
                                  setDraft(val);
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") {
                                    e.preventDefault();
                                    setEditingKey(key);
                                    setDraft(val);
                                  }
                                }}
                                className="min-h-[1.5rem] cursor-text whitespace-pre-wrap rounded-md text-sm leading-relaxed text-[var(--nv-text-primary)]"
                              >
                                {val || <span className="text-[var(--nv-text-tertiary)]">点击填写</span>}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {activeTab === "timeline" && (
                  <div>
                    <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-[var(--nv-text-tertiary)]">
                      <Icon name="history" size={14} />
                      {selected.type === "main"
                        ? "主线时间轴（简略 · 可滚动浏览全貌）"
                        : "章节进展时间轴（写作自动记录关键情节节点）"}
                    </div>
                    {timelineEvents.length > 0 ? (
                      selected.type === "main" ? (
                        // 主线：紧凑竖向、可滚动，只列发生了什么
                        <ol className="max-h-[320px] space-y-1.5 overflow-y-auto pr-1">
                          {timelineEvents.map((b) => (
                            <li
                              key={b.id}
                              className="flex gap-2 border-l-2 border-[var(--nv-border-2)] bg-[var(--nv-surface-1)] py-1 pl-2.5 text-xs leading-relaxed text-[var(--nv-text-secondary)]"
                            >
                              <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--nv-accent)]" />
                              <span className="line-clamp-2">
                                <span className="font-medium text-[var(--nv-text-primary)]">
                                  {b.title || (b.kind === "MILESTONE" ? "里程碑" : "事件")}
                                </span>
                                {b.content ? `：${(b.content || "").slice(0, 60)}` : ""}
                              </span>
                            </li>
                          ))}
                        </ol>
                      ) : (
                        // 支线：详细时间轴，完整呈现
                        <ol className="relative space-y-3 border-l border-[var(--nv-border-2)] pl-4">
                          {timelineEvents.map((b) => (
                            <li key={b.id} className="relative">
                              <span className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full bg-[var(--nv-accent)] ring-2 ring-[var(--nv-surface-1)]" />
                              <div className="text-xs text-[var(--nv-text-tertiary)]">
                                {b.title || (b.kind === "MILESTONE" ? "里程碑" : "事件")}
                              </div>
                              <div className="whitespace-pre-wrap text-sm leading-relaxed text-[var(--nv-text-secondary)]">
                                {b.content}
                              </div>
                            </li>
                          ))}
                        </ol>
                      )
                    ) : (
                      <EmptyState
                        icon="history"
                        title="还没写这一线的章节"
                        description="时间轴会在你写作时自动记录关键情节节点——先去写一章，回来就能看到它长出来。"
                        action={
                          onWriteChapter ? (
                            <button onClick={() => onWriteChapter()} className="btn-ghost text-xs">
                              去写一章
                            </button>
                          ) : undefined
                        }
                      />
                    )}
                  </div>
                )}

                {activeTab === "clues" && (
                  <div>
                    <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-[var(--nv-text-tertiary)]">
                      <Icon name="tag" size={14} />
                      {selected.type === "main" ? "主线线索集 · 汇聚本线与所有支线" : "线索集 · 你埋下的坑（伏笔/物证/人物备注）"}
                      <span className="rounded bg-[var(--nv-surface-2)] px-1 text-[9px]">{aggregatedClues.length}</span>
                    </div>
                    {aggregatedClues.length === 0 && (
                      <p className="mb-2 text-xs text-[var(--nv-text-tertiary)]">还没埋线索。伏笔、物证、人物备注都可以记在这里——写的时候随时回看，别漏掉自己挖的坑。</p>
                    )}
                    <div className="space-y-2">
                      {aggregatedClues.map(({ clue, source }) => (
                        <div key={clue.id}>
                          {source && (
                            <div className="mb-1 text-[10px] text-[var(--nv-text-tertiary)]">来自支线：{source}</div>
                          )}
                          <ClueRow clue={clue} onPatch={handleCluePatch} onDelete={handleClueDelete} />
                        </div>
                      ))}
                      {/* 新增线索 */}
                      <div className="rounded-xl border border-dashed border-[var(--nv-border-2)] bg-[var(--nv-surface-1)] p-3">
                        <div className="mb-2 flex items-center gap-2">
                          <DialogInput
                            value={newClueTag}
                            onChange={setNewClueTag}
                            placeholder="标签（如：关键道具 / 人物线索）"
                            className="w-40"
                          />
                        </div>
                        <DialogInput
                          rows={2}
                          value={newClueContent}
                          onChange={setNewClueContent}
                          placeholder="线索内容（可无限延伸、每条可编辑）"
                        />
                        <div className="mt-2 flex justify-end">
                          <Button variant="outline" onClick={handleAddClue} className="text-[11px]">
                            <Icon name="plus" size={12} /> 添加线索
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {activeTab === "causal" && selected && (
                  <div>
                    <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-[var(--nv-text-primary)]">
                      <Icon name="gitBranch" size={14} />
                      {selected.type === "main"
                        ? "因果链 · 主线如何带动支线与伏笔"
                        : "因果链 · 这条线的事件前后关系"}
                    </div>
                    <div className="mb-3 rounded-lg border border-[var(--nv-border-2)] bg-[var(--nv-surface-1)] p-2.5 text-[11px] leading-relaxed text-[var(--nv-text-secondary)]">
                      <div className="mb-1 flex items-center gap-1 font-medium text-[var(--nv-text-primary)]">
                        <Icon name="info" size={12} /> 怎么读这条链？
                      </div>
                      <ul className="list-disc space-y-0.5 pl-4">
                        <li><b>时间向下流动：</b>越靠上的事件越早发生，越靠下的事件越晚发生。</li>
                        <li><b>前因后果：</b>每个事件都是上方事件的「果」、下方事件的「因」。</li>
                        <li><b>跨线归属：</b>主线事件会带动支线/伏笔事件，节点上标了来自哪条线。</li>
                        <li><b>给节点打标签：</b>点击节点下方的角色按钮，标注它是「剧情推进点」「卡点」还是「分支选择点」，AI 续写时会读到这些标记。</li>
                      </ul>
                    </div>

                    {/* 叙事角色统计与筛选 */}
                    <div className="mb-3 flex flex-wrap items-center gap-1.5">
                      {(
                        [
                          { r: "advance" as NarrativeRole, label: "剧情推进点", short: "推进", color: "var(--nv-success)", icon: "arrowRight", desc: "让剧情往前走的关键转折" },
                          { r: "probe" as NarrativeRole, label: "卡点 / 阻碍", short: "卡点", color: "var(--nv-warning)", icon: "shield", desc: "主角遇到的困难、未解之谜或暂时过不去的障碍" },
                          { r: "vote" as NarrativeRole, label: "分支选择点", short: "分支", color: "var(--nv-info)", icon: "flag", desc: "剧情到这里可以走向不同方向，需要你或 AI 决定" },
                        ] as const
                      ).map(({ r, label, short, color, icon, desc }) => {
                        const count = causalNodes.filter((n) => n.role === r).length;
                        const active = roleFilter === r;
                        return (
                          <button
                            key={r}
                            onClick={() => setRoleFilter(active ? null : r)}
                            title={desc}
                            className={`flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-medium transition-all ${
                              active
                                ? "border-[var(--nv-border-1)] bg-[var(--nv-surface-2)] shadow-sm"
                                : "border-[var(--nv-border-2)] hover:border-[var(--nv-border-1)] hover:bg-[var(--nv-surface-2)]"
                            }`}
                            style={{ color: active ? color : undefined }}
                          >
                            <Icon name={icon as IconName} size={11} /> {short} {count}
                          </button>
                        );
                      })}
                      {roleFilter && (
                        <button onClick={() => setRoleFilter(null)} className="rounded-full px-2 py-1 text-[10px] text-[var(--nv-text-muted)] hover:text-[var(--nv-text-primary)] hover:underline">
                          清除筛选
                        </button>
                      )}
                    </div>

                    {/* 悬而未决的因：未兑现线索 */}
                    {causalClues.length > 0 && (
                      <div className="mb-3 rounded-lg border border-[var(--nv-border-2)] bg-[var(--nv-surface-1)] p-2.5">
                        <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-[var(--nv-warning)]">
                          <Icon name="link" size={13} /> 悬而未决的因 · 未兑现线索 ({causalClues.length})
                        </div>
                        <ul className="space-y-1">
                          {causalClues.map(({ clue, source }) => (
                            <li key={clue.id} className="flex items-start gap-1.5 text-xs leading-relaxed text-[var(--nv-text-secondary)]">
                              <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-[var(--nv-warning)]" />
                              <span>
                                {clue.tag && <span className="text-[var(--nv-text-muted)]">[{clue.tag}] </span>}
                                <span className="text-[var(--nv-text-primary)]">{clue.title || "（未命名线索）"}</span>
                                {source && <span className="text-[var(--nv-text-muted)]"> · 来自 {source}</span>}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* 因果链主体 */}
                    {causalNodes.length > 0 ? (
                      <ol className="relative space-y-0 border-l-2 border-[var(--nv-border-1)] pl-4">
                        {causalNodes.map((node, i) => (
                          <li key={node.event.id} className="relative pb-4 last:pb-0">
                            <span
                              className={`absolute -left-[23px] top-1 h-3 w-3 rounded-full ring-2 ring-[var(--nv-surface-1)] ${
                                node.isMain
                                  ? "bg-[var(--nv-primary)]"
                                  : node.lineType === "thread"
                                    ? "bg-[var(--nv-info)]"
                                    : "bg-[var(--nv-accent)]"
                              }`}
                            />
                            <div className={`rounded-xl border bg-[var(--nv-surface-1)] p-2.5 transition-all duration-150 hover:-translate-y-0.5 hover:bg-[var(--nv-surface-2)] hover:shadow-[0_0_14px_color-mix(in_oklch,var(--nv-accent)_30%,transparent)] ${
                              node.role === "advance"
                                ? "border border-[var(--nv-border-2)] border-l-2 border-l-[var(--nv-success)]"
                                : node.role === "probe"
                                  ? "border border-[var(--nv-border-2)] border-l-2 border-l-[var(--nv-warning)]"
                                  : node.role === "vote"
                                    ? "border border-[var(--nv-border-2)] border-l-2 border-l-[var(--nv-info)]"
                                    : "border border-[var(--nv-border-2)]"
                            } ${roleFilter && node.role !== roleFilter ? "opacity-40" : ""}`}>
                              <div className="mb-1 flex items-center gap-1.5">
                                <span
                                  className={`rounded bg-[var(--nv-surface-2)] px-1.5 py-0.5 text-[10px] font-medium ${
                                    node.isMain
                                      ? "text-[var(--nv-primary)]"
                                      : node.lineType === "thread"
                                        ? "text-[var(--nv-info)]"
                                        : "text-[var(--nv-accent)]"
                                  }`}
                                >
                                  {node.isMain ? "主线" : node.lineType === "thread" ? "伏笔" : "支线"}
                                </span>
                                <span className="truncate text-xs text-[var(--nv-text-muted)]">{node.lineTitle}</span>
                                <span className="ml-auto shrink-0 font-mono text-[10px] text-[var(--nv-text-muted)]">#{i + 1}</span>
                              </div>
                              <div className="text-sm font-medium text-[var(--nv-text-primary)]">
                                <Icon
                                  name={node.event.kind === "MILESTONE" ? "star" : "arrowRight"}
                                  size={12}
                                  className="inline-block align-text-bottom"
                                />{" "}
                                {node.event.title || (node.event.kind === "MILESTONE" ? "里程碑" : "事件")}
                              </div>
                              {node.event.content && (
                                <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-xs leading-relaxed text-[var(--nv-text-secondary)]">
                                  {node.event.content}
                                </p>
                              )}
                              {/* 角色标注按钮组 */}
                              <div className="mt-2 flex flex-wrap items-center gap-1">
                                {(
                                  [
                                    { r: "advance" as NarrativeRole, label: "剧情推进点", icon: "arrowRight", color: "var(--nv-success)", desc: "这个事件让剧情往前走" },
                                    { r: "probe" as NarrativeRole, label: "卡点 / 阻碍", icon: "shield", color: "var(--nv-warning)", desc: "这个事件制造了困难或悬念" },
                                    { r: "vote" as NarrativeRole, label: "分支选择点", icon: "flag", color: "var(--nv-info)", desc: "这个事件让剧情可以走向不同方向" },
                                  ] as const
                                ).map(({ r, label, icon, color, desc }) => {
                                  const active = node.role === r;
                                  return (
                                    <button
                                      key={r}
                                      disabled={roleSavingFor === node.event.id}
                                      title={desc}
                                      onClick={() => setRole(node.event.id, active ? null : r)}
                                      className={`flex items-center gap-1 rounded border px-1.5 py-1 text-[10px] font-medium transition-all disabled:opacity-50 ${
                                        active
                                          ? "border-[var(--nv-border-1)] bg-[var(--nv-surface-2)] shadow-sm"
                                          : "border-[var(--nv-border-2)] text-[var(--nv-text-muted)] hover:border-[var(--nv-border-1)] hover:bg-[var(--nv-surface-2)] hover:text-[var(--nv-text-primary)]"
                                      }`}
                                      style={active ? { color } : undefined}
                                    >
                                      <Icon name={icon as IconName} size={11} />
                                      {label}
                                      {active && <Icon name="check" size={10} />}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                            {i < causalNodes.length - 1 && (
                              <div className="ml-1 mt-1 flex items-center gap-1 text-[10px] font-medium text-[var(--nv-text-secondary)]">
                                <Icon name="arrowDown" size={11} />
                                <span>先发生</span>
                                <span className="text-[var(--nv-border-1)]">→</span>
                                <span>后导致</span>
                              </div>
                            )}
                          </li>
                        ))}
                      </ol>
                    ) : (
                      <EmptyState
                        icon="gitBranch"
                        title="这条线还没有事件"
                        description="写一章，写作会自动记录关键情节节点，因果链就会长出来。"
                        action={
                          onWriteChapter ? (
                            <button onClick={() => onWriteChapter()} className="btn-ghost text-xs">
                              去写一章
                            </button>
                          ) : undefined
                        }
                      />
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </Modal>
    {showCleanup && (
      <Modal open onClose={() => setShowCleanup(false)} bare panelClassName="max-w-sm" labelledBy="cleanup-title">
        <div className="p-5">
          <h3 id="cleanup-title" className="flex items-center gap-2 text-base font-semibold text-[var(--nv-text-primary)]">
            <Icon name="trash" size={16} className="text-[var(--nv-danger)]" /> 清理废弃故事线
          </h3>
          <p className="mt-2 text-sm text-[var(--nv-text-secondary)]">
            将永久删除 {abandonedCount} 条「已废弃」的故事线，此操作不可恢复。确定继续？
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setShowCleanup(false)}>取消</Button>
            <Button onClick={cleanupAbandoned} disabled={cleaning} className="bg-[var(--nv-danger)] text-white hover:opacity-90">
              {cleaning ? "清理中…" : "删除"}
            </Button>
          </div>
        </div>
      </Modal>
    )}
    </>
  );
}
