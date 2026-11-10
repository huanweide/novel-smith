import { describe, it, expect } from "vitest";
import { planSchedule } from "./schedule";
import { FANQIE_DAILY_HARD_CAP } from "./types";

const baseInput = {
  startDate: "2026-12-01",
  count: 6,
  perDay: 2,
  dailyLimit: 3,
  windowStartMin: 480, // 08:00
  windowEndMin: 540, // 09:00
  now: new Date(2026, 11, 1, 0, 0, 0),
  seed: 42,
};

describe("番茄发布排期", () => {
  it("按 perDay 分天排满，数量与目标一致", () => {
    const plan = planSchedule(baseInput);
    expect(plan.slots).toHaveLength(6);
    expect(plan.slots.filter((s) => s.day === 1)).toHaveLength(2);
    expect(plan.slots.filter((s) => s.day === 2)).toHaveLength(2);
    expect(plan.slots.filter((s) => s.day === 3)).toHaveLength(2);
  });

  it("所有槽位都落在配置的时段窗口内", () => {
    const plan = planSchedule(baseInput);
    for (const s of plan.slots) {
      const min = s.at.getHours() * 60 + s.at.getMinutes();
      expect(min).toBeGreaterThanOrEqual(baseInput.windowStartMin);
      expect(min).toBeLessThanOrEqual(baseInput.windowEndMin);
    }
  });

  it("每日章数被硬顶 3 夹住，并给出明确告警", () => {
    const plan = planSchedule({ ...baseInput, perDay: 10, dailyLimit: 10, count: 10 });
    const day1 = plan.slots.filter((s) => s.day === 1);
    expect(day1.length).toBeLessThanOrEqual(FANQIE_DAILY_HARD_CAP);
    expect(plan.warnings.join()).toContain("超过上限");
  });

  it("已过去的时刻不排（今天窗口已过 → 从明天开始）", () => {
    const plan = planSchedule({
      ...baseInput,
      count: 2,
      perDay: 2,
      now: new Date(2026, 11, 1, 12, 0, 0), // 当天中午，08:00-09:00 已过
    });
    expect(plan.slots.length).toBe(2);
    for (const s of plan.slots) {
      expect(s.at.getTime()).toBeGreaterThan(new Date(2026, 11, 1, 12, 0, 0).getTime());
    }
    expect(plan.slots[0].day).toBeGreaterThan(1);
  });

  it("同一个种子生成同一份排期（可复现，便于排查）", () => {
    const a = planSchedule(baseInput);
    const b = planSchedule(baseInput);
    expect(a.slots.map((s) => s.at.toISOString())).toEqual(b.slots.map((s) => s.at.toISOString()));
  });

  it("时段窗口颠倒会自动修正并告警，不会排出 0 章", () => {
    const plan = planSchedule({ ...baseInput, windowStartMin: 600, windowEndMin: 500 });
    expect(plan.slots.length).toBeGreaterThan(0);
    expect(plan.warnings.join()).toMatch(/时段窗口/);
  });

  it("count 为 0 时直接返回空，不产生垃圾告警", () => {
    const plan = planSchedule({ ...baseInput, count: 0 });
    expect(plan.slots).toHaveLength(0);
    expect(plan.warnings).toHaveLength(1);
  });
});
