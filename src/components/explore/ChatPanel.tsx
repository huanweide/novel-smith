"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import Link from "next/link";
import type { ExploreMessage, ExploreStep, AdoptCard } from "@/core/explore/types";
import { STEP_LABELS, STEP_LUCIDE } from "@/core/explore/types";
import { Icon } from "@/components/ui/icons";

interface Props {
  messages: ExploreMessage[];
  loading: boolean;
  mode: "chat" | "outline";
  currentStep: ExploreStep;
  adoptStatus: Record<string, string>;
  aiConfigured: boolean | null;
  onSend: (text: string) => void;
  onStepChange: (step: ExploreStep) => void;
  onModeChange: (mode: "chat" | "outline") => void;
  onAdoptCard: (card: AdoptCard) => void;
  /** 换一批候选卡（重 roll），可带一句提示词 */
  onReroll: (hint?: string) => void;
}

export function ChatPanel({
  messages,
  loading,
  mode,
  currentStep,
  adoptStatus,
  aiConfigured,
  onSend,
  onStepChange,
  onModeChange,
  onAdoptCard,
  onReroll,
}: Props) {
  const chatEndRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // 换一批（重 roll）：展开式提示词输入
  const [rerollOpen, setRerollOpen] = useState(false);
  const rerollInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (rerollOpen) rerollInputRef.current?.focus();
  }, [rerollOpen]);
  const handleRerollSubmit = () => {
    if (loading) return;
    const hint = rerollInputRef.current?.value.trim() || "";
    onReroll(hint || undefined);
    setRerollOpen(false);
    if (rerollInputRef.current) rerollInputRef.current.value = "";
  };
  // 对话区滚动进度（右侧细进度条）：0-1
  const [scrollProgress, setScrollProgress] = useState(1);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const max = el.scrollHeight - el.clientHeight;
    if (max <= 0) {
      setScrollProgress(1);
      return;
    }
    setScrollProgress(Math.min(1, Math.max(0, el.scrollTop / max)));
  }, []);

  // 新消息到达时若用户已接近底部（或从未上滑）则顺滑滚到底；否则保持用户阅读位置
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (nearBottom) {
      chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  const handleSubmit = () => {
    const input = inputRef.current;
    if (!input || !input.value.trim() || loading) return;
    onSend(input.value);
    input.value = "";
  };

  return (
    <div className="flex flex-col min-h-0 flex-1">
      {/* ── 探讨服务状态条（单行紧凑，把空间留给对话） ── */}
      {aiConfigured === false ? (
        <div className="px-4 py-1.5 flex items-center gap-2.5 border-b border-warning/30 bg-warning/[0.08]">
          <Icon name="alert" size={14} className="text-warning shrink-0" />
          <span className="text-xs text-warning font-medium">AI 未配置 —— 无法与 AI 探讨</span>
          <Link
            href="/settings"
            className="text-[10px] px-2 py-0.5 rounded-full bg-warning/15 text-warning border border-warning/25 hover:bg-warning/25 transition-colors duration-150 ml-auto"
          >
            去设置页填 Key →
          </Link>
        </div>
      ) : (
        <div className="px-4 py-1.5 flex items-center gap-2 border-b border-[var(--nv-border-2)] bg-gradient-to-r from-[var(--nv-creative-soft)]/30 via-transparent to-transparent">
          <span className="relative flex h-1.5 w-1.5 shrink-0">
            <span className="absolute inline-flex h-full w-full rounded-full bg-[var(--nv-creative)] opacity-60 animate-ping" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[var(--nv-creative)]" />
          </span>
          <span className="text-[11px] text-[var(--nv-text-tertiary)] truncate">
            {mode === "outline"
              ? "大纲模式 · 粘贴整篇大纲，AI 自动抽取角色与设定"
              : `AI 创作顾问 · 当前·${STEP_LABELS[currentStep]} · 不限字数 · 每次回复附 3 张候选卡，点卡即采纳`}
          </span>
        </div>
      )}

      {/* ── 对话列表 ── */}
      <div className="relative flex-1 min-h-0">
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="h-full overflow-y-auto px-4 py-4"
        >
          <div className="max-w-3xl mx-auto space-y-4">
            {aiConfigured === false && (
              <div className="my-1 p-4 rounded-2xl border border-warning/30 bg-warning/[0.08] text-center">
                <p className="text-sm text-warning font-medium">AI 尚未配置</p>
                <p className="text-xs text-warning/80 mt-1.5 leading-relaxed max-w-[320px] mx-auto">
                  探讨模式需要 AI 才能与你对话、生成并采纳设定。请先在设置页填入 LLM API Key，再回来开始构思。
                </p>
                <Link
                  href="/settings"
                  className="inline-flex mt-3 items-center gap-1 text-xs px-3.5 py-1.5 rounded-full bg-warning/15 text-warning border border-warning/30 hover:bg-warning/25 transition-colors duration-150"
                >
                  去设置页填 Key →
                </Link>
              </div>
            )}
            {messages.map((msg, i) => {
          const isUser = msg.role === "user";
          // 步骤分隔芯片：渲染为居中横幅，给出"跳到新话题"的视觉节奏
          if (msg.stepIntro) {
            return (
              <div key={i} className="animate-[nf-card-in_0.45s_ease-out_both] flex flex-col items-center gap-1.5 py-2 w-full">
                <div className="flex items-center gap-2.5 px-5 py-2 rounded-full bg-gradient-to-r from-transparent via-[var(--nv-creative)]/12 to-transparent border border-[var(--nv-creative)]/20">
                  <span className="w-6 h-6 rounded-full bg-[var(--nv-creative)]/15 border border-[var(--nv-creative)]/30 flex items-center justify-center shrink-0">
                    <Icon name={STEP_LUCIDE[msg.stepIntro]} size={13} className="text-[var(--nv-creative)]" />
                  </span>
                  <span className="text-sm font-bold tracking-wide text-[var(--nv-creative)]">继续讨论 · {STEP_LABELS[msg.stepIntro]}</span>
                </div>
                <span className="text-[10px] text-[var(--nv-text-muted)] text-center max-w-[420px]">{msg.content}</span>
              </div>
            );
          }
          return (
            <div
              key={i}
              className={`flex items-end gap-2 ${isUser ? "justify-end" : "justify-start"}`}
              style={{ animation: "nf-bubble-in 0.3s var(--ease-spring) both" }}
            >
              {/* 头像 */}
              {!isUser && (
                <div className="w-7 h-7 rounded-full bg-[var(--nv-creative)]/15 border border-[var(--nv-creative)]/30 flex items-center justify-center shrink-0 mb-1 shadow-[0_0_12px_var(--nv-creative-soft)]">
                  <Icon name="bot" size={14} className="text-[var(--nv-creative)]" />
                </div>
              )}
              <div className="flex flex-col max-w-[72%]">
                <span className={`text-[9px] mb-1 ${isUser ? "text-right text-[var(--nv-text-muted)]" : "text-[var(--nv-text-muted)]"}`}>
                  {isUser ? "你" : "AI 创作顾问"}
                </span>
                <div
                  className={`px-4 py-3 rounded-2xl text-sm leading-relaxed transition-all duration-200 ${
                    isUser
                      ? "bg-gradient-to-br from-[var(--nv-primary)] to-[var(--nv-primary)] text-[var(--nv-text-primary)] rounded-br-md shadow-lg shadow-[var(--nv-primary)]/10"
                      : "bg-gradient-to-br from-[var(--nv-surface-2)] via-[var(--nv-surface-2)] to-[var(--nv-surface-1)] backdrop-blur-sm border border-[var(--nv-border-2)] border-l-2 border-l-[var(--nv-creative)]/50 text-[var(--nv-text-secondary)] rounded-bl-md hover:border-[var(--nv-creative)]/30 hover:shadow-[0_8px_28px_rgba(0,0,0,0.25)]"
                  }`}
                >
                  <p className="whitespace-pre-wrap">{msg.content}</p>

                  {/* 候选卡片 */}
                  {msg.cards && msg.cards.length > 0 && (
                    <div className="mt-3 space-y-2">
                      <div className="text-[10px] text-[var(--nv-text-muted)] mb-1 flex items-center gap-1.5">
                        <span className="w-1 h-1 rounded-full bg-[var(--nv-creative)]/60" />
                        点击卡片即可采纳
                      </div>
                      {msg.cards.map((card) => {
                        const status = adoptStatus[card.id];
                        const adopted = card.adopted || status === "adopted";
                        return (
                          <button
                            key={card.id}
                            onClick={() => !adopted && onAdoptCard(card)}
                            disabled={adopted}
                            className={`w-full text-left p-3 rounded-xl border transition-all duration-200 group ${
                              adopted
                                ? "bg-[var(--nv-success)]/[0.08] border-[var(--nv-success)]/30 animate-[nf-adopt-flash_0.6s_ease-out]"
                                : "bg-[var(--nv-surface-2)] border border-[var(--nv-border-2)] border-l-2 border-l-[var(--nv-creative)]/40 hover:border-[var(--nv-creative)]/30 hover:border-l-[var(--nv-creative)] hover:-translate-y-0.5 hover:shadow-[0_10px_30px_rgba(0,0,0,0.3)] active:scale-[0.98]"
                            }`}
                          >
                            <div className="flex items-center gap-2 mb-1.5">
                              <span className="text-xs font-semibold text-[var(--nv-text-secondary)]">
                                {card.title}
                              </span>
                              <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[var(--nv-creative)]/10 text-[var(--nv-creative)] border border-[var(--nv-creative)]/20 shrink-0">
                                {STEP_LABELS[card.step]}
                              </span>
                              {status === "writing" && (
                                <span className="text-[9px] bg-[var(--nv-warning)]/20 text-[var(--nv-warning)] px-1.5 py-0.5 rounded-full animate-pulse">
                                  写入中
                                </span>
                              )}
                              {status === "adopted" && (
                                <span className="text-[9px] bg-[var(--nv-success)]/20 text-[var(--nv-success)] px-1.5 py-0.5 rounded-full flex items-center gap-0.5">
                                  <Icon name="check" size={9} /> 已采纳
                                </span>
                              )}
                              {status === "failed" && (
                                <span className="text-[9px] bg-[var(--nv-danger)]/20 text-[var(--nv-danger)] px-1.5 py-0.5 rounded-full">
                                  失败
                                </span>
                              )}
                              {status === "failed" && (
                                <span className="text-[9px] text-[var(--nv-danger)]/70 ml-1">
                                  点击卡片重试 ↻
                                </span>
                              )}
                              {adopted && !status && (
                                <span className="text-[9px] bg-[var(--nv-success)]/20 text-[var(--nv-success)] px-1.5 py-0.5 rounded-full flex items-center gap-0.5">
                                  <Icon name="check" size={9} /> 已采纳
                                </span>
                              )}
                            </div>
                            <p className="text-[11px] text-[var(--nv-text-tertiary)] leading-relaxed">
                              {card.content}
                            </p>
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {/* 换一批（重 roll，可带提示词）—— 仅最后一条 AI 回复 */}
                  {!isUser && i === messages.length - 1 && msg.cards && msg.cards.length > 0 && (
                    <div className="mt-2 flex items-center gap-1.5">
                      {rerollOpen ? (
                        <>
                          <input
                            ref={rerollInputRef}
                            type="text"
                            placeholder="可选：给一句重摇提示，如「更黑暗的方向」"
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                handleRerollSubmit();
                              }
                            }}
                            className="flex-1 bg-[var(--nv-surface-2)] border border-[var(--nv-border-2)] rounded-lg px-2.5 py-1 text-[11px] text-[var(--nv-text-secondary)] placeholder:text-[var(--nv-text-muted)] focus:outline-none focus:border-[var(--nv-creative)]/40"
                          />
                          <button
                            onClick={handleRerollSubmit}
                            disabled={loading}
                            className="text-[10px] px-2.5 py-1 rounded-lg bg-[var(--nv-creative)]/15 text-[var(--nv-creative)] border border-[var(--nv-creative)]/30 hover:bg-[var(--nv-creative)]/25 disabled:opacity-40 transition-all active:scale-95 shrink-0"
                          >
                            换一批
                          </button>
                          <button
                            onClick={() => setRerollOpen(false)}
                            className="text-[10px] px-2 py-1 rounded-lg text-[var(--nv-text-muted)] hover:text-[var(--nv-text-tertiary)] transition-colors shrink-0"
                          >
                            取消
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => setRerollOpen(true)}
                          disabled={loading}
                          title="重新生成 3 张候选卡，可附带一句提示词"
                          className="text-[10px] px-2.5 py-1 rounded-lg text-[var(--nv-text-tertiary)] border border-[var(--nv-border-2)] hover:border-[var(--nv-creative)]/40 hover:text-[var(--nv-creative)] hover:bg-[var(--nv-creative)]/10 disabled:opacity-40 transition-all active:scale-95 flex items-center gap-1"
                        >
                          <Icon name="refresh" size={11} /> 换一批
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
              {isUser && (
                <div className="w-7 h-7 rounded-full bg-[var(--nv-primary)]/15 border border-[var(--nv-primary)]/30 flex items-center justify-center shrink-0 mb-1">
                  <Icon name="user" size={14} className="text-[var(--nv-primary)]" />
                </div>
              )}
            </div>
          );
        })}
        {loading && (
          <div className="flex items-end gap-2 justify-start">
          <div className="w-7 h-7 rounded-full bg-[var(--nv-creative)]/15 border border-[var(--nv-creative)]/30 flex items-center justify-center shrink-0 mb-1 shadow-[0_0_12px_var(--nv-creative-soft)]">
            <Icon name="bot" size={14} className="text-[var(--nv-creative)]" />
          </div>
          <div className="bg-[var(--nv-surface-2)] backdrop-blur-sm border border-[var(--nv-border-2)] text-[var(--nv-text-muted)] px-4 py-3 rounded-2xl rounded-bl-md text-sm">
              <span className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 bg-[var(--nv-creative)] rounded-full animate-pulse" />
                  <span className="w-1.5 h-1.5 bg-[var(--nv-creative)] rounded-full animate-pulse delay-150" />
                  <span className="w-1.5 h-1.5 bg-[var(--nv-creative)] rounded-full animate-pulse delay-300" />
                </span>
                <span className="text-[11px]">AI 正在思考{mode === "chat" ? "" : `「${STEP_LABELS[currentStep]}」`}…</span>
              </span>
            </div>
          </div>
        )}
        <div ref={chatEndRef} />
          </div>
        </div>
        {/* 右侧滚动进度条：位置即对话进度；拖不动、纯指示 */}
        <div
          aria-hidden="true"
          className="absolute right-1.5 top-2 bottom-2 w-[3px] rounded-full bg-[var(--nv-border-2)]/60 pointer-events-none"
        >
          <div
            className="w-full rounded-full bg-[var(--nv-primary)]/50 transition-all duration-150"
            style={{ height: `${Math.max(8, Math.round(scrollProgress * 100))}%` }}
          />
        </div>
      </div>

      {/* ── 输入区 ── */}
      <div className="border-t border-[var(--nv-border-2)] px-4 py-3 shrink-0 bg-[var(--nv-void)]/80 backdrop-blur-sm">
        <div className="flex items-center gap-2">
          {/* 模式切换 */}
          <div className="flex items-center gap-0.5 bg-[var(--nv-surface-2)] rounded-xl p-0.5 border border-[var(--nv-border-2)]">
            {(["chat", "outline"] as const).map((m) => {
              const active = mode === m;
              const labels: Record<string, React.ReactNode> = { chat: <Icon name="message" size={13} />, outline: <Icon name="clipboard" size={13} /> };
              const titles = { chat: "对话", outline: "大纲" };
              return (
                <button
                  key={m}
                  onClick={() => onModeChange(m)}
                  title={titles[m]}
                  className={`text-xs px-2.5 py-1 rounded-lg font-medium transition-all duration-200 ${
                    active
                      ? "bg-[var(--nv-surface-3)] text-[var(--nv-text-secondary)] shadow-sm"
                      : "text-[var(--nv-text-muted)] hover:text-[var(--nv-text-primary)] hover:bg-[var(--nv-surface-3)]"
                  } active:scale-95`}
                >
                  {labels[m]}
                </button>
              );
            })}
          </div>
          <input
            ref={inputRef}
            type="text"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSubmit();
              }
            }}
            placeholder={
              aiConfigured === false
                ? "AI 未配置，去设置页填 Key 后开始对话..."
                : mode === "outline"
                  ? "粘贴你的大纲，AI 帮你抽取设定..."
                  : "随便聊聊你的想法，AI 每次会附 3 张候选卡供你拍板…"
            }
            disabled={loading || aiConfigured === false}
            className="flex-1 bg-[var(--nv-surface-2)] border border-[var(--nv-border-2)] rounded-xl px-4 py-2.5 text-sm text-[var(--nv-text-secondary)] placeholder:text-[var(--nv-text-muted)] focus:outline-none focus:border-[var(--nv-primary)]/40 focus:ring-2 focus:ring-[var(--nv-primary)]/10 disabled:opacity-40 transition-all duration-200"
          />
          <button
            onClick={handleSubmit}
            disabled={loading || aiConfigured === false}
            className="btn-primary px-5 py-2.5 text-sm font-medium disabled:opacity-40 flex items-center gap-1.5"
          >
            <Icon name="arrowRight" size={13} /> 发送
          </button>
        </div>
      </div>
    </div>
  );
}
