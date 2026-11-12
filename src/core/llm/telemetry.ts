/**
 * R2 · LLM 调用可追溯与抗压原语（纯函数 / 零依赖 / 可判别测试）
 *
 * 设计约束（来自外部基准 + 项目定位）：
 *  - 不引 SDK、不引常驻服务、不改既有重试语义；只提供确定性原语，由调用方按需取用。
 *  - 失败上下文必须保留主错误原文：泛化文案只给用户看，不能覆盖排障依据（Sekin / Tensorplay 同指）。
 *  - 限流按 token 而非请求次数（一次 4000-token 与 10-token 请求成本差几百倍）。
 *  - 重试有单一 owner 的硬上界，防 `3×(1+fallback数)` 在限流时反向加压。
 */

import { randomUUID } from "crypto";

/** 一次「业务生成」的关联 ID。同一次生成的全部 LLM 调用共用一个值。 */
export function createRequestId(): string {
  return `lr_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

export interface FailureContext {
  requestId: string;
  model?: string;
  baseURL?: string;
  attempt?: number;
  fallback?: boolean;
  retryAfterMs?: number;
  /** 用户可见的泛化提示，单独放，绝不覆盖 primaryMessage */
  userMessage?: string;
}

export interface FailureRecord {
  requestId: string;
  primaryMessage: string;
  errorName: string;
  attempt: number;
  fallback: boolean;
  retryAfterMs: number;
  model: string;
  baseURL: string;
  userMessage: string;
  at: string;
}

/**
 * 把一次失败整理成结构化记录。
 * 明确不做：吞掉主错误、把 429 说成「模型不可用」、丢掉 requestId/attempt/fallback。
 */
export function describeFailure(error: unknown, ctx: FailureContext): FailureRecord {
  const isErr = error instanceof Error;
  const primaryMessage = isErr
    ? `${error.name}: ${error.message}`
    : String(error ?? "unknown error");
  return {
    requestId: ctx.requestId,
    primaryMessage,
    errorName: isErr ? error.name : "NonError",
    attempt: ctx.attempt ?? 1,
    fallback: ctx.fallback ?? false,
    retryAfterMs: ctx.retryAfterMs ?? 0,
    model: ctx.model ?? "",
    baseURL: ctx.baseURL ?? "",
    userMessage: ctx.userMessage ?? "",
    at: new Date().toISOString(),
  };
}

/**
 * 幂等键：同一业务动作在同一 requestId 内恒定。
 * 只保留 ASCII 安全字符，可直接进日志/请求头，不会因中文或空格破坏协议。
 */
export function makeIdempotencyKey(input: {
  requestId: string;
  action: string;
  target?: string;
}): string {
  const clean = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40) || "x";
  return `${clean(input.requestId)}:${clean(input.action)}:${clean(input.target ?? "default")}`;
}

/**
 * 一次逻辑操作的**总尝试数硬上界**（单一 owner）。
 * 调用方在进入重试循环前算一次，跨 target 共用同一计数器；不允许各层各自再重试。
 */
export function retryBudget(input: {
  retriesPerTarget: number;
  targets: number;
  hardCap: number;
}): number {
  const naive = Math.max(1, input.retriesPerTarget) * Math.max(1, input.targets);
  return Math.max(1, Math.min(naive, Math.max(1, input.hardCap)));
}

export interface LimitResult {
  allowed: boolean;
  retryAfterMs: number;
  usedTokens: number;
}

/**
 * 滑动窗口 token 限流器（进程内、零依赖）。
 * 本地单机桌面工具不需要分布式限流；这里只保证「同一时间窗内总 token 预算不被击穿」。
 */
export class TokenWindowLimiter {
  private readonly windowMs: number;
  private readonly maxTokens: number;
  private readonly now: () => number;
  private windowStart = -1;
  private used = 0;

  constructor(opts: { windowMs: number; maxTokens: number; now?: () => number }) {
    this.windowMs = Math.max(1, opts.windowMs);
    this.maxTokens = Math.max(1, opts.maxTokens);
    this.now = opts.now ?? Date.now;
  }

  tryConsume(tokens: number): LimitResult {
    const t = this.now();
    if (this.windowStart < 0 || t - this.windowStart >= this.windowMs) {
      this.windowStart = t;
      this.used = 0;
    }
    const cost = Math.max(0, Math.floor(tokens));
    if (this.used + cost > this.maxTokens) {
      return {
        allowed: false,
        retryAfterMs: Math.max(1, this.windowMs - (t - this.windowStart)),
        usedTokens: this.used,
      };
    }
    this.used += cost;
    return { allowed: true, retryAfterMs: 0, usedTokens: this.used };
  }
}
