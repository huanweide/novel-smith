/**
 * 故事线工作台：全部状态与业务逻辑（原 StorylineWorkbench.tsx 主组件 104-627 行）
 * 抽成自定义 hook 后，主组件只剩 JSX 编排，便于单独测试与阅读。
 */

"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { describeHttpError } from "@/lib/stream-error";
import { toastError, toastSuccess, toastCreated } from "@/components/ui/toast";
import { useConfirmDelete } from "../useConfirmDelete";
import {
  computeStorylineProgress,
  groupStorylinesByMain,
  sortChildrenByStatusThenOrder,
  buildCausalChain,
  withNarrativeRoles,
  type NarrativeRole,
} from "@/lib/storyline-progress";
import type { StorylineData } from "../StorylineList";
import { UNKNOWN_ERROR, MAX_POLLS, elementsFor, stripElements, type StorylineSuggestion } from "./constants";

export function useStorylineWorkbench({
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
  const [list, setList] = useState<StorylineData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // 主线收起态（B 任务：主线下的支线可收起）
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  // 清理废弃故事线确认框
  const [showCleanup, setShowCleanup] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(initialId ?? null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<"elements" | "timeline" | "clues" | "causal">("elements");
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  // v1.9 叙事角色标注（剧情推进点 / 卡点 / 分支选择点）：持久化到 StorylineEvent.role
  const roleMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const s of list) {
      for (const e of s.events || []) {
        if (e.role) map[`${selectedId}:${e.id}`] = e.role;
      }
    }
    return map;
  }, [list, selectedId]);
  const [roleFilter, setRoleFilter] = useState<NarrativeRole | null>(null);
  const [roleSavingFor, setRoleSavingFor] = useState<string | null>(null);
  const setRole = async (eventId: string, role: NarrativeRole | null) => {
    const prev = roleMap[eventId] || null;
    // 乐观更新本地 list，让 UI 立刻反馈
    setList((prevList) =>
      prevList.map((s) => ({
        ...s,
        events: (s.events || []).map((e: any) => (e.id === eventId ? { ...e, role: role ?? undefined } : e)),
      })),
    );
    setRoleSavingFor(eventId);
    try {
      const r = await fetch(`/api/storyline-events/${eventId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: role ?? null }),
      });
      if (!r.ok) throw new Error((await r.json()).error || "保存失败");
    } catch (err) {
      toastError(`标注失败：${err instanceof Error ? err.message : "未知错误"}`);
      // 回滚
      setList((prevList) =>
        prevList.map((s) => ({
          ...s,
          events: (s.events || []).map((e: any) => (e.id === eventId ? { ...e, role: prev ?? undefined } : e)),
        })),
      );
    } finally {
      setRoleSavingFor(null);
    }
  };

  // AI 生成中间态
  const [genSuggestions, setGenSuggestions] = useState<StorylineSuggestion[] | null>(initialSuggestions ?? null);
  const [genExtra, setGenExtra] = useState("");
  const [committing, setCommitting] = useState(false);

  // 真后台生成任务轮询态（v1.8.6 #174）：创建 task 后轮询，关页面不影响服务端任务
  const [genTask, setGenTask] = useState<{ taskId: string; status: string; progress: number; error?: string } | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const netErrCount = useRef(0); // IMP-008：连续网络错误计数
  const pollCount = useRef(0); // IMP-008：轮询次数计数（兜底上限）

  // 组件卸载（关闭工作台）时清理轮询定时器，避免泄漏（服务端任务不受影响，继续跑）
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  // v1.8.7：把内联轮询逻辑抽成独立回调，供「工作台内 AI 生成」与「列表入口挂载即轮询」共用
  const startPolling = useCallback(
    async (taskId: string) => {
      // IMP-009：开新轮询前先清理可能残留的旧 interval，避免双重轮询叠加
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      netErrCount.current = 0;
      pollCount.current = 0;
      setGenerating(true);
      // 轮询任务直到 done / failed（关页面不影响服务端任务，重新进页面可再次轮询）
      pollRef.current = setInterval(async () => {
        pollCount.current += 1;
        // IMP-008：最大轮询次数兜底（≈6min），防止极端情况下无限轮询
        if (pollCount.current > MAX_POLLS) {
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
          setGenerating(false);
          toastError("生成状态同步超时，请重试");
          return;
        }
        try {
          const r = await fetch(`/api/generation-tasks/${taskId}`);
          const t = await r.json();
          if (!r.ok) {
            if (pollRef.current) clearInterval(pollRef.current);
            pollRef.current = null;
            setGenTask({ taskId, status: "failed", progress: 0, error: t.error ?? "获取生成结果失败" });
            setGenerating(false);
            toastError(`生成任务失败：${t.error ?? "获取生成结果失败"}`);
            return;
          }
          setGenTask({ taskId, status: t.status, progress: t.progress, error: t.error });
          if (t.status === "done") {
            if (pollRef.current) clearInterval(pollRef.current);
            pollRef.current = null;
            const suggestions = (t.result?.suggestions as StorylineSuggestion[] | undefined) ?? [];
            if (suggestions.length > 0) {
              setGenSuggestions(suggestions);
              setGenExtra("");
            } else {
              toastError("生成结果为空，请重试");
            }
            setGenTask(null);
            setGenerating(false);
            onTaskSettled?.(); // IMP-010：任务已结算，通知父级清理 genTaskId，避免陈旧 id 残留
          } else if (t.status === "failed") {
            if (pollRef.current) clearInterval(pollRef.current);
            pollRef.current = null;
            toastError(`生成失败：${t.error ?? UNKNOWN_ERROR}`);
            setGenTask(null);
            setGenerating(false);
            onTaskSettled?.(); // IMP-010：同上
          }
        } catch {
          // IMP-008：网络抖动累计计数，超阈值后停轮询并报错，避免无限空转卡死
          netErrCount.current += 1;
          if (netErrCount.current > 5) {
            if (pollRef.current) clearInterval(pollRef.current);
            pollRef.current = null;
            setGenerating(false);
            toastError("生成状态同步失败，请重试");
          }
        }
      }, 1500);
    },
    [toastError],
  );

  // 从列表点「AI 生成」后：组件挂载时若已带任务 ID，则立即开始轮询（等价原同步路径的可感知行为）
  useEffect(() => {
    if (initialTaskId) {
      void startPolling(initialTaskId);
    }
  }, [initialTaskId, startPolling]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/storylines?projectId=${projectId}`);
      if (res.ok) {
        const data = (await res.json()) as StorylineData[];
        setList(data);
        setSelectedId((prev) => prev ?? data[0]?.id ?? null);
      } else {
        const d = await res.json().catch(() => ({ error: UNKNOWN_ERROR }));
        { const _f = describeHttpError(res.status, d); setError((d as { error?: string }).error ? `加载失败：${(d as { error?: string }).error}` : `${_f.title}　${_f.description}`); }
      }
    } catch (err) {
      setError("加载故事线失败：" + (err instanceof Error ? err.message : "网络错误"));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const selected = list.find((s) => s.id === selectedId) || null;
  const { mains, sides, resolveParent } = groupStorylinesByMain(list);
  const orphanSides = sides.filter((s) => !resolveParent(s));
  // 自动排序（B 任务）：主线按 order 升序；子线按 状态+order（完结沉底）保证一致呈现
  const sortedMains = [...mains].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const abandonedCount = list.filter((s) => s.status === "abandoned").length;

  const events = selected?.events || [];
  const timelineEvents = events
    .filter((e) => e.kind !== "CLUE")
    .sort((a, b) => a.position - b.position);
  const ownClues = events.filter((e) => e.kind === "CLUE");
  // 主线线索集最深最大：自身 CLUE ∪ 所有子支线的 CLUE，按来源标注
  const aggregatedClues: { clue: (typeof ownClues)[number]; source: string | null }[] =
    selected && selected.type === "main"
      ? [
          ...ownClues.map((c) => ({ clue: c, source: null as string | null })),
          ...list
            .filter((s) => s.parentId === selected.id)
            .flatMap((s) =>
              (s.events || [])
                .filter((e) => e.kind === "CLUE")
                .map((e) => ({ clue: e, source: s.title })),
            ),
        ]
      : ownClues.map((c) => ({ clue: c, source: null as string | null }));

  // ── v1.9 因果链：选中线的事件按时间轴串成因果叙事链（纯函数见 storyline-progress） ──
  const causalNodes = withNarrativeRoles(buildCausalChain(list, selectedId), selectedId, roleMap);
  const causalClues = selected
    ? selected.type === "main"
      ? aggregatedClues
      : ownClues.map((c) => ({ clue: c, source: null as string | null }))
    : [];

  const updateField = (k: string, v: string) => setForm((p) => ({ ...p, [k]: v }));

  const handleToggleComplete = async (s: StorylineData) => {
    const next = s.status === "completed" ? "active" : "completed";
    try {
      const res = await fetch(`/api/storylines/${s.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({ error: UNKNOWN_ERROR }));
        const _f = describeHttpError(res.status, d); toastError(`状态更新失败：${_f.description}`);
        return;
      }
      toastSuccess(next === "completed" ? `「${s.title}」已完结 ✓` : `「${s.title}」已重新开启`);
      void load();
      onRefresh();
    } catch (err) {
      toastError("状态更新失败（网络错误）：" + (err instanceof Error ? err.message : "请重试"));
    }
  };

  const handleGenerate = async () => {
    setGenerating(true);
    setGenTask(null);
    try {
      const res = await fetch("/api/generation-tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, prompt: genExtra }),
      });
      const data = await res.json();
      if (!res.ok) {
        toastError(`创建生成任务失败：${data.error ?? UNKNOWN_ERROR}`);
        setGenerating(false);
        return;
      }
      const taskId = data.taskId as string;
      setGenTask({ taskId, status: "pending", progress: 0 });
      // 收敛为统一轮询入口（与列表入口挂载即轮询共用 startPolling）
      startPolling(taskId);
    } catch (err) {
      toastError(`网络错误：${err instanceof Error ? err.message : "请重试"}`);
      setGenerating(false);
    }
  };

  const handleCommitGen = async () => {
    if (!genSuggestions || genSuggestions.length === 0) return;
    setCommitting(true);
    try {
      const res = await fetch("/api/storylines/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, commit: true, suggestions: genSuggestions }),
      });
      const data = await res.json();
      if (!res.ok) {
        const _f = describeHttpError(res.status, data); toastError(`保存失败：${_f.description}`);
        return;
      }
      toastCreated("故事线");
      setGenSuggestions(null);
      setGenExtra("");
      void load();
      onRefresh();
    } catch (err) {
      toastError("保存失败（网络错误）：" + (err instanceof Error ? err.message : "请重试"));
    } finally {
      setCommitting(false);
    }
  };

  const startEdit = (s: StorylineData) => {
    setEditing(true);
    const se = s.sevenElements && typeof s.sevenElements === "object" ? s.sevenElements : {};
    const isMain = s.type === "main";
    setForm({
      title: s.title,
      description: s.description,
      status: s.status,
      type: s.type,
      parentId: s.parentId ?? "",
      ...(isMain
        ? {
            origin: (se as Record<string, string>).origin || "",
            process: (se as Record<string, string>).process || "",
            result: (se as Record<string, string>).result || "",
          }
        : {
            desire: (se as Record<string, string>).desire || "",
            obstacle: (se as Record<string, string>).obstacle || "",
            action: (se as Record<string, string>).action || "",
            result: (se as Record<string, string>).result || "",
            twist: (se as Record<string, string>).twist || "",
            turn: (se as Record<string, string>).turn || "",
            ending: (se as Record<string, string>).ending || "",
          }),
    });
  };

  const handleSave = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      const isMain = form.type === "main";
      const sevenElements = isMain
        ? {
            origin: form.origin || "",
            process: form.process || "",
            result: form.result || "",
          }
        : {
            desire: form.desire || "",
            obstacle: form.obstacle || "",
            action: form.action || "",
            result: form.result || "",
            twist: form.twist || "",
            turn: form.turn || "",
            ending: form.ending ? form.ending : null,
          };
      const payload = {
        title: form.title,
        description: form.description,
        status: form.status,
        type: form.type,
        parentId: isMain ? null : form.parentId || null,
        sevenElements,
      };
      const res = await fetch(`/api/storylines/${selected.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({ error: UNKNOWN_ERROR }));
        const _f = describeHttpError(res.status, d); toastError(`保存失败：${_f.description}`);
        return;
      }
      setEditing(false);
      void load();
      onRefresh();
    } catch (err) {
      toastError("保存失败（网络错误）：" + (err instanceof Error ? err.message : "请重试"));
    } finally {
      setSaving(false);
    }
  };

  // 清理废弃故事线（B 任务）：批量删除所有 status=abandoned 的线
  const cleanupAbandoned = async () => {
    const ids = list.filter((s) => s.status === "abandoned").map((s) => s.id);
    if (ids.length === 0) return;
    setCleaning(true);
    try {
      for (const id of ids) {
        const res = await fetch(`/api/storylines/${id}`, { method: "DELETE" });
        if (!res.ok) {
          const d = await res.json().catch(() => ({ error: UNKNOWN_ERROR }));
          const _f = describeHttpError(res.status, d); throw new Error(_f.description);
        }
      }
      toastSuccess(`已清理 ${ids.length} 条废弃故事线`);
      setShowCleanup(false);
      void load();
      onRefresh();
    } catch (err) {
      toastError("清理失败：" + (err instanceof Error ? err.message : "请重试"));
    } finally {
      setCleaning(false);
    }
  };

  const { deletingId, remove: deleteStoryline } = useConfirmDelete({
    title: "删除故事线",
    description: "确定删除这条故事线？此操作不可恢复。",
    deleteFn: async (id) => {
      const res = await fetch(`/api/storylines/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const d = await res.json().catch(() => ({ error: UNKNOWN_ERROR }));
        const _f = describeHttpError(res.status, d); throw new Error(_f.description);
      }
    },
    onSuccess: () => {
      void load();
      onRefresh();
    },
    errorPrefix: "删除失败",
  });

  // 线索集（CLUE）增删改
  const [newClueTag, setNewClueTag] = useState("");
  const [newClueContent, setNewClueContent] = useState("");
  const handleAddClue = async () => {
    if (!selected) return;
    if (!newClueContent.trim()) {
      toastError("线索内容不能为空");
      return;
    }
    try {
      const res = await fetch(`/api/storylines/${selected.id}/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "CLUE", tag: newClueTag.trim(), content: newClueContent.trim() }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({ error: UNKNOWN_ERROR }));
        const _f = describeHttpError(res.status, d); toastError(`新增线索失败：${_f.description}`);
        return;
      }
      setNewClueTag("");
      setNewClueContent("");
      void load();
    } catch (err) {
      toastError("新增线索失败：" + (err instanceof Error ? err.message : "请重试"));
    }
  };
  const handleCluePatch = async (id: string, patch: Record<string, string>) => {
    try {
      const res = await fetch(`/api/storyline-events/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({ error: UNKNOWN_ERROR }));
        const _f = describeHttpError(res.status, d); toastError(`更新线索失败：${_f.description}`);
        return;
      }
      void load();
    } catch (err) {
      toastError("更新线索失败：" + (err instanceof Error ? err.message : "请重试"));
    }
  };
  const handleClueDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/storyline-events/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const d = await res.json().catch(() => ({ error: UNKNOWN_ERROR }));
        const _f = describeHttpError(res.status, d); toastError(`删除线索失败：${_f.description}`);
        return;
      }
      void load();
    } catch (err) {
      toastError("删除线索失败：" + (err instanceof Error ? err.message : "请重试"));
    }
  };

  // 七要素 inline 单字段 PATCH：查看态点卡片即改，无需进入 11 字段大表单
  const handleElementPatch = async (key: string, val: string | null) => {
    if (!selected) return;
    const cur =
      selected.sevenElements && typeof selected.sevenElements === "object"
        ? (selected.sevenElements as Record<string, string | null>)
        : {};
    const next = { ...cur, [key]: val };
    // 按类型过滤：主线只留三要素、支线只留七要素，清掉历史残留字段
    const cleaned = stripElements(next, selected.type);
    try {
      const res = await fetch(`/api/storylines/${selected.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: selected.title,
          description: selected.description ?? "",
          status: selected.status,
          type: selected.type,
          parentId: selected.type === "main" ? null : (selected.parentId ?? null),
          sevenElements: cleaned,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({ error: UNKNOWN_ERROR }));
        const _f = describeHttpError(res.status, d); toastError(`保存失败：${_f.description}`);
        return;
      }
      void load();
      onRefresh();
    } catch (err) {
      toastError("保存失败（网络错误）：" + (err instanceof Error ? err.message : "请重试"));
    }
  };

  // 七要素卡片失焦 / ⌘Enter 提交当前编辑
  const commitElement = () => {
    const k = editingKey;
    if (!k || k === "ending") {
      setEditingKey(null);
      return;
    }
    setEditingKey(null);
    handleElementPatch(k, draft);
  };

  // —— AI 中间态草稿编辑 ——
  const updateSuggestion = (idx: number, patch: Partial<StorylineSuggestion>) => {
    setGenSuggestions((prev) =>
      prev ? prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)) : prev,
    );
  };
  const updateSuggestionElement = (idx: number, key: string, val: string) => {
    setGenSuggestions((prev) =>
      prev
        ? prev.map((s, i) =>
            i === idx ? { ...s, sevenElements: { ...s.sevenElements, [key]: val } } : s,
          )
        : prev,
    );
  };

  return { list, setList, loading, setLoading, error, setError, collapsed, setCollapsed, showCleanup, setShowCleanup, cleaning, setCleaning, selectedId, setSelectedId, editing, setEditing, form, setForm, generating, setGenerating, saving, setSaving, activeTab, setActiveTab, editingKey, setEditingKey, draft, setDraft, roleMap, roleFilter, setRoleFilter, roleSavingFor, setRoleSavingFor, setRole, genSuggestions, setGenSuggestions, genExtra, setGenExtra, committing, setCommitting, genTask, setGenTask, pollRef, netErrCount, pollCount, startPolling, load, selected, mains, sides, resolveParent, orphanSides, sortedMains, abandonedCount, events, timelineEvents, ownClues, aggregatedClues, causalNodes, causalClues, updateField, handleToggleComplete, handleGenerate, handleCommitGen, startEdit, handleSave, cleanupAbandoned, deletingId, deleteStoryline, newClueTag, setNewClueTag, newClueContent, setNewClueContent, handleAddClue, handleCluePatch, handleClueDelete, handleElementPatch, commitElement, updateSuggestion, updateSuggestionElement };
}
