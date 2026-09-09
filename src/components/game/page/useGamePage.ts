/**
 * 游戏模式页面：全部状态与业务逻辑（原 game/[nodeId]/page.tsx 主组件 84-626 行）
 * 抽成自定义 hook 后，页面只剩加载态早返回 + 主 JSX 编排。
 */

"use client";

import { asArray } from "@/lib/utils";
import { useState, useEffect, useCallback, useRef, useId } from "react";
import { useParams, useRouter } from "next/navigation";
import { useFocusTrap } from "@/hooks/use-focus-trap";
import { toastInfo } from "@/components/ui/toast";
import { describeStreamError, describeHttpError } from "@/lib/stream-error";
import type { GameParticlesHandle } from "@/components/game/GameParticles";
import type { GameOption, GameEntity, GameItem } from "@/core/game/types";
import { reconcileFromSummary, applyFrontendItemChanges } from "@/core/game/reconcile";
import type { GameState, TurnRecord } from "./types";
import { QUICK_ACTIONS, LEFT_TABS, RIGHT_TABS } from "./constants";

export function useGamePage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.projectId as string;
  const nodeId = params.nodeId as string;

  const [state, setState] = useState<GameState>({
    sessionId: null,
    status: "loading",
    currentRound: 0,
    totalWords: 0,
    plotProgress: 0,
    narrative: "",
    lastNarrative: "",
    options: [],
    entities: [],
    items: [],
    bookName: "加载中...",
    chapterTitle: "加载中...",
    error: null,
    exportStatus: null,
    exportQuality: null,
  });

  const [customInput, setCustomInput] = useState("");
  const [turns, setTurns] = useState<TurnRecord[]>([]);
  const [rightTab, setRightTab] = useState<"text" | "backpack" | "world">("text");
  const [leftTab, setLeftTab] = useState<"plot" | "characters" | "factions">("plot");
  const [endingNarrative, setEndingNarrative] = useState("");
  const [showOutlineEditor, setShowOutlineEditor] = useState(false);
  const [nodeOutline, setNodeOutline] = useState<string | null>(null);
  // v0.46.58：首次进入教程（localStorage 记忆）
  const [showTutorial, setShowTutorial] = useState(() => {
    try { return localStorage.getItem("nf-game-tutorial-seen") !== "1"; } catch { return true; }
  });
  const [lorebook, setLorebook] = useState<any[]>([]);
  // 结束导出「影子确认」浮层 + 自动定稿开关（从项目设置读取，确认浮层如实展示）
  const [showEndConfirm, setShowEndConfirm] = useState(false);
  const [autoConfirmEnabled, setAutoConfirmEnabled] = useState(true);
  const [leftDrawerOpen, setLeftDrawerOpen] = useState(false);
  const [rightDrawerOpen, setRightDrawerOpen] = useState(false);
  // 无障碍：窄屏模态抽屉的焦点陷阱（仅抽屉打开时激活，桌面常驻侧栏不受影响）
  const leftDrawerRef = useRef<HTMLElement>(null);
  const rightDrawerRef = useRef<HTMLElement>(null);
  const leftDrawerTitleId = useId();
  const rightDrawerTitleId = useId();
  useFocusTrap(leftDrawerRef, leftDrawerOpen, () => setLeftDrawerOpen(false));
  useFocusTrap(rightDrawerRef, rightDrawerOpen, () => setRightDrawerOpen(false));
  const streamRef = useRef<AbortController | null>(null);

  // ── v0.46.78 新增：自动推进 / 检测粒子 / 构思开头 ──
  const [autoAdvance, setAutoAdvance] = useState(false);
  const autoAdvanceRef = useRef(false);
  const autoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const statusRef = useRef(state.status);
  const particlesRef = useRef<GameParticlesHandle>(null);
  const discoveryIdRef = useRef(0);
  const [discoveries, setDiscoveries] = useState<Array<{ id: number; label: string; color: string }>>([]);
  const [concept, setConcept] = useState<string | null>(null);
  const [conceptLoading, setConceptLoading] = useState(false);
  const [conceptError, setConceptError] = useState<string | null>(null);

  // ── 游戏模式多风格视觉（A 任务）：三模式 + 降噪/停动，localStorage 记忆 ──
  type GameTheme = "night" | "twilight" | "day";
  const [gameTheme, setGameTheme] = useState<GameTheme>(() => {
    try {
      const v = localStorage.getItem("nf-game-theme");
      return v === "night" || v === "twilight" || v === "day" ? v : "night";
    } catch { return "night"; }
  });
  const [denoise, setDenoise] = useState(() => {
    try { return localStorage.getItem("nf-game-denoise") === "1"; } catch { return false; }
  });
  const [paused, setPaused] = useState(() => {
    try { return localStorage.getItem("nf-game-paused") === "1"; } catch { return false; }
  });

  // ── 物品检测（C 任务）：新物品高亮集合 + 交易检测 + 音频 ──
  const [newItemKeys, setNewItemKeys] = useState<Set<string>>(new Set());
  const newItemKeysRef = useRef<Set<string>>(new Set());
  const [trades, setTrades] = useState<Array<{ id: number; label: string }>>([]);
  const tradeIdRef = useRef(0);
  const audioCtxRef = useRef<AudioContext | null>(null);
  // 背包分类：全部物品 / 角色物品（按 owner 区分）
  const [backpackFilter, setBackpackFilter] = useState<"all" | "char">("all");

  // 物品获得提示音（WebAudio，首次用户手势后可用）
  const playItemChime = useCallback(() => {
    try {
      if (!audioCtxRef.current) {
        const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        audioCtxRef.current = new AC();
      }
      const ac = audioCtxRef.current;
      if (ac.state === "suspended") void ac.resume();
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.type = "sine";
      o.frequency.setValueAtTime(740, ac.currentTime);
      o.frequency.exponentialRampToValueAtTime(1180, ac.currentTime + 0.12);
      g.gain.setValueAtTime(0.0001, ac.currentTime);
      g.gain.exponentialRampToValueAtTime(0.16, ac.currentTime + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + 0.34);
      o.connect(g);
      g.connect(ac.destination);
      o.start();
      o.stop(ac.currentTime + 0.36);
    } catch {
      /* 静默：部分浏览器禁用音频时不影响游戏 */
    }
  }, []);

  // 检测本轮新获得的物品（按 name|owner 二元组），触发辉光/声音/平移/提示
  const flagNewItems = useCallback(
    (prevItems: GameItem[], nextItems: GameItem[]) => {
      const prevKeys = new Set(prevItems.map((i) => `${i.name}|${i.owner || "主角"}`));
      const added = nextItems.filter((i) => !prevKeys.has(`${i.name}|${i.owner || "主角"}`));
      if (added.length === 0) return;
      playItemChime();
      const GLOW: Record<string, string> = {
        night: "167,139,250",
        twilight: "45,212,191",
        day: "99,102,241",
      };
      for (const it of added) {
        const key = `${it.name}|${it.owner || "主角"}`;
        const color = `rgb(${GLOW[gameTheme] ?? "167,139,250"})`;
        particlesRef.current?.emitBurst({ color, count: 14 });
        const id = ++discoveryIdRef.current;
        setDiscoveries((prev) => [...prev, { id, label: `获得物品·${it.name}`, color }]);
        setTimeout(() => setDiscoveries((prev) => prev.filter((d) => d.id !== id)), 3000);
        // 高亮 + 「新」徽章（背包内），2.6s 后淡出
        newItemKeysRef.current = new Set(newItemKeysRef.current).add(key);
        setNewItemKeys(new Set(newItemKeysRef.current));
        setTimeout(() => {
          newItemKeysRef.current = new Set([...newItemKeysRef.current].filter((k) => k !== key));
          setNewItemKeys(new Set(newItemKeysRef.current));
        }, 2600);
      }
      // 平移至右侧物品栏：自动切到背包页展示滑入动效
      setRightTab("backpack");
    },
    [playItemChime, gameTheme],
  );

  // 检测文本中的交易/买卖元素，分类提示
  const flagTrades = useCallback((text: string) => {
    if (!text) return;
    const kws = ["交易", "买卖", "购买", "出售", "贩卖", "收购", "卖出", "买入", "摆摊", "集市", "商铺", "钱庄", "典当", "金币", "银两", "铜钱", "议价", "成交"];
    const hit = kws.find((k) => text.includes(k));
    if (!hit) return;
    const id = ++tradeIdRef.current;
    setTrades((prev) => [...prev, { id, label: `交易·${hit}` }]);
    setTimeout(() => setTrades((prev) => prev.filter((t) => t.id !== id)), 3500);
  }, []);

  // 同步最新 status 给 setTimeout 回调读取（避免自动推进闭包读到旧值）
  useEffect(() => {
    statusRef.current = state.status;
  }, [state.status]);

  // 卸载时清理自动推进定时器
  useEffect(() => {
    return () => {
      if (autoTimerRef.current) clearTimeout(autoTimerRef.current);
    };
  }, []);

  // ── 初始化 ──────────────────────────────────────────────
  const initGame = useCallback(async () => {
    setState((s) => ({ ...s, status: "loading", error: null }));
    try {
      // 加载项目数据
      const projRes = await fetch(`/api/projects/${projectId}`);
      if (!projRes.ok) throw new Error("项目加载失败");
      const projData = await projRes.json();

      const node = projData.storyNodes?.find((n: any) => n.id === nodeId);
      if (!node) throw new Error("章节节点不存在");

      setState((s) => ({
        ...s,
        bookName: projData.name,
        chapterTitle: node.title || "未命名章节",
        status: "ready",
      }));

      setAutoConfirmEnabled(projData.autoConfirmEnabled ?? true);

      setNodeOutline(node.outline || null);
      setLorebook(projData.lorebookEntries || []);
      setTurns([]);
      setEndingNarrative("");
    } catch (err: any) {
      setState((s) => ({ ...s, status: "ready", error: err.message }));
    }
  }, [projectId, nodeId]);

  useEffect(() => { initGame(); }, [initGame]);

  // ── 开始游戏 ────────────────────────────────────────────
  // 检测新实体时：触发粒子爆发 + 顶部「发现」提示
  const fireDiscoveries = (list: Array<{ name: string; type?: string; color?: string }> | undefined) => {
    if (!list || list.length === 0) return;
    for (const ne of list) {
      const color = ne.color || "#E4B863"; // 品牌香槟金（--nv-gold）兜底，去紫离谱色
      particlesRef.current?.emitBurst({ color });
      const id = ++discoveryIdRef.current;
      const typeLabel = ne.type === "角色" ? "角色" : ne.type === "势力" ? "势力" : ne.type === "物品" ? "物品" : ne.type === "地点" ? "地点" : "实体";
      const label = `${typeLabel}·${ne.name}`;
      setDiscoveries((prev) => [...prev, { id, label, color }]);
      setTimeout(() => {
        setDiscoveries((prev) => prev.filter((d) => d.id !== id));
      }, 3000);
    }
  };

  // 构思开头：调用后端生成开场构思
  const handleConcept = async () => {
    setConceptLoading(true);
    setConceptError(null);
    try {
      const res = await fetch("/api/game/concept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, nodeId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "构思失败");
      setConcept(data.concept);
    } catch (err: any) {
      setConceptError(err.message || "构思失败");
    } finally {
      setConceptLoading(false);
    }
  };

  const handleStart = async (conceptText?: string) => {
    setState((s) => ({ ...s, status: "generating", error: null }));
    const controller = new AbortController();
    streamRef.current = controller;
    try {
      const res = await fetch("/api/game/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, nodeId, concept: conceptText || null }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({ error: "未知错误" }));
        const failure = describeHttpError(res.status, errData);
        setState((s) => ({ ...s, status: "ready", error: `${failure.title}：${failure.description}` }));
        return;
      }

      // 读取 SSE 流，逐 token 增量渲染开场叙事（不再整段空等）
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let streamedNarrative = "";
      let doneData: any = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const event = JSON.parse(line.slice(6));
              if (event.type === "token") {
                streamedNarrative += event.content || "";
                setState((s) => ({ ...s, lastNarrative: streamedNarrative }));
              } else if (event.type === "start_done") {
                doneData = event;
              } else if (event.type === "error") {
                throw new Error(event.content || event.error || "未知错误");
              }
            } catch (e: any) {
              if (e.message && !e.message.includes("JSON")) throw e;
            }
          }
        }
      }

      if (!doneData) throw new Error("未收到开场结果");

      setState((s) => ({
        ...s,
        sessionId: doneData.sessionId,
        status: "playing",
        currentRound: doneData.currentRound,
        totalWords: doneData.totalWords,
        plotProgress: doneData.plotProgress,
        narrative: doneData.narrative,
        lastNarrative: doneData.narrative,
        options: doneData.options || [],
        entities: doneData.newEntities || [],
        items: doneData.items ?? [],
      }));

      setTurns([
        { round: 1, playerAction: "开始游戏", actionType: "start", narrative: doneData.narrative },
      ]);

      // 开场即检测到的实体也来一波粒子
      fireDiscoveries(doneData.newEntities);
      // 开场即获得的物品：高亮 + 声音 + 平移背包；正文里的交易元素分类提示
      flagNewItems([], doneData.items ?? []);
      flagTrades(doneData.narrative);
      setConcept(null);
    } catch (err: any) {
      // 用户主动停止（abort）不算失败，回到 ready 等待重开；其余异常给出「人话 + 下一步」
      const failure = describeStreamError(err);
      setState((s) => ({ ...s, status: "ready", error: failure ? `${failure.title}：${failure.description}` : null }));
    }
  };

  // ── 对账：abort/停止后用后端权威态整体覆盖（阿游 P0-2）────────
  const reconcileWithBackend = useCallback(async () => {
    const sid = state.sessionId;
    if (!sid) return;
    try {
      const res = await fetch(
        `/api/game/state?sessionId=${encodeURIComponent(sid)}`,
        { method: "GET" }
      );
      const data = await res.json().catch(() => null);
      if (data?.ok && data?.summary) {
        const rc = reconcileFromSummary(data.summary);
        const { turns: rcTurns, ...rcState } = rc;
        setTurns(rcTurns);
        setState((s) => ({
          ...s,
          ...rcState,
          status: "playing",
          error: null,
          lastNarrative: "",
        }));
      }
    } catch {
      // 对账失败不阻断交互，导出前建议刷新
    }
  }, [state.sessionId]);

  // ── 执行行动 ────────────────────────────────────────────
  const handleAction = async (
    actionType: string,
    actionText: string,
    selectedOption?: number
  ) => {
    if (!state.sessionId || state.status !== "playing") return;

    setState((s) => ({ ...s, status: "generating", lastNarrative: "" }));
    const controller = new AbortController();
    streamRef.current = controller;

    try {
      const res = await fetch("/api/game/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: state.sessionId,
          actionType,
          actionText,
          selectedOption,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({ error: "未知错误" }));
        const failure = describeHttpError(res.status, errData);
        setState((s) => ({ ...s, status: "playing", error: `${failure.title}：${failure.description}` }));
        return;
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let streamedNarrative = "";
      let doneData: any = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const event = JSON.parse(line.slice(6));
              if (event.type === "token") {
                streamedNarrative += event.content || "";
                setState((s) => ({
                  ...s,
                  lastNarrative: streamedNarrative,
                }));
              } else if (event.type === "game_done") {
                doneData = event;
              } else if (event.type === "error") {
                throw new Error(event.content || event.error || "未知错误");
              }
            } catch (e: any) {
              if (e.message && !e.message.includes("JSON")) throw e;
            }
          }
        }
      }

      if (!doneData) throw new Error("未收到游戏回合结果");

      const newRound = state.currentRound + 1;
      const newTotalWords = state.totalWords + (doneData.wordCount || 0);
      const fullNarrative = state.narrative + "\n\n" + doneData.narrative;

      // 合并实体（去重）
      const mergedEntities = [...asArray<any>(state.entities)];
      for (const ne of doneData.newEntities || []) {
        if (!mergedEntities.find((e) => e.name === ne.name)) {
          mergedEntities.push(ne);
        }
      }

      // 更新背包：纯函数不可变更新（阿游 P1-1，避免原地改写 state.items 内部对象破坏 React 不可变更新）
      const updatedItems = applyFrontendItemChanges(
        state.items,
        doneData.itemChanges || [],
        newRound
      );

      setState((s) => ({
        ...s,
        status: "playing",
        currentRound: newRound,
        totalWords: newTotalWords,
        plotProgress: doneData.plotProgress || s.plotProgress,
        narrative: fullNarrative,
        lastNarrative: doneData.narrative,
        options: doneData.options || [],
        entities: mergedEntities,
        items: updatedItems,
      }));

      setTurns((prev) => [
        ...prev,
        {
          round: newRound,
          playerAction: actionText,
          actionType,
          narrative: doneData.narrative,
        },
      ]);

      // 检测本回合新实体：粒子爆发 + 发现提示
      fireDiscoveries(doneData.newEntities);
      // 本回合新物品：高亮 + 声音 + 平移背包；交易元素分类提示
      flagNewItems(state.items, updatedItems);
      flagTrades(doneData.narrative);

      // 自动推进：开启时，本轮结束后延迟触发下一轮「自动推进剧情」
      if (autoAdvanceRef.current) {
        if (autoTimerRef.current) clearTimeout(autoTimerRef.current);
        autoTimerRef.current = setTimeout(() => {
          if (autoAdvanceRef.current && statusRef.current === "playing" && state.sessionId) {
            handleAction("custom", "自动推进剧情");
          }
        }, 1400);
      }

      setCustomInput("");
    } catch (err: any) {
      // 用户停止/断网：后端可能已提交该轮，与后端权威态对账，避免前后端轮次/背包永久错位（阿游 P0-2）
      await reconcileWithBackend();
      // 用户主动停止（Abort）保持安静；其余异常给出「人话 + 下一步」
      const failure = describeStreamError(err);
      if (failure) {
        setState((s) => ({
          ...s,
          status: "playing",
          error: `${failure.title}：${failure.description}`,
        }));
      }
    }
  };

  // ── 停止生成 ────────────────────────────────────────────
  // abort 后等待后端权威态对账回拉（GET /api/game/state）覆盖前端，确保读到 abort 后的正确快照，
  // 再解锁为 playing，避免用户在对账在途时抢发行动放大竞态（阿游 P0-1 前端侧）。
  const handleStop = async () => {
    streamRef.current?.abort();
    // 停止生成即暂停自动推进循环
    if (autoTimerRef.current) clearTimeout(autoTimerRef.current);
    autoAdvanceRef.current = false;
    setAutoAdvance(false);
    await reconcileWithBackend();
    setState((s) => ({ ...s, status: "playing" }));
  };

  // ── 结束并导出 ──────────────────────────────────────────
  const handleEnd = async () => {
    if (!state.sessionId) return;
    setState((s) => ({ ...s, status: "ending", error: null }));

    try {
      const res = await fetch("/api/game/end", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: state.sessionId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "导出失败");

      setEndingNarrative(data.finalContent);
      setState((s) => ({
        ...s,
        status: "ended",
        narrative: data.finalContent,
        totalWords: data.totalWords,
        exportStatus: data.status ?? null,
        exportQuality: data.qualityScore ?? null,
      }));
      // IMP-003：游戏导出触发自动回填设定库时，给出明确提示，避免静默改动世界观设定
      if (data.autoFilled) {
        toastInfo("游戏导出已自动回填设定库（可在创意工坊查看/修订）");
      }
    } catch (err: any) {
      setState((s) => ({ ...s, status: "playing", error: err.message }));
    }
  };

  // ── 返回工作区 ──────────────────────────────────────────
  const handleBack = () => {
    router.push(`/workspace/${projectId}`);
  };


  const showStartScreen =
    state.status === "ready" || (state.status === "ended" && !state.narrative);

  return { params, router, projectId, nodeId, state, setState, customInput, setCustomInput, turns, setTurns, rightTab, setRightTab, leftTab, setLeftTab, endingNarrative, setEndingNarrative, showOutlineEditor, setShowOutlineEditor, nodeOutline, setNodeOutline, showTutorial, setShowTutorial, lorebook, setLorebook, showEndConfirm, setShowEndConfirm, autoConfirmEnabled, setAutoConfirmEnabled, leftDrawerOpen, setLeftDrawerOpen, rightDrawerOpen, setRightDrawerOpen, leftDrawerRef, rightDrawerRef, leftDrawerTitleId, rightDrawerTitleId, streamRef, autoAdvance, setAutoAdvance, autoAdvanceRef, autoTimerRef, statusRef, particlesRef, discoveryIdRef, discoveries, setDiscoveries, concept, setConcept, conceptLoading, setConceptLoading, conceptError, setConceptError, gameTheme, setGameTheme, denoise, setDenoise, paused, setPaused, newItemKeys, setNewItemKeys, newItemKeysRef, trades, setTrades, tradeIdRef, audioCtxRef, backpackFilter, setBackpackFilter, playItemChime, flagNewItems, flagTrades, initGame, fireDiscoveries, handleConcept, handleStart, reconcileWithBackend, handleAction, handleStop, handleEnd, handleBack, showStartScreen };
}
