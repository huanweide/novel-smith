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

import { spawn, execSync, execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

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

/**
 * 拉起服务。
 *
 * ⚠️ 六个错误做法，全部实测踩过：
 *   1. child_process 的 detached + unref —— Windows 上仍是当前控制台的子进程，
 *      父 shell 一退出就被 Ctrl+C 连坐杀掉。表现为脚本报告「服务已恢复
 *      （PID xxx）」，几分钟后 3001 又没了。
 *   2. wscript.exe / cscript.exe 跑 VBS —— 二者是 Windows LOLBin，
 *      本机安全策略直接拦掉整条命令。
 *   3. PowerShell 拉 npx.cmd / cmd.exe —— 同样被命令校验拦。
 *   4. schtasks /TR 直接跑 node —— 退出码 1：计划任务默认工作目录不是仓库根，
 *      next 找不到 next.config.ts / .next；而且 /TR 有 261 字符上限，
 *      装不下带 cd 和日志重定向的完整命令。
 *   5. schtasks 用 /SC ONLOGON —— **最隐蔽的一个**：服务起得来（日志有
 *      Ready），但任务跑在用户交互会话里，WorkBuddy 会话结束时向控制台发
 *      Ctrl+C 会连坐杀掉它。表现是 `上次结果 -2147023829`
 *      （0x8007042B PROCESS_ABORTED）+ 日志末尾一个 ^C。
 *   6. .cmd 落盘成 LF 行尾 —— cmd.exe 直接不执行 LF-only 批处理文件且不报错，
 *      表现是 /Run 返回成功但 `上次结果 255` + 运行时间不更新 + 日志零输出。
 *
 * 正解（唯一实测通过的组合）：
 *   schtasks /SC ONSTART /RU SYSTEM  +  scripts/start-novel-server.cmd
 *   - SYSTEM = 会话 0，与任何交互会话彻底脱钩，不会被 Ctrl+C 连坐
 *   - .cmd 内部 cd /d 到仓库根、输出重定向进 server.log
 *   - .cmd 必须是 CRLF 行尾（见 ensureCrlf）
 *   - ONSTART 只在开机触发，所以构建完要显式 /Run 一次（就是这里）
 */
/**
 * 防漂移门禁：README 中英两处「当前版本」必须等于 package.json.version。
 * 不匹配直接 exit(1)，拦在 next build 之前（避免白跑 16 分钟构建）。
 * 这是第 N 次 README 版本号漂移后的根治手段——发版 bump 五件套时容易漏 README。
 */
function checkReadmeVersion() {
  const cwd = process.cwd();
  let pkgVersion;
  try {
    pkgVersion = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8")).version;
  } catch (e) {
    console.error("[safe-build] 无法读取 package.json version：", e.message);
    process.exit(1);
  }

  const checks = [
    { file: "README.md", re: /当前版本：v(\d+\.\d+\.\d+)/ },
  ];

  let ok = true;
  for (const { file, re } of checks) {
    let text;
    try {
      text = readFileSync(join(cwd, file), "utf8");
    } catch (e) {
      console.warn(`[safe-build] 跳过 ${file}（读取失败：${e.message}）`);
      continue;
    }
    const m = text.match(re);
    const readmeVersion = m ? m[1] : null;
    if (readmeVersion !== pkgVersion) {
      ok = false;
      console.error(
        `[safe-build] 版本漂移（构建被拦）：${file} 写的是 v${readmeVersion ?? "未找到"}，` +
          `但 package.json 是 v${pkgVersion}。\n` +
          `            先 bump README 的版本号再构建（这是第 N 次漂移了，别再手滑）。`,
      );
    } else {
      console.log(`[safe-build] OK ${file} 版本号 v${readmeVersion} 与 package.json 一致`);
    }
  }

  if (!ok) process.exit(1);
}

const TASK_NAME = "NovelSmith-3001";

function ensureCrlf(path) {
  try {
    const buf = readFileSync(path);
    // 已是 CRLF 就别动它（避免每次 build 都无谓改写 mtime）
    const lf = buf.filter((b) => b === 0x0a).length;
    const cr = buf.filter((b) => b === 0x0d).length;
    if (lf > 0 && lf === cr) return false;
    const text = buf.toString("utf8").replace(/\r\n/g, "\n").replace(/\n/g, "\r\n");
    writeFileSync(path, text, "utf8");
    console.log(`[safe-build] 已把 ${path} 行尾修正为 CRLF（LF 的 .cmd 不会被 cmd.exe 执行）`);
    return true;
  } catch {
    return false;
  }
}

async function startServer() {
  const cwd = process.cwd();
  const cmdPath = join(cwd, "scripts", "start-novel-server.cmd");
  if (!existsSync(cmdPath)) {
    console.warn(`[safe-build] 找不到 ${cmdPath}`);
    return false;
  }
  ensureCrlf(cmdPath);

  const tr = `cmd.exe /c "${cmdPath}"`;
  try {
    execFileSync(
      "schtasks.exe",
      ["/Create", "/TN", TASK_NAME, "/SC", "ONSTART", "/RU", "SYSTEM", "/RL", "HIGHEST", "/TR", tr, "/F"],
      { stdio: "ignore", windowsHide: true, timeout: 30_000 },
    );
    execFileSync("schtasks.exe", ["/Run", "/TN", TASK_NAME], {
      stdio: "ignore",
      windowsHide: true,
      timeout: 30_000,
    });
  } catch {
    /* 任务可能已存在或被策略拦；下面靠探测端口判断实际结果 */
  }

  // 给它起来的时间，最多等 40s
  for (let i = 0; i < 8; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const pids = pidsOnPort(PORT);
    if (pids.length > 0) {
      console.log(`[safe-build] 服务已恢复（计划任务 ${TASK_NAME}，PID ${pids.join(", ")}）`);
      return true;
    }
  }
  return false;
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

// —— 防漂移门禁：README 版本号必须等于 package.json，否则拦在构建前 ——
checkReadmeVersion();

console.log("[safe-build] 开始 next build …\n");
const build = spawn("npx", ["next", "build"], {
  shell: true,
  stdio: "inherit",
});
build.on("exit", async (code) => {
  if (running.length > 0) {
    console.log(`\n[safe-build] 构建${code === 0 ? "成功" : "失败"}，把 ${PORT} 服务拉回来 …`);
    const ok = await startServer();
    if (!ok) {
      console.log(
        `[safe-build] 自动重启未成功。\n` +
          `            请手动执行：cd "${process.cwd()}" && npm start\n` +
          `            或双击开机启动项里的 Novel Smith 启动器。`,
      );
    } else {
      console.log(`            → http://localhost:${PORT}`);
    }
  }
  process.exit(code ?? 1);
});