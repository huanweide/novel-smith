/**
 * Next.js instrumentation：服务端启动后注册一次性后台定时器。
 *
 * 为什么调度放这里而不是 Electron 主进程：
 *   Electron 版内嵌的就是这个 Next server —— app 打开 → server 启动 → 定时器开始跑；
 *   app 关掉 → server 退出 → 定时器停。与「主进程调度」行为完全一致，
 *   但只维护一份代码，dev（npm run dev）和打包版都能用。
 *
 * 安全：只在 Node runtime 注册，且用 globalThis 标记防止热更新重复注册
 *      （否则 dev 下每次热重载都会多一个 interval，一小时后能把平台刷爆）。
 */

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const g = globalThis as any;
  if (g.__publishTimer) return;

  const INTERVAL_MS = 60_000;
  g.__publishTimer = setInterval(async () => {
    try {
      // 动态 import：避免 instrumentation 阶段就把 prisma/发布模块打进冷启动路径
      const { runPublishTick } = await import("./core/publish/fanqie/runner");
      const r = await runPublishTick();
      if (r.published || r.failed) {
        console.log(`[publish-tick] 发布 ${r.published}，失败 ${r.failed}，跳过 ${r.skipped}`);
      }
    } catch (e) {
      console.warn("[publish-tick] 本轮失败：", (e as Error).message);
    }
  }, INTERVAL_MS);

  // dev 下进程重启时清掉，避免残留多个 interval
  if (typeof process.on === "function") {
    process.once("SIGTERM", () => clearInterval(g.__publishTimer));
    process.once("SIGINT", () => clearInterval(g.__publishTimer));
  }
}
