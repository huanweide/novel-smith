// ============================================================
// 番茄小说发布 · 调度执行器（tick）
// ============================================================
//
// 谁在调它：
//   src/instrumentation.ts 在服务端启动后每 60 秒调一次 runPublishTick()。
//   因为 Electron 版内嵌的就是这个 Next server，所以「主进程调度」与
//   「web 端调度」其实是同一份代码——app 开着就跑，关掉就停，不存在两套逻辑。
//
// 安全阀（全部硬编码，不开放配置）：
//   ① 每日发布数 ≤ min(账号 dailyLimit, 3)——防手滑变「量产」（番茄红线）；
//   ② 同一账号连续 2 次失败 → 自动暂停当天余下任务（避免「驳回后仍硬发」）；
//   ③ 体检 block 的任务直接判失败，绝不发出去；
//   ④ filling 状态超过 10 分钟视为进程中断，允许重新领取（幂等靠这个超时）。

import { prisma } from "@/lib/prisma";
import { preflightChapter } from "./preflight";
import { publishChapter } from "./publisher";
import { decryptCredentials } from "./credentials";
import { FANQIE_DAILY_HARD_CAP, type FanqieCredentials } from "./types";

const FILLING_TIMEOUT_MS = 10 * 60 * 1000;

async function log(accountId: string | null, taskId: string | null, level: "info" | "warn" | "error", message: string, detail?: string) {
  await prisma.publishLog
    .create({ data: { accountId, taskId, level, message, detail: detail?.slice(0, 4000) } })
    .catch(() => undefined);
}

function startOfToday(): Date {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export interface TickResult {
  scanned: number;
  published: number;
  failed: number;
  skipped: number;
  notes: string[];
}

/**
 * 执行一轮调度。可安全重复调用（内部用状态机 + 超时锁保证幂等）。
 */
export async function runPublishTick(): Promise<TickResult> {
  const result: TickResult = { scanned: 0, published: 0, failed: 0, skipped: 0, notes: [] };

  const accounts = await prisma.publishAccount.findMany({ where: { platform: "fanqie" } });
  if (accounts.length === 0) return result;

  for (const account of accounts) {
    // ── 每日上限（按「已发布」计数，不按任务数）──
    const limit = Math.min(account.dailyLimit || 1, FANQIE_DAILY_HARD_CAP);
    const publishedToday = await prisma.publishTask.count({
      where: { accountId: account.id, status: "published", publishedAt: { gte: startOfToday() } },
    });
    if (publishedToday >= limit) {
      result.skipped++;
      continue;
    }

    const now = new Date();
    const due = await prisma.publishTask.findMany({
      where: {
        accountId: account.id,
        status: "scheduled",
        scheduledAt: { lte: now },
      },
      orderBy: { scheduledAt: "asc" },
      take: Math.max(0, limit - publishedToday),
    });

    // 把「卡在 filling 太久」的任务放回队列（进程中断留下的）
    const stale = await prisma.publishTask.findMany({
      where: { accountId: account.id, status: "filling" },
    });
    for (const t of stale) {
      if (now.getTime() - t.updatedAt.getTime() > FILLING_TIMEOUT_MS) {
        await prisma.publishTask.update({
          where: { id: t.id },
          data: { status: "scheduled", lastError: "上一次发布中断（超时），已重新排队" },
        });
        await log(account.id, t.id, "warn", "发布中断，任务已重新排队");
      }
    }

    const cred: FanqieCredentials | null = decryptCredentials(account.credentialCipher);
    if (!cred && account.channel === "api") {
      await log(account.id, null, "error", "账号未连接或凭据解密失败，跳过本轮（接口通道需要 Cookie）");
      result.skipped++;
      continue;
    }

    let consecutiveFailures = 0;

    for (const task of due) {
      result.scanned++;

      if (consecutiveFailures >= 2) {
        await prisma.publishTask.update({
          where: { id: task.id },
          data: { status: "held", lastError: "账号连续失败，已暂停，需人工处理" },
        });
        result.skipped++;
        continue;
      }

      // 领任务（条件更新，避免并发重复发）
      const claimed = await prisma.publishTask.updateMany({
        where: { id: task.id, status: "scheduled" },
        data: { status: "filling", attempts: { increment: 1 } },
      });
      if (claimed.count === 0) continue;

      // 体检：不合格直接失败，绝不发出去
      const pre = preflightChapter({
        title: task.chapterTitle,
        content: task.content,
        chapterOrder: task.chapterOrder,
      });
      await prisma.publishTask.update({
        where: { id: task.id },
        data: { preflight: JSON.stringify(pre) },
      });
      if (!pre.pass) {
        const firstBlock = pre.items.find((i) => i.level === "block");
        await prisma.publishTask.update({
          where: { id: task.id },
          data: { status: "failed", lastError: `体检未过：${firstBlock?.label || "硬门槛"} —— ${firstBlock?.detail || ""}` },
        });
        await log(account.id, task.id, "error", "体检未过，已拦下未发布", firstBlock?.hint);
        result.failed++;
        consecutiveFailures++;
        continue;
      }

      const outcome = await publishChapter({
        channel: account.channel === "cdp" ? "cdp" : account.channel === "api" ? "api" : "auto",
        cdpEndpoint: account.cdpEndpoint,
        cred,
        bookId: account.bookId || "",
        title: task.chapterTitle,
        content: task.content,
      });

      if (outcome.ok) {
        await prisma.publishTask.update({
          where: { id: task.id },
          data: {
            status: "published",
            publishedAt: new Date(),
            channel: outcome.channel,
            lastError: null,
          },
        });
        await log(account.id, task.id, "info", `第 ${task.chapterOrder} 章已发布（${outcome.channel}）`, outcome.note);
        result.published++;
        consecutiveFailures = 0;
      } else {
        await prisma.publishTask.update({
          where: { id: task.id },
          data: { status: "failed", channel: outcome.channel, lastError: outcome.error || "未知错误" },
        });
        await log(account.id, task.id, "error", `第 ${task.chapterOrder} 章发布失败`, outcome.error);
        result.failed++;
        consecutiveFailures++;
      }
    }

    if (consecutiveFailures >= 2) {
      result.notes.push("连续失败 2 次，已暂停该账号的排队任务，请先检查凭据/浏览器/内容");
      await log(account.id, null, "warn", "连续失败 2 次，调度已自动暂停（防「驳回后仍硬发」）");
    }
  }

  return result;
}
