// ============================================================
// 番茄小说发布 · 类型与常量
// ============================================================
//
// 定位（务必先读）：
//   这是**本机个人验证**用的发布适配层，不上线、不对外、不收集任何数据。
//   平台抓的不是「AI 参与创作」，抓的是「大规模量产低质」（见番茄 2026-02/07 治理公告：
//   拒签 16 万本、清理 5.4 万本、处置账号 5621 个；单日更新上百本直接永久封禁）。
//   所以本模块的设计目标不是「绕过检测」，而是：
//     ① 质量门槛硬卡（字数 / 段落 / AI 味 / 对话人味）——不合格根本发不出去；
//     ② 行为像正常作者（日更上限、时段抖动、从存稿池取稿，不现写现发）；
//     ③ 失败即停（审核驳回不硬发，避免「提醒后不整改」这条红线）。
//   绝不提供多账号矩阵、一键铺书之类必封玩法。

/** 番茄签约作品的单章硬门槛：低于 1000 字平台会拦截更新（公开项目实测一致） */
export const FANQIE_MIN_WORDS = 1000;
/** 番茄快节奏阅读的最佳区间（复用 publish/pipeline.ts 的预设口径） */
export const FANQIE_BEST_WORDS = { min: 1800, max: 2600 } as const;
/** 单段最大字符数：超过就是手机端阅读体验杀手 */
export const FANQIE_MAX_PARAGRAPH = 120;
/** 每日发布上限的硬顶：配置再怎么填也不允许超过，防手滑变「量产」 */
export const FANQIE_DAILY_HARD_CAP = 3;

export type PublishChannel = "api" | "cdp" | "auto";
export type PublishMode = "confirm" | "auto";

/** 发布任务状态机 */
export type PublishTaskStatus =
  | "held"       // 待确认（体检已过，等人点「发」）
  | "scheduled"  // 已排期（到点由调度器处理）
  | "filling"    // 发布中（占位锁，防并发重发）
  | "published"  // 已发布（平台侧已确认）
  | "failed"     // 失败（可重试）
  | "canceled";  // 已取消

export interface FanqieCredentials {
  /** 完整 Cookie 串：从作家后台任意 /api/author/... 请求的 Request Headers 复制 */
  cookie: string;
  /** X-Secsdk-Csrf-Token 头（每次请求必带，否则 403） */
  csrfToken: string;
  /** 抓取时间（用于提示用户 Cookie 可能已过期） */
  capturedAt?: string;
}

export interface FanqieAccountConfig {
  id: string;
  platform: string;
  label: string;
  connected: boolean;
  credentialUpdatedAt: string | null;
  bookId: string | null;
  bookTitle: string | null;
  channel: PublishChannel;
  cdpEndpoint: string;
  autoMode: PublishMode;
  dailyLimit: number;
  windowStartMin: number;
  windowEndMin: number;
}

/** 单条体检项 */
export interface PreflightItem {
  id: string;
  label: string;
  /** block=硬门槛不通过，禁止发布；warn=建议改；ok=通过 */
  level: "block" | "warn" | "ok";
  pass: boolean;
  /** 实测到的事实（带数字，不做黑箱评分） */
  detail: string;
  /** 怎么改（可执行的话，不是空话） */
  hint?: string;
}

export interface PreflightStats {
  words: number;
  paragraphs: number;
  avgParagraphChars: number;
  longParagraphRatio: number;
  dialogueRatio: number;
  /** 复用 humanize 的 AI 痕迹指数 0-100，越高越像机器写的 */
  aiScore: number;
  aiLevel: string;
  /**
   * 每千字 AI 痕迹命中数。
   * 为什么单看 aiScore 不够：它按千字归一，一篇全是同一种套话的稿子
   * 反而会被「密度稀释」压低分数（实测 45 分 / 31 处命中）。
   * 命中密度更能反映"通篇一个味道"，所以两个指标一起看。
   */
  hitsPerK: number;
}

export interface PreflightResult {
  /** 无 block 项才允许发布 */
  pass: boolean;
  /** 质量分 0-100（达标 60 起，用于排序与看板） */
  score: number;
  items: PreflightItem[];
  stats: PreflightStats;
  checkedAt: string;
}

export interface PublishOutcome {
  ok: boolean;
  /** 实际走通的通道 */
  channel: "api" | "cdp";
  /** 平台侧提示（如「审核中」「已存草稿」） */
  note?: string;
  /** 失败原因（人话，能指导下一步动作） */
  error?: string;
  /** 平台原始响应摘要（截断，便于排查又不刷屏） */
  raw?: string;
}

/** 排期槽位 */
export interface ScheduleSlot {
  at: Date;
  /** 第几天（1 起） */
  day: number;
  /** 当天第几章（1 起） */
  seqInDay: number;
}

export interface SchedulePlan {
  slots: ScheduleSlot[];
  warnings: string[];
}

/** 时段分钟数 → "08:30" 展示 */
export function minutesToHHMM(min: number): string {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** "08:30" → 时段分钟数；非法返回 null */
export function hhmmToMinutes(value: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec((value || "").trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  if (h < 0 || h > 23 || mm < 0 || mm > 59) return null;
  return h * 60 + mm;
}
