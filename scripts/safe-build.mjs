/**
 * 安全构建（safe build）—— 解决「跑着 3001 服务时 next build 把服务搞崩」
 *
 * ## 病根
 * `next build` 会**清空并重建 `.next` 目录**。如果 `next start` / `next dev`
 * 正在跑，它持有的旧 chunk 文件句柄会在目录被替换的瞬间失效，
 * 进程直接崩溃退出，表现为「localhost:3001 又开不开了」。
 *
 * 这个坑的特点是：build 成功 ✅ / commit 成功 ✅ / push 成功 ✅，
 * 但服务器没了 —— 很容易以为「服务自己挂了」，其实是自己把它撞死的。
 *
 * ## 做法
 *   1. build 前：netstat 找 3001 的 PID，有就记下来并停掉
 *   2. 正常跑 next build
 *   3. build 后：如果之前在跑，自动 next start 拉回来
 *
 * 只在**原来有服务**时才自动重启，不凭空拉起。
 *
 * 用法：npm run build（已接管）；直接跑 npx next build 仍会踩坑，别用。
 */

import { spawn, execSync } from "node:child_process";
import { openSync } from "node:fs";

const PORT = "3001";

/** 找出监听指定端口的 PID 集合 */
function pidsOnPort(port) {
  const out = new Set();
  let text = "";
  try {
    text = execSync("netstat -ano", { encoding: "utf8", windowsHide: true });
  } catch {
    return [];
  }
  for (const line of text.split(/\r?\n/)) {
    if (!line.includes(`:${port}`)) continue;
    if (!/LISTENING/i.test(line)) continue;
    const cols = line.trim().split(/\s+/);
    const pid = cols[cols.length - 1];
    if (pid && /^\d+$/.test(pid)) out.add(pid);
  }
  return [...out];
}

/**
 * 确认 PID 确实是 node 进程再杀。
 * PID 会被系统复用——万一同号被别的程序占着，盲 kill 就是拿别人的命。
 */
function isNodeProcess(pid) {
  try {
    const out = execSync(`tasklist /FI "PID eq ${pid}" /NH`, {
      encoding: "utf8",
      windowsHide: true,
    });
    return /node\.exe/i.test(out);
  } catch {
    return false;
  }
}

function kill(pid) {
  try {
    execSync(`taskkill /PID ${pid} /F /T`, {
      stdio: "ignore",
      windowsHide: true,
    });
    return true;
  } catch {
    return false;
  }
}

const running = pidsOnPort(PORT).filter((pid) => {
  if (isNodeProcess(pid)) return true;
  console.warn(`[safe-build] ${PORT} 上的 PID ${pid} 不是 node 进程，跳过（避免误杀）`);
  return false;
});
if (running.length > 0) {
  console.log(`[safe-build] 检测到 ${PORT} 上有服务在跑（PID ${running.join(", ")}）`);
  console.log("[safe-build] 先停掉它 —— 否则 next build 重建 .next 会把服务撞崩");
  for (const pid of running) {
    console.log(`  停止 PID ${pid} … ${kill(pid) ? "OK" : "失败"}`);
  }
  // 给操作系统一点时间回收句柄
  await new Promise((r) => setTimeout(r, 1500));
  const still = pidsOnPort(PORT);
  if (still.length > 0) {
    console.warn(`[safe-build] 警告：${still.join(", ")} 仍在监听，继续构建可能有冲突`);
  }
} else {
  console.log(`[safe-build] ${PORT} 上没有服务，直接构建`);
}

console.log("[safe-build] 开始 next build …\n");
const build = spawn("npx", ["next", "build"], {
  shell: true,
  stdio: "inherit",
});
build.on("exit", async (code) => {
  if (running.length > 0) {
    console.log(`\n[safe-build] 构建${code === 0 ? "成功" : "失败"}，把 ${PORT} 服务拉回来 …`);
    const log = openSync("server.log", "a");
    const child = spawn("npx", ["next", "start", "-p", PORT], {
      detached: true,
      stdio: ["ignore", log, log],
      shell: true,
    });
    child.unref();
    await new Promise((r) => setTimeout(r, 4000));
    const back = pidsOnPort(PORT);
    console.log(
      back.length > 0
        ? `[safe-build] 服务已恢复（PID ${back.join(", ")}）→ http://localhost:${PORT}`
        : `[safe-build] 自动重启未成功，请手动跑 npm start`,
    );
  }
  process.exit(code ?? 1);
});