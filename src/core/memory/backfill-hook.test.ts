import { describe, it, expect, vi, beforeEach } from "vitest";

// backfill.ts 依赖 prisma / getSettings / embedding，mock 掉避免真实 IO。
// 本测试只验证调度与节流策略，不验证回填本身。
const mockBackfill = vi.fn();
vi.mock("./backfill", () => ({
  backfillLorebookEmbeddings: (...args: unknown[]) => mockBackfill(...args),
}));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/llm", () => ({ getSettings: vi.fn() }));
vi.mock("@/core/llm/embedding", () => ({
  embedBatch: vi.fn(),
  isEmbeddingConfigured: vi.fn(),
}));

const { scheduleBackfill, shouldRunBackfill, resetBackfillThrottle, BACKFILL_THROTTLE_MS } =
  await import("./backfill-hook");

describe("scheduleBackfill —— 节流", () => {
  beforeEach(() => {
    resetBackfillThrottle();
    mockBackfill.mockReset();
    mockBackfill.mockResolvedValue({ total: 0, written: 0, failed: 0, skipped: true });
  });

  it("首次调用会触发", () => {
    expect(scheduleBackfill("p1", 1000)).toBe(true);
  });

  it("节流窗口内重复调用不再触发（不重复付网络成本）", () => {
    expect(scheduleBackfill("p1", 1000)).toBe(true);
    expect(scheduleBackfill("p1", 1000 + BACKFILL_THROTTLE_MS - 1)).toBe(false);
  });

  it("超过节流窗口后可再次触发", async () => {
    scheduleBackfill("p1", 1000);
    // 必须等第一次跑完：inFlight 名额要到 promise settle 才释放。
    // 同步连调两次是不现实的场景（真实回填要几百毫秒以上）。
    await new Promise((r) => setTimeout(r, 0));
    expect(scheduleBackfill("p1", 1000 + BACKFILL_THROTTLE_MS)).toBe(true);
  });

  it("不同项目互不干扰", () => {
    expect(scheduleBackfill("p1", 1000)).toBe(true);
    expect(scheduleBackfill("p2", 1000)).toBe(true);
  });

  it("空 projectId 不触发", () => {
    expect(scheduleBackfill("", 1000)).toBe(false);
    expect(scheduleBackfill(undefined as any, 1000)).toBe(false);
    expect(mockBackfill).not.toHaveBeenCalled();
  });
});

describe("scheduleBackfill —— 并发与健壮性", () => {
  beforeEach(() => {
    resetBackfillThrottle();
    mockBackfill.mockReset();
  });

  it("回填进行中时不再重复触发（避免并发打同一批数据）", async () => {
    let release: () => void = () => {};
    mockBackfill.mockImplementation(() => new Promise<void>((r) => { release = r; }));

    expect(scheduleBackfill("p1", 1000)).toBe(true);
    // 第一次还在跑（inFlight 未清除），第二次应被拒
    expect(scheduleBackfill("p1", 1000)).toBe(false);

    release();
    await new Promise((r) => setTimeout(r, 0));
  });

  it("回填抛异常也不影响调用方（错误被吞，不冒泡）", async () => {
    mockBackfill.mockRejectedValue(new Error("boom"));
    expect(() => scheduleBackfill("p1", 1000)).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));
  });

  it("回填失败后，inFlight 被清除，下次还能再试", async () => {
    mockBackfill.mockRejectedValue(new Error("boom"));
    scheduleBackfill("p1", 1000);
    await new Promise((r) => setTimeout(r, 0));
    // 失败不应永久占用名额
    expect(scheduleBackfill("p1", 1000 + BACKFILL_THROTTLE_MS)).toBe(true);
  });
});

describe("shouldRunBackfill —— 纯判定", () => {
  beforeEach(() => resetBackfillThrottle());

  it("未跑过的项目返回 true", () => {
    expect(shouldRunBackfill("new", 1000)).toBe(true);
  });

  it("只判定不执行，不产生副作用", async () => {
    // 先排空前一个用例残留的异步调用，否则计数会被污染
    await new Promise((r) => setTimeout(r, 0));
    mockBackfill.mockClear();

    shouldRunBackfill("p9", 1000);
    expect(mockBackfill).not.toHaveBeenCalled();
    // 判定之后仍可触发
    expect(scheduleBackfill("p9", 1000)).toBe(true);
  });
});
