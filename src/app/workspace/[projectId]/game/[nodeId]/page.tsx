"use client";

/**
 * 游戏模式页面 —— 沉浸式互动文本冒险
 *
 * 路由：/workspace/[projectId]/game/[nodeId]
 * 独立的暗黑沉浸式 UI，与 workspace 主页面分离。
 * 视觉遵循「虚空玻璃 (Void Glass)」设计体系：以 --nv-void 为底，
 * surface 层级承载容器，--nv-creative(紫罗兰) 作为游戏主调，
 * 禁止 emoji、统一用 <Icon> 组件。
 *
 * 拆分说明：类型/常量/状态逻辑已迁至 @/components/game/page/{types,constants,useGamePage}，
 * 本文件只保留加载态早返回与主 JSX 编排。
 */

import { asArray } from "@/lib/utils";
import { useState, useEffect, useCallback, useRef, useId } from "react";
import { useParams, useRouter } from "next/navigation";
import GameCanvas from "@/components/game/GameCanvas";
import GameParticles, { type GameParticlesHandle } from "@/components/game/GameParticles";
import GameOutlineEditor from "@/components/game/GameOutlineEditor";
import { PointerGlow } from "@/components/game/PointerGlow";
import { Icon, type IconName } from "@/components/ui/icons";
import { EmptyState, LoadingDots } from "@/components/ui/States";
import { Modal } from "@/components/ui/Modal";
import { toastInfo } from "@/components/ui/toast";
import { describeStreamError, describeHttpError } from "@/lib/stream-error";
import { useFocusTrap } from "@/hooks/use-focus-trap";
import type { GameOption, GameEntity, GameItem } from "@/core/game/types";
import { reconcileFromSummary, applyFrontendItemChanges } from "@/core/game/reconcile";
import { useGamePage } from "@/components/game/page/useGamePage";
import type { GameState, TurnRecord } from "@/components/game/page/types";
import { QUICK_ACTIONS, LEFT_TABS, RIGHT_TABS } from "@/components/game/page/constants";

