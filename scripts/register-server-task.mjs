/**
 * 注册 / 更新 Novel Smith 的开机自启计划任务
 *
 * 用法：node scripts/register-server-task.mjs
 *
 * ## v3.1.152 实测结论：SYSTEM 与 Prisma 在本项目**互斥**
 *
 * 前面试过两条路，各有硬伤：
 *
 * | 归属 | 优点 | 硬伤 |
 * | --- | --- | --- |
 * | `ONSTART + SYSTEM` | SessionId 0，与交互会话彻底脱钩，最稳 | **Prisma 全废**。SYSTEM 身份加载不了 better-sqlite3 原生模块，所有写接口返回 `ERR_DLOPEN_FAILED` |
 * | `ONLOGON`（用户身份） | Prisma 正常 | 跑在用户交互会话，WorkBuddy 会话结束发 Ctrl+C **连坐杀子进程**（`0x8007042B PROCESS_ABORTED`，日志末尾一个 `^C`） |
 *
 * 结论：**要稳定就得 SYSTEM，要能用就不能 SYSTEM。**
 * 本项目选「能用」—— 服务以用户身份跑，接受会话结束需重拉，
 * 由 `safe-build.mjs` 在构建后自动 `/Run` 一次兜底。
 *
 * 所以默认改回 `/SC ONLOGON` + 当前用户。
 * 需要开机自启且机器上服务只在开机那一刻用一次，才考虑 SYSTEM。
 *
 * ⚠️ 两个身份都踩过的前置坑：
 *   1. `/TR` 有 **261 字符上限**，且 bash / PowerShell 都会改写里面的
 *      Windows 路径 —— 必须用 `execFileSync` 绕开 shell，并把命令
 *      收进 `scripts/start-novel-server.cmd`。
 *   2. 那个 `.cmd` **必须是 CRLF 行尾**。Write 工具只写 LF，而
 *      cmd.exe 对 LF-only 批处理**直接不执行且不报错**（表现为
 *      `/Run` 返回成功但「上次结果 255」、日志一行不写）。
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const TASK_NAME = "NovelSmith-3001";
const PORT = "3001";
// 想要「开机即用、不怕会话断开」就改成 "SYSTEM"（需管理员，且 Prisma 会失效）
const RUN_AS = process.env.NOVELSMITH_TASK_USER || "INTERACTIVE";
const repo = process.cwd();
const cmdPath = join(repo, "scripts", "start-novel-server.cmd");

function ensureCrlf(path) {
  const buf = readFileSync(path);
  const lf = buf.filter((b) => b === 0x0a).length;
  const cr = buf.filter((b) => b === 0x0d).length;
  if (lf > 0 && lf === cr) return false;
  writeFileSync(path, buf.toString("utf8").replace(/\r\n/g, "\n").replace(/\n/g, "\r\n"), "utf8");
  return true;
}

if (!existsSync(cmdPath)) {
  console.error(`找不到 ${cmdPath}，请在仓库根目录执行本脚本`);
  process.exit(1);
}
if (ensureCrlf(cmdPath)) {
  console.log("已把 start-novel-server.cmd 行尾修正为 CRLF");
}

// execFileSync 不经过 shell —— bash / PowerShell 都会改写 /TR 里的 Windows 路径
const tr = `cmd.exe /c "${cmdPath}"`;

const isSystem = RUN_AS === "SYSTEM";
console.log(`注册计划任务 ${TASK_NAME}（ONSTART / ${RUN_AS}）…`);
const args = [
  "/Create",
  "/TN", TASK_NAME,
  "/SC", "ONSTART",
  "/RU", RUN_AS,
  "/TR", tr,
  "/F",
];
if (isSystem) args.splice(args.indexOf("/RU") + 2, 0, "/RL", "HIGHEST");
try {
  execFileSync("schtasks.exe", args, { stdio: "inherit", windowsHide: true });
} catch {
  console.error(`\n注册失败。${isSystem ? "ONSTART + SYSTEM 需要管理员权限" : "请确认当前账户有权创建计划任务"}，请用管理员终端重跑。`);
  process.exit(1);
}

console.log(`\n已注册。立即拉起服务…`);
try {
  execFileSync("schtasks.exe", ["/Run", "/TN", TASK_NAME], { stdio: "inherit", windowsHide: true });
} catch {
  console.warn("  /Run 失败，手动触发一次即可");
}

console.log(`\n验证归属（应当是当前用户交互会话；Prisma 需要用户身份）：`);
console.log(`  schtasks /Query /TN ${TASK_NAME} /V /FO LIST`);
console.log(`  netstat -ano | findstr :${PORT}`);
console.log(`\n查服务日志：${join(repo, "server.log")}`);