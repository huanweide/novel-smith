/**
 * R3 判别测试 · 任务恢复 + 主链路契约锁（先红 → 改 → 绿）
 *
 * 真缺陷锚点：`app/api/generation-tasks/route.ts:27-28` 「进程内 fire-and-forget」，
 * 进程崩溃后 status=running 的任务永远悬着，前端轮询看不到终态。
 * 契约锚点：`write-generation.ts:448-452` 富化管线必须同步跑完（用户硬性要求）。
 */
import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { findStaleRunningTasks } from "./task-recovery";

describe("R3 · 超时 running 任务识别", () => {
  const now = Date.parse("2026-11-12T16:00:00Z");

  it("超过阈值且仍 running 的任务应被识别", () => {
    const tasks = [
      { id: "t1", status: "running", updatedAt: new Date(now - 31 * 60_000) },
      { id: "t2", status: "running", updatedAt: new Date(now - 5 * 60_000) },
    ];
    expect(findStaleRunningTasks(tasks, { now, staleMs: 30 * 60_000 }).map((t) => t.id)).toEqual(["t1"]);
  });

  it("已 done / failed 的任务永不重判", () => {
    const tasks = [
      { id: "d", status: "done", updatedAt: new Date(now - 999 * 60_000) },
      { id: "f", status: "failed", updatedAt: new Date(now - 999 * 60_000) },
    ];
    expect(findStaleRunningTasks(tasks, { now, staleMs: 30 * 60_000 })).toEqual([]);
  });

  it("pending 不算卡死（可能还在排队）", () => {
    const tasks = [{ id: "p", status: "pending", updatedAt: new Date(now - 999 * 60_000) }];
    expect(findStaleRunningTasks(tasks, { now, staleMs: 30 * 60_000 })).toEqual([]);
  });

  it("时间边界：恰好等于阈值不算超时", () => {
    const tasks = [{ id: "edge", status: "running", updatedAt: new Date(now - 30 * 60_000) }];
    expect(findStaleRunningTasks(tasks, { now, staleMs: 30 * 60_000 })).toEqual([]);
  });
});

describe("R3 · 主链路契约（源码级锁，防误改生成语义）", () => {
  const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");

  it("富化后处理必须 await（不能改成 fire-and-forget）", () => {
    const src = read("src/core/write-generation.ts");
    expect(src).toMatch(/await runPostGenerationPipeline\(/);
    expect(src).not.toMatch(/void runPostGenerationPipeline\(/);
  });

  it("「速度不能以信息缺失为代价」的设计注释必须保留", () => {
    const src = read("src/core/write-generation.ts");
    expect(src).toContain("速度绝不能以「上下文/信息/限制条件缺失」为代价");
  });

  it("流式主循环仍实时推送 token，且每 ~200 字有一次增量扫描 hook", () => {
    const src = read("src/core/write-generation.ts");
    expect(src).toContain('send({ type: "token"');
    expect(src).toMatch(/scanBuffer\.length >= 200/);
  });

  it("LoreTable 写回必须走三路合并，不得回退成整列覆盖", () => {
    const src = read("src/core/babylore/fill.ts");
    expect(src).toContain("mergeLoreRows(");
  });
});
