/**
 * R2 判别测试 · 可追溯 + 抗压（本文件必须先红，再改实现到绿）
 *
 * 外部基准逐字符锚点（见 best-practices.md §3）：
 *  TheRouter：「request_id / attempt / attempt_group」「Keep one end-to-end deadline across all attempts」
 *             「do not stack SDK retries, gateway retries, and job-runner retries without one owner」
 *  Sekin   ：「Preserve the failure context」「Do not replace the primary failure with a generic 'model unavailable' message」
 *  tensorplay：「Always Return Request IDs」「Implement token-based rate limiting wherever possible」
 */
import { describe, expect, it } from "vitest";
import {
  createRequestId,
  describeFailure,
  makeIdempotencyKey,
  retryBudget,
  TokenWindowLimiter,
} from "./telemetry";

describe("R2 · 请求级关联", () => {
  it("requestId 非空且两次不同（可串联一次生成的全部调用）", () => {
    const a = createRequestId();
    const b = createRequestId();
    expect(a.length).toBeGreaterThan(8);
    expect(a).not.toBe(b);
  });

  it("describeFailure 保留主错误原文，不用泛化文案覆盖", () => {
    const primary = new Error("硅基流动 429: rate_limit_exceeded (req_abc123)");
    const out = describeFailure(primary, {
      requestId: "req-1",
      model: "deepseek-v4-flash",
      baseURL: "https://api.siliconflow.cn",
      attempt: 2,
      fallback: true,
      retryAfterMs: 1200,
    });
    expect(out.primaryMessage).toContain("429: rate_limit_exceeded");
    expect(out.requestId).toBe("req-1");
    expect(out.attempt).toBe(2);
    expect(out.fallback).toBe(true);
    expect(out.retryAfterMs).toBe(1200);
    // 泛化文案只能作为「用户可见提示」另放字段，绝不能替换主错误
    expect(out.primaryMessage).not.toBe("模型不可用");
  });

  it("describeFailure 对非 Error 也给出可定位的字符串", () => {
    const out = describeFailure("socket hang up", { requestId: "req-2" });
    expect(out.primaryMessage).toContain("socket hang up");
  });
});

describe("R2 · 幂等键", () => {
  it("同一业务动作+同一 requestId 得到同一键，换 requestId 则不同", () => {
    const a = makeIdempotencyKey({ requestId: "r1", action: "writeChapter", target: "node-9" });
    const b = makeIdempotencyKey({ requestId: "r1", action: "writeChapter", target: "node-9" });
    const c = makeIdempotencyKey({ requestId: "r2", action: "writeChapter", target: "node-9" });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it("键只含可安全入日志的字符", () => {
    const k = makeIdempotencyKey({ requestId: "r1", action: "写章", target: "第 1 章/正文" });
    expect(k).toMatch(/^[a-zA-Z0-9:_-]+$/);
  });
});

describe("R2 · 重试单一 owner（防 3×(1+N) 风暴）", () => {
  it("总尝试数有硬上界，且不超过声明的 budget", () => {
    expect(retryBudget({ retriesPerTarget: 3, targets: 4, hardCap: 6 })).toBe(6);
    expect(retryBudget({ retriesPerTarget: 3, targets: 2, hardCap: 6 })).toBe(6);
    expect(retryBudget({ retriesPerTarget: 1, targets: 1, hardCap: 6 })).toBe(1);
  });

  it("hardCap 至少为 1，不会算出 0 次尝试", () => {
    expect(retryBudget({ retriesPerTarget: 0, targets: 0, hardCap: 6 })).toBeGreaterThanOrEqual(1);
  });
});

describe("R2 · token 维度限流（不是按请求次数）", () => {
  it("同样请求数下，大 token 请求先被挡", () => {
    const lim = new TokenWindowLimiter({ windowMs: 60_000, maxTokens: 1000 });
    expect(lim.tryConsume(600).allowed).toBe(true);
    expect(lim.tryConsume(600).allowed).toBe(false); // 累计 1200 > 1000
  });

  it("小 token 请求能继续通过", () => {
    const lim = new TokenWindowLimiter({ windowMs: 60_000, maxTokens: 1000 });
    lim.tryConsume(600);
    expect(lim.tryConsume(300).allowed).toBe(true);
  });

  it("窗口过期后额度重置", () => {
    let now = 0;
    const lim = new TokenWindowLimiter({ windowMs: 1000, maxTokens: 100, now: () => now });
    lim.tryConsume(100);
    expect(lim.tryConsume(1).allowed).toBe(false);
    now = 1001;
    expect(lim.tryConsume(100).allowed).toBe(true);
  });

  it("被拒时给出剩余等待毫秒，便于上层用 Retry-After 口径响应", () => {
    let now = 0;
    const lim = new TokenWindowLimiter({ windowMs: 1000, maxTokens: 100, now: () => now });
    lim.tryConsume(100);
    const r = lim.tryConsume(1);
    expect(r.allowed).toBe(false);
    expect(r.retryAfterMs).toBeGreaterThan(0);
  });
});
