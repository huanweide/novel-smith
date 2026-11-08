"use client";

/**
 * 游戏本详情（F6 跑团化 P0-1a + 两段式骰子）
 * 章节体系（一章一局）+ 轻量游戏循环（流式开场 / 选项 / 行动 / 收束归档）。
 * 骰子两段式：对抗行动先掷骰（悬浮动画+可重骰），点「继续」才生成叙事——动画不阻塞页面操作。
 */

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Icon } from "@/components/ui/icons";
import { Button } from "@/components/ui/button";
import { LoadingDots } from "@/components/ui/States";
import { toastError, toastSuccess } from "@/components/ui/toast";
import { isConfrontationalAction } from "@/core/game/game-prompts";
import GameParticles from "@/components/game/GameParticles";

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
  playAsCharacterId: string | null;
  playAsName: string | null;
  rollMode: string;
  rollDifficulty: string;
  playAsCandidates: Array<{ id: string | null; name: string; role: string; brief: string }>;
  chapters: SagaChapter[];
}
interface GameOption { index: number; text: string; }
/** 两段式骰子浮层状态 */
interface DiceState {
  rolling: boolean;
  result: { d100: number; label: string; successRate: number; reasons: string[]; rerollsLeft: number; rerollMax: number } | null;
}

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
  // 骰子结果卡（跑团模式，P0-4 + 检定官明细）
  const [rollInfo, setRollInfo] = useState<{ d100: number; label: string; successRate?: number; reasons?: string[] } | null>(null);
  // 两段式骰子浮层（悬浮动画 + 重骰 + 继续）
  const [dice, setDice] = useState<DiceState | null>(null);
  const [diceTick, setDiceTick] = useState(0);
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

  // 骰子滚动期：数字快速跳动（不知道结果——等它判定的爽感）
  useEffect(() => {
    if (!dice?.rolling) return;
    const t = setInterval(() => setDiceTick(1 + Math.floor(Math.random() * 100)), 90);
    return () => clearInterval(t);
  }, [dice?.rolling]);

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
          } else if (event.type === "roll") {
            setRollInfo({ d100: event.d100, label: event.label, successRate: event.successRate, reasons: event.reasons });
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
    setRollInfo(null);
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

  // ── 行动入口（两段式分流）：跑团+对抗 → 先掷骰（动画+可重骰），点「继续」才叙事 ──
  const pendingActionRef = useRef<{ actionType: string; actionText: string; selectedOption?: number } | null>(null);

  const act = async (actionType: string, actionText: string, selectedOption?: number) => {
    if (!sessionId || status !== "playing") return;
    if (saga?.rollMode === "tabletop" && isConfrontationalAction(actionType, actionText)) {
      pendingActionRef.current = { actionType, actionText, selectedOption };
      setDice({ rolling: true, result: null });
      await doRoll(false);
      return;
    }
    await runAction(actionType, actionText, selectedOption, undefined);
  };

  // ── 掷骰（第一段）：/api/game/roll，动画 1.6s 后揭晓；isReroll 消耗次数 ──
  const doRoll = async (isReroll: boolean) => {
    const p = pendingActionRef.current;
    if (!p) return;
    try {
      const res = await fetch("/api/game/roll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sagaId, actionType: p.actionType, actionText: p.actionText, isReroll }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "掷骰失败");
      if (data.skipped) {
        // 非对抗/自由模式兜底：直接叙事
        setDice(null);
        await runAction(p.actionType, p.actionText, p.selectedOption, undefined);
        return;
      }
      // 悬浮动画 1.6 秒后揭晓（期间页面完全可操作）
      setTimeout(() => {
        setDice({ rolling: false, result: { d100: data.d100, label: data.label, successRate: data.successRate, reasons: data.reasons || [], rerollsLeft: data.rerollsLeft, rerollMax: data.rerollMax } });
      }, 1600);
    } catch (e: any) {
      toastError(e.message || "掷骰失败");
      setDice(null);
    }
  };

  // ── 重骰：消耗次数重掷 ──
  const reroll = async () => {
    setDice({ rolling: true, result: null });
    await doRoll(true);
  };

  // ── 继续（第二段）：带预掷结果生成叙事 ──
  const continueAfterRoll = async () => {
    const p = pendingActionRef.current;
    const d = dice?.result;
    if (!p || !d) return;
    pendingActionRef.current = null;
    setDice(null);
    await runAction(p.actionType, p.actionText, p.selectedOption, { d100: d.d100, successRate: d.successRate, reasons: d.reasons });
  };

  // ── 执行行动（第二段本体）──
  const runAction = async (
    actionType: string,
    actionText: string,
    selectedOption: number | undefined,
    preRolled: { d100: number; successRate: number; reasons?: string[] } | undefined
  ) => {
    if (!sessionId || status !== "playing") return;
    setStatus("generating");
    setStreamed("");
    setRollInfo(null);
    const controller = new AbortController();
    streamRef.current = controller;
    try {
      const res = await fetch("/api/game/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, actionType, actionText, selectedOption, preRolled }),
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

  // ── 收束本章 → 自动建下一章 → 自动开始（连续扮演：一键无缝进入下一章）──
  const continueNextChapter = async () => {
    if (!sessionId || !activeChapter) return;
    setStatus("generating");
    try {
      const res = await fetch("/api/game/end", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "收束失败");
      // 自动建下一章（index 自动递增，前情提要由引擎自动注入开场）
      const cres = await fetch(`/api/game/saga/${sagaId}/chapter`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const cdata = await cres.json();
      if (!cres.ok) throw new Error(cdata.error || "开新章失败");
      toastSuccess(`第 ${activeChapter.index} 章已收束，继续第 ${cdata.chapter.index} 章`);
      setActiveChapter(null);
      setSessionId(null);
      await load();
      // 无缝续玩
      await startChapter({ ...cdata.chapter, wordCount: 0, sessionRound: 0, sessionWords: 0, sessionId: null, sessionStatus: null });
    } catch (e: any) {
      toastError(e.message || "续章失败");
      setStatus("playing");
    }
  };

  // ── 只收束不续章（想停下来时用）──
  const endOnly = async () => {
    if (!sessionId) return;
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

  // ── 扮演设置（P0-3）：选谁由你来演（局级设置，下一章生效）──
  const setPlayAs = async (name: string) => {
    try {
      const res = await fetch(`/api/game/saga/${sagaId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(name ? { playAsName: name, playAsCharacterId: saga?.playAsCandidates.find((c) => c.name === name)?.id ?? null } : { playAsName: null, playAsCharacterId: null }),
      });
      if (!res.ok) throw new Error("设置失败");
      toastSuccess(name ? `下一章起你将扮演「${name}」` : "已恢复默认主角视角");
      load();
    } catch (e: any) {
      toastError(e.message || "设置失败");
    }
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
    <div
      data-game-theme="night"
      className="game-root relative flex h-screen flex-col overflow-hidden bg-[var(--nv-void)] text-[var(--nv-text-secondary)] font-sans"
    >
      {/* 星空粒子背景（吸收旧游戏模式的沉浸氛围） */}
      <div className="pointer-events-none absolute inset-0 z-0">
        <GameParticles theme="night" />
      </div>

      {/* 顶部：暗色玻璃 */}
      <div className="relative z-10 mb-3 flex items-center justify-between gap-3 border-b border-[var(--nv-border-2)] bg-[var(--nv-abyss)]/60 px-4 py-3 backdrop-blur-sm">
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
        <div className="flex shrink-0 items-center gap-2">
          {/* 交互模式开关（P0-4）：自由叙事 / 跑团检定 */}
          <select
            value={saga.rollMode || "free"}
            onChange={async (e) => {
              const mode = e.target.value;
              try {
                const res = await fetch(`/api/game/saga/${sagaId}`, {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ rollMode: mode }),
                });
                if (!res.ok) throw new Error();
                toastSuccess(mode === "tabletop" ? "跑团检定已开启：对抗行动将掷骰定结果" : "已切换为自由叙事模式");
                load();
              } catch {
                toastError("切换失败");
              }
            }}
            title="自由叙事=AI 裁决一切；跑团检定=对抗行动掷骰定结果，AI 只演不判"
            className="h-8 rounded-lg border border-[var(--nv-border-2)] bg-[var(--nv-surface-2)] px-2 text-xs text-[var(--nv-text-primary)] outline-none focus:border-[var(--nv-creative-soft)]"
          >
            <option value="free">模式：自由叙事（无骰子）</option>
            <option value="tabletop">模式：跑团检定（对抗掷骰）</option>
          </select>
          {/* 重骰难度档：简单=无限重骰 / 困难=3 次 / 真实=不可重骰 */}
          {saga.rollMode === "tabletop" && (
            <select
              value={saga.rollDifficulty || "hard"}
              onChange={async (e) => {
                try {
                  const res = await fetch(`/api/game/saga/${sagaId}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ rollDifficulty: e.target.value }),
                  });
                  if (!res.ok) throw new Error();
                  const label = e.target.value === "easy" ? "简单（无限重骰）" : e.target.value === "real" ? "真实（不可重骰）" : "困难（3 次重骰）";
                  toastSuccess(`难度已调为${label}`);
                  load();
                } catch {
                  toastError("切换失败");
                }
              }}
              title="简单=无限重骰；困难=每章 3 次重骰；真实=骰出什么是什么，不能重骰"
              className="h-8 rounded-lg border border-[var(--nv-border-2)] bg-[var(--nv-surface-2)] px-2 text-xs text-[var(--nv-text-primary)] outline-none focus:border-[var(--nv-creative-soft)]"
            >
              <option value="easy">难度：简单</option>
              <option value="hard">难度：困难</option>
              <option value="real">难度：真实</option>
            </select>
          )}
          {/* 扮演选择（P0-3） */}
          {saga.playAsCandidates.length > 0 && (
            <select
              value={saga.playAsName || ""}
              onChange={(e) => setPlayAs(e.target.value)}
              title="选择你扮演的角色（局级设置，下一章生效）"
              className="h-8 rounded-lg border border-[var(--nv-border-2)] bg-[var(--nv-surface-2)] px-2 text-xs text-[var(--nv-text-primary)] outline-none focus:border-[var(--nv-creative-soft)]"
            >
              <option value="">扮演：默认主角</option>
              {saga.playAsCandidates.map((c) => (
                <option key={c.name} value={c.name}>扮演：{c.name}{c.role ? `（${c.role}）` : ""}</option>
              ))}
            </select>
          )}
          <Button onClick={() => setShowNewChapter((v) => !v)} className="btn-ghost h-8 shrink-0 rounded-lg px-3 text-xs">
            <Icon name="plus" size={12} /> 新章
          </Button>
        </div>
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

      <div className="relative z-10 flex min-h-0 flex-1 gap-4 px-4 pb-4">
        {/* 左栏：章节列表（暗色玻璃） */}
        <aside className="w-56 shrink-0 space-y-2 overflow-y-auto rounded-2xl border border-[var(--nv-border-2)] bg-[var(--nv-abyss)]/50 p-2 backdrop-blur-sm">
          {saga.chapters.map((c) => (
            <div
              key={c.id}
              className={`group rounded-xl border px-3 py-2.5 transition-colors ${
                activeChapter?.id === c.id
                  ? "border-[var(--nv-creative-soft)] bg-[var(--nv-creative-soft)]"
                  : c.status === "archived"
                    ? "border-[var(--nv-border-2)] bg-[var(--nv-surface-2)]/30 opacity-70"
                    : "border-[var(--nv-border-2)] bg-[var(--nv-surface-2)]/40"
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

        {/* 右侧：游戏循环（暗色沉浸） */}
        <main className="flex min-w-0 flex-1 flex-col rounded-2xl border border-[var(--nv-border-2)] bg-[var(--nv-abyss)]/50 p-5 backdrop-blur-sm">
          {!activeChapter ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
              <div className="nv-glow-strong flex h-20 w-20 items-center justify-center rounded-3xl bg-[var(--nv-creative)]/15">
                <Icon name="gamepad" size={44} className="text-[var(--nv-creative)]" />
              </div>
              <div>
                <p className="text-xl font-bold text-[var(--nv-text-primary)]">游戏本已就绪</p>
                <p className="mt-1.5 text-sm text-[var(--nv-text-secondary)]">从左侧选一章，化身角色亲历这段剧情</p>
              </div>
              <p className="text-xs text-[var(--nv-text-tertiary)]">
                一章一局 · 收束后正文归档 · 新章自动继承前情{saga.rollMode === "tabletop" ? " · 跑团检定已开启" : ""}
              </p>
            </div>
          ) : (
            <>
              <div className="mb-3 flex items-center justify-between">
                <p className="text-sm font-medium text-[var(--nv-text-primary)]">
                  第 {activeChapter.index} 章 · {activeChapter.title}
                </p>
                {rollInfo && (
                  <span
                    className="max-w-[46%] truncate rounded-lg border border-[var(--nv-creative-soft)] bg-[var(--nv-creative-soft)] px-2.5 py-1 text-xs text-[var(--nv-text-primary)]"
                    title={`检定：d100=${rollInfo.d100}，成功率=${rollInfo.successRate ?? "?"}%（${(rollInfo.reasons || []).join("；")}）——结果既定，AI 只演不判`}
                  >
                    🎲 d100={rollInfo.d100} / 成功率{rollInfo.successRate ?? "?"}% · {rollInfo.label}
                  </span>
                )}
                {status === "playing" && (
                  <div className="flex items-center gap-2">
                    <Button onClick={endOnly} className="btn-ghost h-7 rounded-lg px-3 text-xs" title="本章归档，停在这里">停下</Button>
                    <Button onClick={continueNextChapter} className="btn-primary h-7 rounded-lg px-3 text-xs" title="收束本章并无缝开启下一章（前情自动继承）">
                      继续下一章 <Icon name="arrowRight" size={12} />
                    </Button>
                  </div>
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

      {/* ── 骰子悬浮判定（两段式）：右下角小面板，动画期间页面完全可操作 ── */}
      {dice && (
        <div className="dice-panel-in fixed bottom-24 right-6 z-[90] w-64 rounded-2xl border border-[var(--nv-border-3)] bg-[var(--nv-abyss)]/95 shadow-2xl backdrop-blur-md">
          {dice.rolling ? (
            <div className="flex flex-col items-center gap-2 py-2">
              <span className="dice-tumbling text-4xl" aria-hidden>🎲</span>
              <p className="font-mono text-2xl text-[var(--nv-text-muted)]">{diceTick}</p>
              <p className="text-xs text-[var(--nv-text-tertiary)]">命运骰子滚动中……</p>
            </div>
          ) : dice.result ? (
            <div className="space-y-2">
              <div className="dice-reveal flex items-baseline justify-center gap-2">
                <span className={`font-mono text-3xl font-bold ${
                  dice.result.label === "失败" || dice.result.label === "大失败"
                    ? "text-[var(--nv-danger)]"
                    : dice.result.label === "勉强成功"
                      ? "text-[var(--nv-warning)]"
                      : "text-[var(--nv-success)]"
                }`}>
                  {dice.result.d100}
                </span>
                <span className="text-sm font-medium text-[var(--nv-text-primary)]">{dice.result.label}</span>
              </div>
              <p className="text-center text-xs text-[var(--nv-text-tertiary)]">
                成功率 {dice.result.successRate}%{dice.result.reasons.length > 0 ? ` · ${dice.result.reasons[0]}` : ""}
              </p>
              {dice.result.reasons.length > 1 && (
                <p className="text-center text-[10px] leading-4 text-[var(--nv-text-muted)]" title={dice.result.reasons.join("；")}>
                  {dice.result.reasons.slice(1, 3).join("；")}
                </p>
              )}
              <div className="flex items-center justify-between gap-2 pt-1">
                {dice.result.rerollMax !== 0 && (dice.result.rerollMax === -1 || dice.result.rerollsLeft > 0) ? (
                  <button
                    onClick={reroll}
                    className="rounded-lg border border-[var(--nv-border-2)] px-2.5 py-1 text-xs text-[var(--nv-text-secondary)] transition-colors hover:border-[var(--nv-creative-soft)] hover:text-[var(--nv-text-primary)]"
                    title="不服就再掷一次"
                  >
                    重骰 {dice.result.rerollMax === -1 ? "∞" : `剩 ${dice.result.rerollsLeft}`}
                  </button>
                ) : (
                  <span className="text-[10px] text-[var(--nv-text-muted)]">真实模式 · 骰出什么是什么</span>
                )}
                <Button onClick={continueAfterRoll} className="btn-primary h-7 rounded-lg px-3 text-xs">
                  继续 <Icon name="arrowRight" size={11} />
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      )}
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
