// ============================================================
// 番茄小说发布 · 排期计算（纯函数，零 IO，可单测）
// ============================================================
//
// 排期不是「炫技的随机」，目的只有两个：
//   1. 不触发「量产」特征——日更上限硬卡在 3 章，绝不出现一天几十章；
//   2. 像人——固定时段 + 分钟级抖动（作者不会每天 08:00:00 整点发）。
//
// 注意：这里**不做**「随机打乱章节顺序」这类操作。章节必须按序发布，
// 乱序会让读者看不懂，也会让平台判定为异常更新。

import { FANQIE_DAILY_HARD_CAP, type SchedulePlan, type ScheduleSlot } from "./types";

/** 确定性伪随机（mulberry32）：同一个 seed 生成同一份排期，便于测试与复现 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface ScheduleInput {
  /** 起始日期 YYYY-MM-DD（当地时区） */
  startDate: string;
  /** 要排多少章 */
  count: number;
  /** 每天几章（会被 dailyLimit 与硬顶夹住） */
  perDay: number;
  /** 账号配置的每日上限 */
  dailyLimit: number;
  /** 时段窗口（从 0 点起的分钟数） */
  windowStartMin: number;
  windowEndMin: number;
  /** 当前时间：早于它的槽位顺延到下一个可行日 */
  now?: Date;
  /** 随机种子（缺省用时间戳） */
  seed?: number;
}

/**
 * 生成排期。
 *
 * 槽位规则：
 *   - 每天最多 min(perDay, dailyLimit, 3) 章；
 *   - 当天窗口被等分成 N 段，每段取中点后 ±20% 段长的抖动（最多 ±20 分钟）；
 *   - 已过去的时刻不排（顺延到次日），避免「排完立刻补发一堆」变成批量更新。
 */
export function planSchedule(input: ScheduleInput): SchedulePlan {
  const warnings: string[] = [];
  const now = input.now ?? new Date();
  const count = Math.max(0, Math.floor(input.count));
  if (count === 0) return { slots: [], warnings: ["没有待排章节"] };

  let daily = Math.floor(input.perDay);
  if (daily < 1) daily = 1;
  const capped = Math.min(daily, input.dailyLimit, FANQIE_DAILY_HARD_CAP);
  if (capped !== daily) {
    warnings.push(
      `每天 ${daily} 章超过上限，已压到 ${capped} 章/天（硬顶 ${FANQIE_DAILY_HARD_CAP} 章，防「量产」判定）`,
    );
  }
  daily = capped;

  let startMin = Math.max(0, Math.min(1439, Math.floor(input.windowStartMin)));
  let endMin = Math.max(0, Math.min(1439, Math.floor(input.windowEndMin)));
  if (endMin <= startMin) {
    endMin = Math.min(1439, startMin + 60);
    warnings.push(`时段窗口结束早于开始，已自动改为 ${startMin}-${endMin} 分钟`);
  }

  const rand = mulberry32(input.seed ?? Date.now());

  // 解析起始日期（本地时区零点）
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input.startDate);
  const base = m
    ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
    : new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (!m) warnings.push("起始日期格式不对（应为 YYYY-MM-DD），已按今天计算");

  const slots: ScheduleSlot[] = [];
  const span = endMin - startMin;
  const seg = span / daily;
  // 抖动幅度：段长的 20%，最多 20 分钟——够「不像机器」，又不会窜出窗口
  const jitterMax = Math.min(20, Math.max(1, Math.round(seg * 0.2)));

  let dayOffset = 0;
  let guard = 0;
  while (slots.length < count && guard < 400) {
    guard++;
    const day = new Date(base.getFullYear(), base.getMonth(), base.getDate() + dayOffset);
    for (let i = 0; i < daily && slots.length < count; i++) {
      const center = startMin + seg * (i + 0.5);
      const jitter = (rand() * 2 - 1) * jitterMax;
      const at = new Date(day);
      at.setMinutes(Math.round(Math.max(startMin, Math.min(endMin, center + jitter))));
      // 已过去的时刻不排（今天 08:00 的窗口，10 点才排期 → 从明天开始）
      if (at.getTime() <= now.getTime()) continue;
      slots.push({ at, day: dayOffset + 1, seqInDay: i + 1 });
    }
    dayOffset++;
    // 一天都排不进（窗口已过）就继续往后找，但别无限循环
    if (dayOffset > 365) break;
  }

  if (slots.length < count) {
    warnings.push(`只排出 ${slots.length} 章（目标 ${count} 章），请检查起始日期与时段窗口`);
  }

  return { slots, warnings };
}

/** 把槽位格式化成人能读的一行，用于看板 */
export function describeSlot(slot: ScheduleSlot): string {
  const d = slot.at;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
