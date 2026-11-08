"use client";

/**
 * 游戏本详情（F6 跑团化 P0-1a）
 * 章节体系（一章一局）+ 轻量游戏循环（流式开场 / 选项 / 行动 / 收束归档）。
 * P0-1b 将把完整游戏页（粒子/背包/目标指定/语义 chips）适配进来替换本轻量循环。
 */

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Icon } from "@/components/ui/icons";
import { Button } from "@/components/ui/button";
import { LoadingDots } from "@/components/ui/States";
import { toastError, toastSuccess } from "@/components/ui/toast";

interface SagaChapter {
  id: string;
  index: number;
  title: string;
  outline: string | null;
  status: string; // active | archived
  wordCount: number;
  sessionId: string | null;
  sessionStatus: string | null;
  sessionRound: number;
  sessionWords: number;
}
interface SagaDetail {
  id: string;
  title: string;
  projectId: string | null;
  sourceBookName: string | null;
  playAsName: string | null;
  rollMode: string;
  chapters: SagaChapter[];
}
interface GameOption { index: number; text: string; }

function SagaDetailInner() {
  const { sagaId } = useParams<{ sagaId: string }>();
  const router = useRouter();

  const [saga, setSaga] = useState<SagaDetail | null>(null);
  const [notFound, setNotFound] = useState(false);
  // 轻量游戏循环状态
  const [activeChapter, setActiveChapter] = useState<SagaChapter | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "generating" | "playing">("idle");
  const [narrative, setNarrative] = useState("");
  const [streamed, setStreamed] = useState("");
  const [options, setOptions] = useState<GameOption[]>([]);
  const [customInput, setCustomInput] = useState("");
  const [chapterTitle, setChapterTitle] = useState("");
  const [chapterOutline, setChapterOutline] = useState("");
  const [showNewChapter, setShowNewChapter] = useState(false);
  const streamRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/game/saga/${sagaId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "加载失败");
      setSaga(data.saga);
    } catch {
      setNotFound(true);
    }
  }, [sagaId]);

  useEffect(() => { load(); }, [load]);

  // ── SSE 通用消费（start / action 共用）──
  const consumeSSE = useCallback(async (res: Response, onDone: (data: any) => void) => {
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let streamedText = "";
    let done: any = null;
    while (true) {
      const { done: eof, value } = await reader.read();
      if (eof) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        try {
          const event = JSON.parse(line.slice(6));
          if (event.type === "token") {
            streamedText += event.content || "";
            setStreamed(streamedText);
          } else if (event.type === "start_done" || event.type === "game_done") {
            done = event;
          } else if (event.type === "error") {
            throw new Error(event.content || event.error || "未知错误");
          }
        } catch (e: any) {
          if (e.message && !e.message.includes("JSON")) throw e;
        }
      }
    }
    if (!done) throw new Error("未收到结果");
    onDone(done);
  }, []);

  // ── 开始本章（开场叙事）──
  const startChapter = async (chapter: SagaChapter) => {
    setActiveChapter(chapter);
    setStatus("generating");
    setNarrative("");
    setStreamed("");
    setOptions([]);
    const controller = new AbortController();
    streamRef.current = controller;
    try {
      const res = await fetch("/api/game/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sagaId, sagaChapterId: chapter.id }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "未知错误" }));
        throw new Error(err.error || "开场失败");
      }
      await consumeSSE(res, (done) => {
        setSessionId(done.sessionId);
        setStatus("playing");
        setNarrative(done.narrative || "");
        setOptions(done.options || []);
        setStreamed("");
        load(); // 刷新章节列表（会话状态）
      });
    } catch (e: any) {
      if (e.name !== "AbortError") toastError(e.message || "开场失败");
      setStatus("idle");
    }
  };

  // ── 执行行动 ──
  const act = async (actionType: string, actionText: string, selectedOption?: number) => {
    if (!sessionId || status !== "playing") return;
    setStatus("generating");
    setStreamed("");
    const controller = new AbortController();
    streamRef.current = controller;
    try {
      const res = await fetch("/api/game/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, actionType, actionText, selectedOption }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "未知错误" }));
        throw new Error(err.error || "行动失败");
      }
      await consumeSSE(res, (done) => {
        setStatus("playing");
        setNarrative((prev) => (prev ? `${prev}\n\n${done.narrative}` : done.narrative));
        setOptions(done.options || []);
        setStreamed("");
        load();
      });
    } catch (e: any) {
      if (e.name !== "AbortError") toastError(e.message || "行动失败");
      setStatus("playing");
    }
  };

  // ── 收束本章（归档）──
  const endChapter = async () => {
    if (!sessionId || !activeChapter) return;
    if (!confirm(`收束《${activeChapter.title}》？本章正文将归档进游戏本，之后不可再行动。`)) return;
    setStatus("generating");
    try {
      const res = await fetch("/api/game/end", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "收束失败");
      toastSuccess("本章已收束归档");
      setStatus("idle");
      setActiveChapter(null);
      setSessionId(null);
      load();
    } catch (e: any) {
      toastError(e.message || "收束失败");
      setStatus("playing");
    }
  };

  // ── 新章 ──
  const createChapter = async () => {
    try {
      const res = await fetch(`/api/game/saga/${sagaId}/chapter`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: chapterTitle.trim() || undefined, outline: chapterOutline.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "新建失败");
      toastSuccess("新章已建");
      setShowNewChapter(false);
      setChapterTitle("");
      setChapterOutline("");
      load();
    } catch (e: any) {
      toastError(e.message || "新建失败");
    }
  };

  const renameChapter = async (c: SagaChapter) => {
    const t = prompt("修改章节名", c.title);
    if (!t || !t.trim()) return;
    await fetch(`/api/game/saga/${sagaId}/chapter/${c.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: t.trim() }),
    });
    load();
  };

  const deleteChapter = async (c: SagaChapter) => {
    if (!confirm(`删除第 ${c.index} 章「${c.title}」？其全部轮次${c.status === "archived" ? "与正文" : ""}将一并删除。`)) return;
    await fetch(`/api/game/saga/${sagaId}/chapter/${c.id}`, { method: "DELETE" });
    if (activeChapter?.id === c.id) { setActiveChapter(null); setSessionId(null); setStatus("idle"); }
    load();
  };

  if (notFound) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-20 text-center">
        <p className="text-sm text-[var(--nv-text-secondary)]">游戏本不存在或已删除</p>
        <Button onClick={() => router.push("/gamesaga")} className="btn-ghost mt-4 rounded-xl px-4 py-2 text-sm">返回游戏本</Button>
      </div>
    );
  }
  if (!saga) {
    return <div className="flex justify-center py-20"><LoadingDots label="加载游戏本" /></div>;
  }

  return (
    <div className="mx-auto flex h-screen max-w-6xl flex-col px-4 py-6">
      {/* 顶部 */}
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <button onClick={() => router.push("/gamesaga")} className="text-[var(--nv-text-muted)] hover:text-[var(--nv-text-primary)]" title="返回游戏本">
            <Icon name="arrowLeft" size={16} />
          </button>
          <div className="min-w-0">
            <h1 className="truncate text-lg font-bold text-[var(--nv-text-primary)]">{saga.title}</h1>
            <p className="text-xs text-[var(--nv-text-tertiary)]">
              {saga.sourceBookName ? `前传：《${saga.sourceBookName}》 · ` : ""}{saga.chapters.length} 章
              {saga.playAsName ? ` · 扮演 ${saga.playAsName}` : ""}
            </p>
          </div>
        </div>
        <Button onClick={() => setShowNewChapter((v) => !v)} className="btn-ghost h-8 shrink-0 rounded-lg px-3 text-xs">
          <Icon name="plus" size={12} /> 新章
        </Button>
      </div>

      {showNewChapter && (
        <div className="mb-4 space-y-2 rounded-xl border border-[var(--nv-border-2)] bg-[var(--nv-surface-2)]/50 p-4">
          <input value={chapterTitle} onChange={(e) => setChapterTitle(e.target.value)} placeholder="章节名（留空自动「第N章」）" className="input-glass w-full rounded-lg px-3 py-2 text-sm" />
          <textarea value={chapterOutline} onChange={(e) => setChapterOutline(e.target.value)} placeholder="本章章纲（可选：想让这一章发生什么）" rows={3} className="input-glass w-full rounded-lg px-3 py-2 text-sm" />
          <div className="flex gap-2">
            <Button onClick={createChapter} className="btn-primary rounded-lg px-4 py-1.5 text-xs">建章</Button>
            <Button onClick={() => setShowNewChapter(false)} className="btn-ghost rounded-lg px-4 py-1.5 text-xs">取消</Button>
          </div>
        </div>
      )}

      <div className="flex min-h-0 flex-1 gap-4">
        {/* 左栏：章节列表 */}
        <aside className="w-56 shrink-0 space-y-2 overflow-y-auto">
          {saga.chapters.map((c) => (
            <div
              key={c.id}
              className={`group rounded-xl border px-3 py-2.5 transition-colors ${
                activeChapter?.id === c.id
                  ? "border-[var(--nv-creative-soft)] bg-[var(--nv-creative-soft)]"
                  : c.status === "archived"
                    ? "border-[var(--nv-border-2)] bg-[var(--nv-surface-1)] opacity-70"
                    : "border-[var(--nv-border-2)] bg-[var(--nv-surface-2)]/50"
              }`}
            >
              <div className="flex items-center justify-between gap-1">
                <p className="truncate text-xs font-medium text-[var(--nv-text-primary)]">
                  {c.index}. {c.title}{c.status === "archived" ? " · 已收束" : ""}
                </p>
                <span className="flex shrink-0 gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                  <button onClick={() => renameChapter(c)} title="改名" className="text-[var(--nv-text-muted)] hover:text-[var(--nv-text-primary)]"><Icon name="pencil" size={10} /></button>
                  <button onClick={() => deleteChapter(c)} title="删除" className="text-[var(--nv-text-muted)] hover:text-[var(--nv-danger)]"><Icon name="trash" size={10} /></button>
                </span>
              </div>
              <p className="mt-0.5 text-[10px] text-[var(--nv-text-tertiary)]">
                {c.status === "archived" ? `${c.wordCount} 字` : c.sessionRound > 0 ? `第 ${c.sessionRound} 轮 · ${c.sessionWords} 字` : "未开始"}
              </p>
              {c.status !== "archived" && activeChapter?.id !== c.id && (
                <Button
                  onClick={() => startChapter(c)}
                  disabled={status === "generating"}
                  className="btn-ghost mt-1.5 h-6 w-full rounded-md px-2 text-[10px]"
                >
                  {c.sessionRound > 0 ? "重开本章" : "开始本章"}
                </Button>
              )}
            </div>
          ))}
        </aside>

        {/* 右侧：游戏循环（轻量版） */}
        <main className="flex min-w-0 flex-1 flex-col rounded-2xl border border-[var(--nv-border-2)] bg-[var(--nv-surface-1)] p-5">
          {!activeChapter ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
              <Icon name="gamepad" size={36} className="text-[var(--nv-creative)] opacity-60" />
              <p className="text-sm text-[var(--nv-text-secondary)]">从左侧选一章开始扮演</p>
              <p className="text-xs text-[var(--nv-text-tertiary)]">一章一局 · 收束后正文归档 · 新章自动继承前情</p>
            </div>
          ) : (
            <>
              <div className="mb-3 flex items-center justify-between">
                <p className="text-sm font-medium text-[var(--nv-text-primary)]">
                  第 {activeChapter.index} 章 · {activeChapter.title}
                </p>
                {status === "playing" && (
                  <Button onClick={endChapter} className="btn-ghost h-7 rounded-lg px-3 text-xs">收束本章</Button>
                )}
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto">
                {streamed ? (
                  <p className="whitespace-pre-wrap text-sm leading-7 text-[var(--nv-text-secondary)]">{streamed}</p>
                ) : narrative ? (
                  <p className="whitespace-pre-wrap text-sm leading-7 text-[var(--nv-text-secondary)]">{narrative}</p>
                ) : status === "generating" ? (
                  <LoadingDots label="剧情引擎启动中" />
                ) : null}
              </div>

              {/* 选项 + 行动区 */}
              {status === "playing" && (
                <div className="mt-3 space-y-2">
                  {options.length > 0 && (
                    <div className="grid grid-cols-2 gap-2">
                      {options.map((opt) => (
                        <button
                          key={opt.index}
                          onClick={() => act("option", `选择：${opt.text}`, opt.index)}
                          className="rounded-lg border border-[var(--nv-border-2)] bg-[var(--nv-surface-2)] px-3 py-2 text-left text-xs text-[var(--nv-text-secondary)] transition-colors hover:border-[var(--nv-creative-soft)] hover:bg-[var(--nv-creative-soft)] hover:text-[var(--nv-text-primary)]"
                        >
                          {opt.index}. {opt.text}
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="flex gap-2">
                    <input
                      value={customInput}
                      onChange={(e) => setCustomInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter" && customInput.trim()) { act("custom", customInput.trim()); setCustomInput(""); } }}
                      placeholder="描述你的行动…"
                      className="input-glass flex-1 rounded-lg px-3 py-2 text-sm"
                    />
                    <Button
                      onClick={() => { if (customInput.trim()) { act("custom", customInput.trim()); setCustomInput(""); } }}
                      disabled={!customInput.trim()}
                      className="btn-primary rounded-lg px-4 py-2 text-sm"
                    >
                      发送
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}

export default function SagaDetailPage() {
  return (
    <Suspense fallback={<div className="flex justify-center py-20"><LoadingDots label="加载" /></div>}>
      <SagaDetailInner />
    </Suspense>
  );
}