export default function GamePage() {
  const { params, router, projectId, nodeId, state, setState, customInput, setCustomInput, turns, setTurns, rightTab, setRightTab, leftTab, setLeftTab, endingNarrative, setEndingNarrative, showOutlineEditor, setShowOutlineEditor, nodeOutline, setNodeOutline, showTutorial, setShowTutorial, lorebook, setLorebook, showEndConfirm, setShowEndConfirm, autoConfirmEnabled, setAutoConfirmEnabled, leftDrawerOpen, setLeftDrawerOpen, rightDrawerOpen, setRightDrawerOpen, leftDrawerRef, rightDrawerRef, leftDrawerTitleId, rightDrawerTitleId, streamRef, autoAdvance, setAutoAdvance, autoAdvanceRef, autoTimerRef, statusRef, particlesRef, discoveryIdRef, discoveries, setDiscoveries, concept, setConcept, conceptLoading, setConceptLoading, conceptError, setConceptError, gameTheme, setGameTheme, denoise, setDenoise, paused, setPaused, newItemKeys, setNewItemKeys, newItemKeysRef, trades, setTrades, tradeIdRef, audioCtxRef, backpackFilter, setBackpackFilter, playItemChime, flagNewItems, flagTrades, initGame, fireDiscoveries, handleConcept, handleStart, reconcileWithBackend, handleAction, handleStop, handleEnd, handleBack, showStartScreen } = useGamePage();

  // ── 加载状态 ────────────────────────────────────────────
  if (state.status === "loading") {
    return (
      <div className="flex h-screen items-center justify-center bg-[var(--nv-void)]">
        <div className="surface-floating flex flex-col items-center gap-4 rounded-2xl px-12 py-14">
          <Icon name="gamepad" size={42} className="animate-pulse text-[var(--nv-creative)]" />
          <p className="text-lg text-[var(--nv-text-secondary)]">正在初始化游戏模式...</p>
          <LoadingDots label="接入故事引擎" />
        </div>
      </div>
    );
  }

  return (
    <div
      data-game-theme={gameTheme}
      className="game-root flex h-screen flex-col overflow-hidden font-sans text-[var(--nv-text-secondary)] animate-in fade-in"
    >
      <GameParticles ref={particlesRef} theme={gameTheme} denoise={denoise} paused={paused} />

      {/* 顶部进度条：开场 / 每轮生成 / 导出时显示（v0.46.78） */}
      {(state.status === "generating" || state.status === "ending") && (
        <div className="fixed left-0 right-0 top-0 z-[60] h-1 bg-[var(--nv-surface-2)]">
          <div className="nf-progress-indeterminate h-full w-1/3 rounded-r bg-gradient-to-r from-[var(--nv-creative)] to-[var(--nv-accent)]" />
        </div>
      )}

      {/* 导出覆盖层：收束并写入正文时（v0.46.78） */}
      {state.status === "ending" && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-[var(--nv-void)]/70 backdrop-blur-sm">
          <div className="surface-floating flex flex-col items-center gap-4 rounded-2xl px-12 py-14">
            <Icon name="loader" size={36} className="animate-spin text-[var(--nv-creative)]" />
            <p className="text-base text-[var(--nv-text-secondary)]">正在收束并导出本章正文…</p>
            <div className="h-1 w-48 overflow-hidden rounded bg-[var(--nv-surface-2)]">
              <div className="nf-progress-indeterminate h-full w-1/3 rounded bg-[var(--nv-creative)]" />
            </div>
          </div>
        </div>
      )}

      {/* 检测发现提示层（v0.46.78） */}
      {discoveries.length > 0 && (
        <div className="pointer-events-none fixed left-1/2 top-20 z-40 flex -translate-x-1/2 flex-col items-center gap-2">
          {discoveries.map((d) => (
            <div
              key={d.id}
              className="nf-discovery-pill flex items-center gap-1.5 rounded-full border bg-[var(--nv-surface-1)]/90 px-3 py-1 text-xs font-medium shadow-lg backdrop-blur-sm"
              style={{ borderColor: d.color, color: d.color }}
            >
              <Icon name="sparkles" size={12} />
              发现：{d.label}
            </div>
          ))}
        </div>
      )}
      {/* 交易/买卖检测提示（C 任务） */}
      {trades.length > 0 && (
        <div className="pointer-events-none fixed left-1/2 top-32 z-40 flex -translate-x-1/2 flex-col items-center gap-2">
          {trades.map((t) => (
            <div
              key={t.id}
              className="trade-pill flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium shadow-lg"
            >
              <Icon name="coins" size={12} />
              {t.label}
            </div>
          ))}
        </div>
      )}

      {/* ═══ 首次教程（v0.46.58） ═══ */}
      {showTutorial && (
        <Modal
          open
          onClose={() => {
            try { localStorage.setItem("nf-game-tutorial-seen", "1"); } catch { /* ignore */ }
            setShowTutorial(false);
          }}
          bare
          panelClassName="max-w-lg"
          labelledBy="game-tutorial-title"
        >
          <div className="p-6">
            <div className="mb-3 flex items-center gap-2">
              <Icon name="gamepad" size={22} className="text-[var(--nv-creative)]" />
              <h2 id="game-tutorial-title" className="text-lg font-bold text-[var(--nv-text-primary)]">游戏模式 · 跑团式互动创作</h2>
            </div>
            <div className="space-y-3 text-sm leading-relaxed text-[var(--nv-text-secondary)]">
              <p>
                游戏模式把「写这一章」变成一场<span className="text-[var(--nv-accent)] font-medium">互动跑团</span>：AI 扮演剧情引擎，每轮给你一段叙事和几个选项，你选择（或输入自由行动），剧情随之推进——边玩边把这一章写出来。
              </p>
              <div className="rounded-xl border border-[var(--nv-border-2)] bg-[var(--nv-surface-1)] p-3 space-y-1.5">
                <p className="text-xs font-medium text-[var(--nv-text-primary)]">怎么玩：</p>
                <p className="text-xs">① 点击「开始游戏」→ 阅读开场叙事 → ② 点选编号选项，或直接输入你的行动 → ③ 每轮剧情推进、字数累加 → ④ 随时回到工作区精修正文</p>
              </div>
              <div className="rounded-xl border border-[var(--nv-border-2)] bg-[var(--nv-surface-1)] p-3 space-y-1.5">
                <p className="text-xs font-medium text-[var(--nv-text-primary)]">与你的小说融合：</p>
                <p className="text-xs">本章已有正文会<span className="text-[var(--nv-success)]">带入游戏</span>（含原有字数）——游戏从现有内容之后续接，不推翻已写情节；世界观、角色卡、章纲全部生效，与工作区的设定实时联动。</p>
              </div>
              <p className="text-xs text-[var(--nv-text-tertiary)]">提示：右上角可随时查看背包/世界观/角色；「结束回合」后可将游戏叙事写入本章正文。</p>
            </div>
            <button
              onClick={() => {
                try { localStorage.setItem("nf-game-tutorial-seen", "1"); } catch { /* ignore */ }
                setShowTutorial(false);
              }}
              className="mt-5 w-full btn-primary rounded-xl py-2.5 text-sm font-medium"
            >
              开始冒险
            </button>
          </div>
        </Modal>
      )}

      {/* ═══ 顶栏 ═══ */}
      <header className="relative z-10 flex items-center justify-between border-b border-[var(--nv-border-2)] bg-[var(--nv-abyss)]/80 px-6 py-3 backdrop-blur-sm" inert={leftDrawerOpen || rightDrawerOpen}>
        <div className="flex items-center gap-4">
          <button
            onClick={handleBack}
            title="返回工作区"
            aria-label="返回工作区"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--nv-text-tertiary)] transition-colors hover:bg-[var(--nv-surface-2)] hover:text-[var(--nv-text-primary)]"
          >
            <Icon name="arrowLeft" size={18} />
          </button>
          <div>
            <h1 className="flex items-center gap-2 text-base font-semibold text-[var(--nv-text-primary)]">
              <Icon name="gamepad" size={18} className="nv-text-glow text-[var(--nv-creative)]" />
              游戏模式 — {state.bookName}
            </h1>
            <p className="text-xs text-[var(--nv-text-tertiary)]">
              第{state.currentRound || "?"}轮 · {state.chapterTitle}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 text-sm text-[var(--nv-text-tertiary)]">
          <button
            onClick={() => setShowOutlineEditor(!showOutlineEditor)}
            className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-all ${
              showOutlineEditor
                ? "border-[var(--nv-info)]/50 bg-[var(--nv-info-soft)] text-[var(--nv-info)]"
                : "border-[var(--nv-border-2)] text-[var(--nv-text-tertiary)] hover:border-[var(--nv-border-3)] hover:text-[var(--nv-text-primary)]"
            }`}
          >
            <Icon name="clipboard" size={14} /> 章纲
          </button>
          <span className="hidden sm:inline">轮次 {state.currentRound}</span>
          <span className="hidden sm:inline">字数 {state.totalWords}</span>
          {state.status === "playing" && (
            <button
              onClick={() => setShowEndConfirm(true)}
              className="nv-glow-strong btn-creative rounded-lg px-4 py-1.5 text-sm font-medium text-[var(--nv-text-primary)]"
            >
              结束并导出
            </button>
          )}
          {/* 游戏模式视觉：三模式切换 + 降噪/停动（A 任务） */}
          <div className="hidden items-center gap-1.5 md:flex">
            <div className="flex items-center gap-0.5 rounded-lg border border-[var(--nv-border-2)] bg-[var(--nv-surface-2)] p-0.5">
              {([
                { k: "twilight", icon: "cloud", label: "苍青" },
                { k: "day", icon: "sun", label: "白昼" },
                { k: "night", icon: "moon", label: "黑夜" },
              ] as const).map(({ k, icon, label }) => (
                <button
                  key={k}
                  onClick={() => { setGameTheme(k); try { localStorage.setItem("nf-game-theme", k); } catch { /* ignore */ } }}
                  title={`${label}模式`}
                  aria-label={`${label}模式`}
                  className={`flex h-7 w-7 items-center justify-center rounded-md transition-all ${
                    gameTheme === k
                      ? "bg-[var(--nv-creative)] text-[var(--nv-text-primary)]"
                      : "text-[var(--nv-text-tertiary)] hover:text-[var(--nv-text-primary)]"
                  }`}
                >
                  <Icon name={icon} size={14} />
                </button>
              ))}
            </div>
            <button
              onClick={() => { const n = !denoise; setDenoise(n); try { localStorage.setItem("nf-game-denoise", n ? "1" : "0"); } catch { /* ignore */ } }}
              title={denoise ? "降噪：已开启（粒子已压缩）" : "降噪：关闭"}
              aria-label="降噪开关"
              className={`flex h-7 w-7 items-center justify-center rounded-lg border transition-all ${
                denoise ? "border-[var(--nv-creative)] text-[var(--nv-creative)]" : "border-[var(--nv-border-2)] text-[var(--nv-text-tertiary)] hover:text-[var(--nv-text-primary)]"
              }`}
            >
              <Icon name="sliders" size={14} />
            </button>
            <button
              onClick={() => { const n = !paused; setPaused(n); try { localStorage.setItem("nf-game-paused", n ? "1" : "0"); } catch { /* ignore */ } }}
              title={paused ? "粒子已停动（点击恢复）" : "停动粒子（点击冻结）"}
              aria-label="停动开关"
              className={`flex h-7 w-7 items-center justify-center rounded-lg border transition-all ${
                paused ? "border-[var(--nv-creative)] text-[var(--nv-creative)]" : "border-[var(--nv-border-2)] text-[var(--nv-text-tertiary)] hover:text-[var(--nv-text-primary)]"
              }`}
            >
              <Icon name={paused ? "play" : "pause"} size={14} />
            </button>
          </div>
          {/* 窄屏：抽屉切换 */}
          <button
            onClick={() => setLeftDrawerOpen(o => !o)}
            className="lg:hidden flex items-center gap-1.5 rounded-lg border border-[var(--nv-border-2)] px-3 py-1.5 text-xs text-[var(--nv-text-tertiary)] transition-all hover:border-[var(--nv-border-3)] hover:text-[var(--nv-text-primary)] active:scale-95"
            title="切换左栏（窄屏）"
            aria-label="切换左栏（窄屏）"
          >
            <Icon name="sliders" size={13} />
          </button>
          <button
            onClick={() => setRightDrawerOpen(o => !o)}
            className="lg:hidden flex items-center gap-1.5 rounded-lg border border-[var(--nv-border-2)] px-3 py-1.5 text-xs text-[var(--nv-text-tertiary)] transition-all hover:border-[var(--nv-border-3)] hover:text-[var(--nv-text-primary)] active:scale-95"
            title="切换右栏（窄屏）"
            aria-label="切换右栏（窄屏）"
          >
            <Icon name="grid" size={13} />
          </button>
        </div>
      </header>

      {/* ═══ 主体三栏 ═══ */}
      <div className="relative z-10 flex flex-1 overflow-hidden">
        {/* 左侧栏 */}
        <aside
          ref={leftDrawerRef}
          tabIndex={-1}
          role={leftDrawerOpen ? "dialog" : undefined}
          aria-modal={leftDrawerOpen ? "true" : undefined}
          aria-labelledby={leftDrawerOpen ? leftDrawerTitleId : undefined}
          className={`flex w-52 shrink-0 flex-col border-r border-[var(--nv-border-2)] bg-[var(--nv-surface-1)] fixed inset-y-0 left-0 z-40 max-w-[85vw] h-full transition-transform duration-200 ${leftDrawerOpen ? "translate-x-0" : "-translate-x-full"} lg:static lg:z-auto lg:h-auto lg:shrink-0 lg:w-52 lg:translate-x-0 lg:transition-none`}
        >
          <h2 id={leftDrawerTitleId} className="sr-only">游戏侧栏</h2>
          <div className="flex border-b border-[var(--nv-border-2)]">
            {LEFT_TABS.map(({ key, label, icon }) => (
              <button
                key={key}
                onClick={() => setLeftTab(key)}
                className={`flex flex-1 items-center justify-center gap-1 py-2.5 text-xs font-medium transition-colors ${
                  leftTab === key
                    ? "border-b-2 border-[var(--nv-creative)] bg-[var(--nv-creative-soft)] text-[var(--nv-creative)]"
                    : "border-b-2 border-transparent text-[var(--nv-text-tertiary)] hover:text-[var(--nv-text-primary)]"
                }`}
              >
                <Icon name={icon} size={13} /> {label}
              </button>
            ))}
          </div>
          <div className="custom-scrollbar flex-1 overflow-y-auto p-3 text-xs">
            {leftTab === "plot" && (
              <div>
                <p className="mb-2 font-medium text-[var(--nv-text-primary)]">情节进度</p>
                <div className="mb-2 h-2 w-full overflow-hidden rounded-full bg-[var(--nv-surface-2)]">
                  <div
                    className="h-full rounded-full bg-[var(--nv-creative)] transition-all duration-700"
                    style={{ width: `${state.plotProgress}%` }}
                  />
                </div>
                <p className="text-right text-[var(--nv-creative)]">{state.plotProgress}%</p>
                {turns.length === 0 && (
                  <p className="mt-4 italic text-[var(--nv-text-muted)]">暂无情节点数据</p>
                )}
                {turns.map((t) => (
                  <div key={t.round} className="mt-2 rounded-lg border border-[var(--nv-border-2)] bg-[var(--nv-surface-2)] px-2 py-1.5">
                    <p className="text-[var(--nv-creative)]">第{t.round}轮</p>
                    <p className="mt-0.5 line-clamp-2 text-[var(--nv-text-tertiary)]">{t.playerAction}</p>
                  </div>
                ))}
              </div>
            )}
            {leftTab === "characters" && (
              <div>
                <p className="mb-2 font-medium text-[var(--nv-text-primary)]">本章角色</p>
                {state.entities.filter((e) => e.type === "角色").length === 0 && (
                  <p className="italic text-[var(--nv-text-muted)]">暂无角色数据</p>
                )}
                {state.entities
                  .filter((e) => e.type === "角色")
                  .map((e) => (
                    <div
                      key={e.name}
                      className="mt-2 rounded-lg border border-[var(--nv-border-2)] bg-[var(--nv-surface-2)] px-2 py-1.5"
                    >
                      <p className="flex items-center gap-1.5 text-[var(--nv-text-primary)]">
                        <Icon name="user" size={12} className="text-[var(--nv-text-tertiary)]" />
                        {e.name}
                      </p>
                      <p className="mt-0.5 text-[var(--nv-text-muted)]">{e.description}</p>
                    </div>
                  ))}
              </div>
            )}
            {leftTab === "factions" && (
              <div>
                <p className="mb-2 font-medium text-[var(--nv-text-primary)]">涉及势力</p>
                {state.entities.filter((e) => e.type === "势力").length === 0 && (
                  <p className="italic text-[var(--nv-text-muted)]">暂无势力数据</p>
                )}
                {state.entities
                  .filter((e) => e.type === "势力")
                  .map((e) => (
                    <div
                      key={e.name}
                      className="mt-2 rounded-lg border border-[var(--nv-border-2)] bg-[var(--nv-surface-2)] px-2 py-1.5"
                    >
                      <p className="flex items-center gap-1.5 text-[var(--nv-text-primary)]">
                        <Icon name="building" size={12} className="text-[var(--nv-text-tertiary)]" />
                        {e.name}
                      </p>
                    </div>
                  ))}
              </div>
            )}
          </div>
          {/* 左侧底部控制 */}
          <div className="space-y-2 border-t border-[var(--nv-border-2)] p-3">
            <button
              onClick={async () => {
                // 回退：移除最后一轮，并同步后端删除该轮及之后所有 gameState、回滚 session（阿游 P0-1）
                if (turns.length > 1) {
                  const lastRound = turns[turns.length - 1].round;
                  const sid = state.sessionId;
                  const newTurns = turns.slice(0, -1);
                  setTurns(newTurns);
                  if (sid) {
                    try {
                      const res = await fetch(`/api/game/state?sessionId=${encodeURIComponent(sid)}&round=${lastRound}`, { method: "DELETE" });
                      const data = await res.json().catch(() => null);
                      // P1：优先用后端 rollback 后的权威摘要整体覆盖前端态，避免错位（字数虚高/背包残留）
                      if (data?.ok && data?.summary) {
                        const sm = data.summary;
                        setState((s) => ({
                          ...s,
                          currentRound: sm.currentRound,
                          totalWords: sm.totalWords,
                          plotProgress: sm.plotProgress,
                          items: sm.items || [],
                          entities: sm.entities || [],
                          narrative: sm.narrative || newTurns.map((t) => t.narrative).join("\n\n"),
                          options: sm.options || [],
                        }));
                      } else {
                        // 后端未返回摘要（老接口/异常）：按前端剩余轮次重建，保证不崩
                        const newNarrative = newTurns.map((t) => t.narrative).join("\n\n");
                        setState((s) => ({
                          ...s,
                          narrative: newNarrative,
                          currentRound: newTurns.length,
                          options: [],
                        }));
                      }
                    } catch {
                      // 后端回退失败不阻断前端回退，但导出前建议刷新对账
                      const newNarrative = newTurns.map((t) => t.narrative).join("\n\n");
                      setState((s) => ({
                        ...s,
                        narrative: newNarrative,
                        currentRound: newTurns.length,
                        options: [],
                      }));
                    }
                  } else {
                    const newNarrative = newTurns.map((t) => t.narrative).join("\n\n");
                    setState((s) => ({
                      ...s,
                      narrative: newNarrative,
                      currentRound: newTurns.length,
                      options: [],
                    }));
                  }
                }
              }}
              disabled={turns.length <= 1}
              className="w-full rounded-lg border border-[var(--nv-border-2)] bg-[var(--nv-surface-2)] py-1.5 text-xs font-medium text-[var(--nv-text-secondary)] transition-all hover:border-[var(--nv-border-3)] hover:text-[var(--nv-text-primary)] active:scale-95 disabled:cursor-not-allowed disabled:opacity-30"
            >
              回退
            </button>
            <button
              onClick={() => {
                const next = !autoAdvance;
                setAutoAdvance(next);
                autoAdvanceRef.current = next;
                if (!next && autoTimerRef.current) clearTimeout(autoTimerRef.current);
              }}
              disabled={state.status !== "playing"}
              className={`w-full rounded-lg border py-1.5 text-xs font-medium transition-all active:scale-95 disabled:cursor-not-allowed disabled:opacity-30 ${
                autoAdvance
                  ? "border-[var(--nv-creative)] bg-[var(--nv-creative-soft)] text-[var(--nv-creative)]"
                  : "border-[var(--nv-border-2)] bg-[var(--nv-surface-2)] text-[var(--nv-text-secondary)] hover:border-[var(--nv-border-3)] hover:text-[var(--nv-text-primary)]"
              }`}
              title="开启后每轮结束自动推进剧情；点停止生成即暂停"
            >
              {autoAdvance ? "● 自动推进中" : "自动推进"}
            </button>
          </div>
        </aside>

        {/* 主画布 */}
        <main className="flex flex-1 flex-col overflow-hidden" inert={leftDrawerOpen || rightDrawerOpen}>
          {showStartScreen ? (
            /* 开始界面 */
            <div className="flex flex-1 items-center justify-center p-6">
              <div className="surface-floating flex max-w-md flex-col items-center rounded-3xl px-12 py-14 text-center">
                <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-2xl bg-[var(--nv-creative-soft)] text-[var(--nv-creative)]">
                  <Icon name="gamepad" size={40} />
                </div>
                <h2 className="mb-2 text-2xl font-bold text-[var(--nv-text-primary)]">游戏模式已就绪</h2>
                <p className="mb-1 text-[var(--nv-text-secondary)]">
                  章节：{state.chapterTitle}
                </p>
                <p className="mb-8 text-sm text-[var(--nv-text-tertiary)]">
                  AI 将以互动方式与你共同创作本章正文
                </p>
                <div className="flex flex-col items-center gap-3">
                  <button
                    onClick={() => handleStart()}
                    className="nv-glow-strong btn-creative rounded-xl px-10 py-3 text-lg font-medium text-[var(--nv-text-primary)] shadow-[var(--shadow-glow-creative)] transition-all active:scale-95"
                  >
                    开始游戏
                  </button>
                  {state.status === "ready" && (
                    <button
                      onClick={handleConcept}
                      disabled={conceptLoading}
                      className="flex items-center gap-1.5 rounded-xl border border-[var(--nv-border-2)] px-6 py-2 text-sm font-medium text-[var(--nv-text-secondary)] transition-all hover:border-[var(--nv-creative)] hover:text-[var(--nv-creative)] active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Icon name="lightbulb" size={14} />
                      {conceptLoading ? "构思中…" : "构思开头"}
                    </button>
                  )}
                </div>

                {/* 构思结果卡片 */}
                {concept && (
                  <div className="mt-6 w-full max-w-md rounded-xl border border-[var(--nv-border-2)] bg-[var(--nv-surface-1)] p-4 text-left">
                    <p className="mb-1.5 text-xs font-medium text-[var(--nv-text-primary)]">AI 构思的开场</p>
                    <p className="whitespace-pre-wrap text-sm leading-relaxed text-[var(--nv-text-secondary)]">{concept}</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        onClick={() => handleStart(concept)}
                        className="rounded-lg bg-[var(--nv-creative)] px-4 py-1.5 text-xs font-medium text-[var(--nv-text-primary)] transition-all hover:brightness-110 active:scale-95"
                      >
                        采用此构思开场
                      </button>
                      <button
                        onClick={handleConcept}
                        disabled={conceptLoading}
                        className="rounded-lg border border-[var(--nv-border-2)] px-4 py-1.5 text-xs font-medium text-[var(--nv-text-secondary)] transition-all hover:border-[var(--nv-border-3)] hover:text-[var(--nv-text-primary)] active:scale-95 disabled:opacity-50"
                      >
                        重新构思
                      </button>
                      <button
                        onClick={() => { setConcept(null); handleStart(); }}
                        className="rounded-lg border border-[var(--nv-border-2)] px-4 py-1.5 text-xs font-medium text-[var(--nv-text-secondary)] transition-all hover:border-[var(--nv-border-3)] hover:text-[var(--nv-text-primary)] active:scale-95"
                      >
                        不用，直接开始
                      </button>
                    </div>
                  </div>
                )}
                {conceptError && (
                  <p className="mt-3 text-sm text-[var(--nv-danger)]">{conceptError}</p>
                )}
                {state.status === "ended" && (
                  <div className="mt-4">
                    <button
                      onClick={handleBack}
                      className="rounded-lg border border-[var(--nv-border-3)] px-6 py-2 font-medium text-[var(--nv-text-secondary)] transition-all hover:border-[var(--nv-creative)] hover:text-[var(--nv-creative)]"
                    >
                      返回工作区查看正文
                    </button>
                  </div>
                )}
                {state.error && (
                  <p className="mt-4 text-sm text-[var(--nv-danger)]">{state.error}</p>
                )}
              </div>
            </div>
          ) : (
            /* 游戏进行中 */
            <>
              <div className="custom-scrollbar flex-1 overflow-y-auto p-6">
                <GameCanvas
                  turns={turns}
                  lastNarrative={state.lastNarrative}
                  isStreaming={state.status === "generating"}
                  entities={state.entities}
                  items={state.items}
                />
              </div>

              {/* 选项区 */}
              {state.options.length > 0 && state.status === "playing" && (
                <div className="px-6 pb-3">
                <div className="mx-auto grid max-w-3xl grid-cols-2 gap-3">
                  {state.options.map((opt) => (
                    <PointerGlow key={opt.index} className="rounded-xl">
                      <button
                        key={opt.index}
                        onClick={() =>
                          handleAction("option", `选择：${opt.text}`, opt.index)
                        }
                        className="group flex w-full items-start gap-2 rounded-xl border border-[var(--nv-border-2)] bg-[var(--nv-surface-2)] px-4 py-3 text-left text-sm text-[var(--nv-text-secondary)] transition-all hover:border-[var(--nv-creative-soft)] hover:bg-[var(--nv-creative-soft)] hover:text-[var(--nv-text-primary)] active:scale-[0.98]"
                      >
                        <span className="font-mono text-[var(--nv-creative)]">
                          {opt.index}.
                        </span>
                        <span>{opt.text}</span>
                      </button>
                    </PointerGlow>
                  ))}
                </div>
                </div>
              )}
            </>
          )}
        </main>

        {/* 右侧信息面板 */}
        <aside
          ref={rightDrawerRef}
          tabIndex={-1}
          role={rightDrawerOpen ? "dialog" : undefined}
          aria-modal={rightDrawerOpen ? "true" : undefined}
          aria-labelledby={rightDrawerOpen ? rightDrawerTitleId : undefined}
          className={`flex w-64 shrink-0 flex-col border-l border-[var(--nv-border-2)] bg-[var(--nv-surface-1)] fixed inset-y-0 right-0 z-40 max-w-[85vw] h-full transition-transform duration-200 ${rightDrawerOpen ? "translate-x-0" : "translate-x-full"} lg:static lg:z-auto lg:h-auto lg:shrink-0 lg:w-64 lg:translate-x-0 lg:transition-none`}
        >
          <h2 id={rightDrawerTitleId} className="sr-only">游戏信息面板</h2>
          <div className="flex border-b border-[var(--nv-border-2)]">
            {RIGHT_TABS.map(({ key, label, icon }) => (
              <button
                key={key}
                onClick={() => setRightTab(key)}
                className={`flex flex-1 items-center justify-center gap-1 py-2.5 text-xs font-medium transition-colors ${
                  rightTab === key
                    ? "border-b-2 border-[var(--nv-creative)] bg-[var(--nv-creative-soft)] text-[var(--nv-creative)]"
                    : "border-b-2 border-transparent text-[var(--nv-text-tertiary)] hover:text-[var(--nv-text-primary)]"
                }`}
              >
                <Icon name={icon} size={13} /> {label}
              </button>
            ))}
          </div>
          <div className="custom-scrollbar flex-1 overflow-y-auto p-3 text-xs">
            {rightTab === "text" && (
              <div>
                <p className="mb-2 flex items-center gap-1.5 font-medium text-[var(--nv-text-primary)]">
                  <Icon name="file" size={14} className="text-[var(--nv-creative)]" /> 正文进度
                </p>
                <div className="mb-2 h-2 w-full overflow-hidden rounded-full bg-[var(--nv-surface-2)]">
                  <div
                    className="h-full rounded-full bg-[var(--nv-creative)] transition-all duration-700"
                    style={{
                      width: `${Math.min(100, (state.totalWords / 3000) * 100)}%`,
                    }}
                  />
                </div>
                <p className="text-right text-[var(--nv-text-tertiary)]">
                  总字数：{state.totalWords}
                </p>
                <div className="custom-scrollbar mt-4 max-h-[calc(100vh-280px)] overflow-y-auto">
                  <div className="whitespace-pre-wrap text-xs leading-relaxed text-[var(--nv-text-secondary)] opacity-80">
                    {state.narrative || "正文将在游戏互动过程中实时生成..."}
                  </div>
                </div>
              </div>
            )}
            {rightTab === "backpack" && (
              <div>
                <div className="mb-3 flex items-center justify-between gap-2">
                  <p className="flex items-center gap-1.5 font-medium text-[var(--nv-text-primary)]">
                    <Icon name="backpack" size={14} className="text-[var(--nv-creative)]" /> 当前背包
                  </p>
                  {/* 全部物品 / 角色物品 两类切换（C 任务） */}
                  <div className="flex items-center gap-0.5 rounded-lg border border-[var(--nv-border-2)] bg-[var(--nv-surface-2)] p-0.5">
                    {([
                      { k: "all", label: "全部" },
                      { k: "char", label: "角色物品" },
                    ] as const).map(({ k, label }) => (
                      <button
                        key={k}
                        onClick={() => setBackpackFilter(k)}
                        className={`rounded-md px-2 py-1 text-[11px] font-medium transition-all ${
                          backpackFilter === k
                            ? "bg-[var(--nv-creative)] text-[var(--nv-text-primary)]"
                            : "text-[var(--nv-text-tertiary)] hover:text-[var(--nv-text-primary)]"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                {(() => {
                  const visibleItems =
                    backpackFilter === "char"
                      ? state.items.filter((i) => i.owner && i.owner !== "主角")
                      : state.items;
                  // 新获得物品高亮 + 「新」徽章（滑入背包时显现）
                  const itemCls = (i: GameItem) =>
                    newItemKeys.has(`${i.name}|${i.owner || "主角"}`) ? "item-detected relative" : "";
                  return visibleItems.length === 0 ? (
                    <p className="italic text-[var(--nv-text-muted)]">
                      {backpackFilter === "char" ? "暂无归属角色的物品" : "背包空空如也，在冒险中获取物品吧"}
                    </p>
                  ) : (
                  <div className="space-y-2">
                    {(() => {
                      const consumables = visibleItems.filter(
                        (i) => i.category === "consumable" || i.category === "other"
                      );
                      const equipment = state.items.filter(
                        (i) => i.category === "equipment"
                      );
                      const questItems = state.items.filter(
                        (i) => i.category === "quest"
                      );
                      const currency = state.items.filter(
                        (i) => i.category === "currency"
                      );
                      return (
                        <>
                          {consumables.length > 0 && (
                            <>
                              <p className="mt-1 text-[10px] uppercase tracking-wider text-[var(--nv-text-tertiary)]">
                                【消耗品】
                              </p>
                              {consumables.map((i, idx) => (
                                <div
                                  key={idx}
                                  className={`rounded-lg border border-[var(--nv-border-2)] bg-[var(--nv-surface-2)] px-2 py-1 ${itemCls(i)}`}
                                >
                                  <span className="text-[var(--nv-text-primary)]">{i.name}</span>
                                  <span className="ml-2 text-[var(--nv-creative)]">
                                    ×{i.quantity}
                                  </span>
                                  <p className="mt-0.5 text-[10px] text-[var(--nv-text-muted)]">
                                    {i.source}{i.owner ? ` · 归属：${i.owner}` : ""}
                                  </p>
                                </div>
                              ))}
                            </>
                          )}
                          {equipment.length > 0 && (
                            <>
                              <p className="mt-3 text-[10px] uppercase tracking-wider text-[var(--nv-text-tertiary)]">
                                【装备】
                              </p>
                              {equipment.map((i, idx) => (
                                <div
                                  key={idx}
                                  className={`rounded-lg border border-[var(--nv-border-2)] bg-[var(--nv-surface-2)] px-2 py-1 ${itemCls(i)}`}
                                >
                                  <span className="text-[var(--nv-text-primary)]">{i.name}</span>
                                  <span className="ml-2 text-[var(--nv-success)]">
                                    ×{i.quantity}
                                  </span>
                                  {i.owner && (
                                    <p className="mt-0.5 text-[10px] text-[var(--nv-text-muted)]">归属：{i.owner}</p>
                                  )}
                                </div>
                              ))}
                            </>
                          )}
                          {questItems.length > 0 && (
                            <>
                              <p className="mt-3 text-[10px] uppercase tracking-wider text-[var(--nv-text-tertiary)]">
                                【任务道具】
                              </p>
                              {questItems.map((i, idx) => (
                                <div
                                  key={idx}
                                  className={`rounded-lg border border-[var(--nv-border-2)] bg-[var(--nv-surface-2)] px-2 py-1 ${itemCls(i)}`}
                                >
                                  <span className="text-[var(--nv-warning)]">{i.name}</span>
                                  {i.owner && (
                                    <p className="mt-0.5 text-[10px] text-[var(--nv-text-muted)]">归属：{i.owner}</p>
                                  )}
                                </div>
                              ))}
                            </>
                          )}
                          {currency.length > 0 && (
                            <>
                              <p className="mt-3 text-[10px] uppercase tracking-wider text-[var(--nv-text-tertiary)]">
                                【货币】
                              </p>
                              {currency.map((i, idx) => (
                                <div
                                  key={idx}
                                  className={`rounded-lg border border-[var(--nv-border-2)] bg-[var(--nv-surface-2)] px-2 py-1 ${itemCls(i)}`}
                                >
                                  <span className="text-accent-label">{i.name}</span>
                                  <span className="ml-2 text-accent-label">
                                    ×{i.quantity}
                                  </span>
                                  {i.owner && (
                                    <p className="mt-0.5 text-[10px] text-[var(--nv-text-muted)]">归属：{i.owner}</p>
                                  )}
                                </div>
                              ))}
                            </>
                          )}
                        </>
                      );
                    })()}
                  </div>
                ); })()}
              </div>
            )}
            {rightTab === "world" && (
              <div>
                <p className="mb-3 flex items-center gap-1.5 font-medium text-[var(--nv-text-primary)]">
                  <Icon name="globe" size={14} className="text-[var(--nv-creative)]" /> 世界设定
                </p>
                {lorebook.length === 0 && !nodeOutline ? (
                  <EmptyState
                    icon="globe"
                    title="还没有世界设定"
                    description="在 workspace 的世界书与章节大纲中添加设定，将在此实时呈现"
                  />
                ) : (
                  <div className="space-y-3">
                    {nodeOutline && (
                      <div className="rounded-xl border border-[var(--nv-border-2)] bg-[var(--nv-surface-2)] p-3">
                        <p className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--nv-text-tertiary)]">
                          <Icon name="book" size={12} /> 本章大纲
                        </p>
                        <p className="whitespace-pre-wrap text-xs leading-relaxed text-[var(--nv-text-secondary)]">
                          {nodeOutline}
                        </p>
                      </div>
                    )}
                    {lorebook.length > 0 && (
                      <div className="space-y-2">
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--nv-text-tertiary)]">
                          世界书 ({lorebook.length})
                        </p>
                        {lorebook.map((e) => (
                          <div
                            key={e.id}
                            className="rounded-xl border border-[var(--nv-border-2)] bg-[var(--nv-surface-2)] p-3 transition-colors hover:border-[var(--nv-creative-soft)]"
                          >
                            <p className="flex items-center justify-between gap-2 text-xs font-medium text-[var(--nv-text-primary)]">
                              <span className="truncate">{e.title}</span>
                              {e.category && e.category !== "custom" && (
                                <span className="shrink-0 rounded-full bg-[var(--nv-creative-soft)] px-2 py-0.5 text-[10px] text-[var(--nv-creative)]">
                                  {e.category}
                                </span>
                              )}
                            </p>
                            <p className="mt-1.5 line-clamp-4 text-[11px] leading-relaxed text-[var(--nv-text-tertiary)]">
                              {e.content}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
          {/* 右侧底部按钮 */}
          <div className="border-t border-[var(--nv-border-2)] p-3">
            {state.narrative && (
              <button
                onClick={() => setShowEndConfirm(true)}
                disabled={state.status !== "playing"}
                className="nv-glow-strong btn-creative w-full rounded-lg py-2.5 text-sm font-medium text-[var(--nv-text-primary)] disabled:cursor-not-allowed disabled:opacity-40"
              >
                结束并导出
              </button>
            )}
          </div>
        </aside>
        {/* 窄屏抽屉遮罩 */}
        {(leftDrawerOpen || rightDrawerOpen) && (
          <div aria-hidden="true" className="fixed inset-0 z-30 bg-black/50 lg:hidden" onClick={() => { setLeftDrawerOpen(false); setRightDrawerOpen(false); }} />
        )}
      </div>

      {/* ═══ 章纲编辑器浮层 ═══ */}
      {showOutlineEditor && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="h-[85vh] max-h-[800px] w-[900px]">
            <GameOutlineEditor
              projectId={projectId}
              nodeId={nodeId}
              chapterTitle={state.chapterTitle}
              currentOutline={nodeOutline}
              onOutlineSaved={(outline) => {
                setNodeOutline(outline);
              }}
              onClose={() => setShowOutlineEditor(false)}
            />
          </div>
        </div>
      )}

      {/* ═══ 结束并导出 · 影子确认浮层（游戏模式设置预览） ═══ */}
      {showEndConfirm && (
        <Modal
          open
          onClose={() => setShowEndConfirm(false)}
          bare
          panelClassName="max-w-md"
          labelledBy="game-end-confirm-title"
        >
          <div className="p-6">
            <div className="mb-3 flex items-center gap-2">
              <Icon name="alert" size={22} className="text-[var(--nv-creative)]" />
              <h2 id="game-end-confirm-title" className="text-lg font-bold text-[var(--nv-text-primary)]">
                结束并导出 · 游戏模式
              </h2>
            </div>
            <div className="space-y-3 text-sm leading-relaxed text-[var(--nv-text-secondary)]">
              <p>
                本章已累积 <span className="font-medium text-[var(--nv-creative)]">{state.totalWords}</span> 字、
                <span className="font-medium text-[var(--nv-creative)]">{state.currentRound}</span> 轮互动叙事。
                确认后，游戏叙事将拼接章尾收束段，<span className="text-[var(--nv-text-primary)]">写入本章正文</span>（保留原有正文前置，不覆盖已写内容）。
              </p>
              <div className="rounded-xl border border-[var(--nv-border-2)] bg-[var(--nv-surface-1)] p-3 space-y-1.5">
                <p className="text-xs font-medium text-[var(--nv-text-primary)]">导出设置（游戏模式）</p>
                <p className="flex items-center justify-between text-xs">
                  <span>智能审阅（自动定稿）</span>
                  <span className={autoConfirmEnabled ? "text-[var(--nv-success)]" : "text-[var(--nv-text-tertiary)]"}>
                    {autoConfirmEnabled ? "已开启" : "已关闭"}
                  </span>
                </p>
                <p className="text-[11px] text-[var(--nv-text-tertiary)]">
                  {autoConfirmEnabled
                    ? "开启且质量达标将自动定稿；否则进入待确认状态，由你在工作区手动定稿。"
                    : "导出后进入待确认状态，由你在工作区手动定稿。"}
                </p>
              </div>
              <p className="text-xs text-[var(--nv-text-tertiary)]">
                提示：导出后可随时回到工作区对正文精修，不会影响已生成的游戏叙事。
              </p>
            </div>
            <div className="mt-5 flex gap-3">
              <button
                onClick={() => setShowEndConfirm(false)}
                className="flex-1 rounded-xl border border-[var(--nv-border-2)] py-2.5 text-sm font-medium text-[var(--nv-text-secondary)] transition-all hover:border-[var(--nv-border-3)] hover:text-[var(--nv-text-primary)] active:scale-95"
              >
                再想想
              </button>
              <button
                onClick={() => { setShowEndConfirm(false); handleEnd(); }}
                className="nv-glow-strong btn-creative flex-1 rounded-xl py-2.5 text-sm font-medium text-[var(--nv-text-primary)] transition-all active:scale-95"
              >
                确认导出
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* ═══ 底部动作栏 ═══ */}
      {(state.status === "playing" || state.status === "generating") && (
        <footer className="relative z-10 border-t border-[var(--nv-border-2)] bg-[var(--nv-abyss)]/80 px-4 py-3 backdrop-blur-sm">
          {/* 快捷动作按钮 */}
          <div className="mx-auto flex max-w-3xl gap-2">
            {QUICK_ACTIONS.map((action) => (
              <PointerGlow key={action.type} className="flex-1 rounded-xl">
                <button
                  key={action.type}
                  onClick={() => handleAction(action.type, action.label)}
                  disabled={state.status !== "playing"}
                  title={action.desc}
                  className="group flex w-full flex-col items-center gap-1 rounded-xl border border-[var(--nv-border-2)] bg-[var(--nv-surface-2)] px-1 py-2.5 text-[var(--nv-text-secondary)] transition-all hover:border-[var(--nv-creative-soft)] hover:bg-[var(--nv-creative-soft)] hover:text-[var(--nv-text-primary)] active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Icon name={action.icon as IconName} size={16} className="transition-colors group-hover:text-[var(--nv-creative)]" />
                  <span className="text-[11px]">{action.label}</span>
                </button>
              </PointerGlow>
            ))}
          </div>

          {/* 文本输入框 */}
          <div className="mx-auto mt-3 flex max-w-3xl gap-3">
            <input
              type="text"
              value={customInput}
              onChange={(e) => setCustomInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && customInput.trim()) {
                  handleAction("custom", customInput.trim());
                }
              }}
              placeholder="描述你想要的剧情发展，或输入角色的行动..."
              disabled={state.status !== "playing"}
              className="flex-1 rounded-lg border border-[var(--nv-border-2)] bg-[var(--nv-surface-2)] px-4 py-2.5 text-sm text-[var(--nv-text-primary)] outline-none transition-colors placeholder:text-[var(--nv-text-muted)] focus:border-[var(--nv-creative-soft)] disabled:cursor-not-allowed disabled:opacity-40"
            />
            <button
              onClick={() => {
                if (customInput.trim()) handleAction("custom", customInput.trim());
              }}
              disabled={state.status !== "playing" || !customInput.trim()}
              className="nv-glow-strong btn-creative rounded-lg px-4 py-2.5 text-sm font-medium text-[var(--nv-text-primary)] transition-all active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
            >
              发送
            </button>
            {(state.status as string) === "generating" && (
              <button
                onClick={handleStop}
                className="flex items-center gap-1.5 rounded-lg bg-[var(--nv-danger-soft)] px-4 py-2.5 text-sm font-medium text-[var(--nv-danger)] transition-all hover:bg-[var(--nv-danger)] hover:text-[var(--nv-text-primary)] active:scale-95"
              >
                <Icon name="stop" size={14} /> 停止
              </button>
            )}
          </div>
        </footer>
      )}

      {/* 已结束状态底部 */}
      {state.status === "ended" && (
        <footer className="relative z-10 border-t border-[var(--nv-border-2)] bg-[var(--nv-abyss)]/80 px-6 py-4 text-center backdrop-blur-sm">
          {state.exportStatus === "confirmed" ? (
            <p className="mb-3 flex items-center justify-center gap-2 text-[var(--nv-success)]">
              <Icon name="check" size={16} />
              章节已导出并自动定稿{state.exportQuality != null ? `（质量分 ${state.exportQuality}）` : ""}，返回工作区查看
            </p>
          ) : state.exportStatus === "drafting" ? (
            <p className="mb-3 flex items-center justify-center gap-2 text-accent-label">
              <Icon name="alert" size={16} />
              章节已导出，待你手动确认（智能审阅关闭或质量未达标），返回工作区处理
            </p>
          ) : (
            <p className="mb-3 flex items-center justify-center gap-2 text-[var(--nv-success)]">
              <Icon name="check" size={16} /> 章节已导出并保存为正文，返回工作区查看
            </p>
          )}
          <button
            onClick={handleBack}
            className="btn-primary rounded-lg px-8 py-2.5 text-sm font-medium text-[var(--nv-text-primary)]"
          >
            返回工作区
          </button>
        </footer>
      )}
    </div>
  );
}
