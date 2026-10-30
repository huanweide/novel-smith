// novel-smith 桌面版 · Electron 主进程（M2：本地优先 + 进程内 Next 服务）
// 设计要点：
//  1. 不 spawn 外部 `npm`/`node` —— 直接在主进程 Node 上下文里跑 Next 自定义服务器，
//     彻底摆脱"打包后没有 node 二进制"的坑，最稳。
//  2. 单实例锁：重复双击只聚焦已有窗口。
//  3. 数据落盘到用户目录（文档/NovelSmith），不写进安装目录，重装不丢书稿。
//  4. 首次启动自动 `prisma db push` 建表（用 Electron 自身跑，幂等，覆盖全新/升级用户）。
//  5. 服务就绪后自动播种内置示范预设（/api/seed/presets，幂等去重）。
//  6. 托盘：最小化到托盘、右键退出。
//  7. 优雅退出：先关 HTTP 服务再 quit，避免端口/进程残留。
// —— 启动日志（最先执行，先于任何 require，确认主进程是否加载）——
const fs = require("fs");
const LOG_PATH = "C:\\Users\\Administrator\\ns-app.log";
function logf(m) { try { fs.appendFileSync(LOG_PATH, new Date().toISOString() + " " + m + "\n"); } catch {} }
logf("main.js TOP before requires");

const { app, BrowserWindow, Tray, Menu, shell, nativeImage, dialog } = require("electron");
const path = require("path");
const http = require("http");
const { spawn } = require("child_process");
logf("requires (electron/path/http/spawn) ok");

// 打包态：asarUnpack 把 node_modules 解包到 resources/app.asar.unpacked（而非随 app.asar 一起），
// 但 main.js 本身在 app.asar 内。若不加这一行，require("next") / require("electron-updater")
// 在 app.asar 内找不到 app.asar.unpacked/node_modules，会直接抛错。
// 因此把解包后的 node_modules 目录前置到 module.paths，让顶层 require 能正确解析。
if (app.isPackaged) {
  const unpackedNm = path.join(process.resourcesPath, "app.asar.unpacked", "node_modules");
  if (fs.existsSync(unpackedNm) && module.paths.indexOf(unpackedNm) === -1) {
    module.paths.unshift(unpackedNm);
    logf("added unpacked node_modules to module.paths: " + unpackedNm);
  } else {
    logf("unpacked node_modules not found at " + unpackedNm);
  }
}
let next;
try { next = require("next"); logf("require next OK"); }
catch (e) { logf("require next FAIL: " + (e && e.stack ? e.stack : e)); throw e; }

// 端口可被环境变量 NS_PORT 覆盖（默认 3001）。当 3001 被占用时，用户可用 NS_PORT=30xx 避开，
// 避免硬编码端口冲突导致“启动即退出”。
const PORT = parseInt(process.env.NS_PORT || "3001", 10);
const isDev = !app.isPackaged;
// 向进程内 Next 服务暴露打包态，供 /api/health 区分桌面端/Web 文案（避免给桌面用户推 npm 命令）
process.env.NS_IS_PACKAGED = String(app.isPackaged);
// 打包态：asar 开启后，asarUnpack 的解包内容落在 resources/app.asar.unpacked（而非 resources/app）。
// 故 appRoot 优先指 app.asar.unpacked；兼容旧打包回退到 resources/app。
const appRoot = (() => {
  if (!app.isPackaged) return app.getAppPath();
  const candidates = [
    path.join(process.resourcesPath, "app.asar.unpacked"),
    path.join(process.resourcesPath, "app"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, ".next", "BUILD_ID"))) return c;
  }
  return candidates[0];
})();

// 打包态：Next 初始化要求 dir（appRoot）下存在 package.json（读取项目元信息/配置）。
// 但 package.json 为了 Electron 能解析 main 而保留在 app.asar 内，不会出现在 appRoot。
// 故在启动时从 app.asar/package.json 复制一份到 appRoot（幂等，已存在则跳过）。
if (app.isPackaged && appRoot) {
  const srcPkg = path.join(process.resourcesPath, "app.asar", "package.json");
  const dstPkg = path.join(appRoot, "package.json");
  if (fs.existsSync(srcPkg) && !fs.existsSync(dstPkg)) {
    try {
      fs.copyFileSync(srcPkg, dstPkg);
      logf("copied package.json -> " + dstPkg);
    } catch (e) {
      logf("copy package.json FAIL: " + (e && e.message));
    }
  } else {
    logf("package.json at appRoot already present or source missing");
  }
}
const iconPath = path.join(appRoot, "assets", "icon.png");

// —— 调试探针：设 NS_DIAG=1 时写启动日志，便于无头环境验证主进程是否被自动加载 ——
// 注意：写入用户临时目录（C 盘根可能无写入权限），保证探测可落地。
if (process.env.NS_DIAG) {
  try {
    const tmpDir = process.env.TEMP || process.env.TMP || "C:\\Temp";
    fs.appendFileSync(path.join(tmpDir, "ns-main-loaded.log"), "MAIN LOADED isPackaged=" + app.isPackaged + " " + new Date().toISOString() + "\n");
  } catch {}
}

// —— 单实例锁 ——
if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

let server = null;
let win = null;
let tray = null;

// 用户数据目录：书稿/库文件落这里，重装不丢
function resolveDataDir() {
  const candidates = [
    path.join(app.getPath("documents"), "NovelSmith"),
    path.join(app.getPath("home"), "NovelSmith"),
    app.getPath("userData"),
  ];
  for (const dir of candidates) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      return dir;
    } catch {
      /* 下一个候选 */
    }
  }
  return app.getPath("userData");
}

// 用 Electron 自身（与打包运行时同 ABI）跑 prisma db push，确保本地 SQLite 表结构就位。
// 幂等：全新库建表、已有库补列，失败不阻塞启动（后续仍可用模板/手动修复）。
// 关键修复（P1）：① 注入 ELECTRON_RUN_AS_NODE，让 prisma CLI 以 node 语义执行，
// 避免 Electron 二进制按 GUI 进程初始化导致 db push 行为异常（A4 不确定项）；
// ② 捕获 stdout/stderr 写入 ns-app.log，失败不再静默；③ 返回值被主流程消费，用于置
// NS_SCHEMA_INIT_FAILED 供 /api/health 反向告警（双保险，杜绝假绿灯）。
function ensureSchema(userDbPath) {
  return new Promise((resolve) => {
    const prismaCli = path.join(appRoot, "node_modules", "prisma", "build", "index.js");
    if (!fs.existsSync(prismaCli)) {
      console.warn("[ns] 未找到 prisma CLI，跳过自动建表（请确认随包分发）");
      logf("ensureSchema FAIL: prismaCli 不存在 -> " + prismaCli);
      return resolve(false);
    }
    const env = { ...process.env, DATABASE_URL: "file:" + userDbPath, ELECTRON_RUN_AS_NODE: "1" };
    let buf = "";
    const cp = spawn(process.execPath, [prismaCli, "db", "push", "--accept-data-loss"], {
      cwd: appRoot,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    if (cp.stdout) cp.stdout.on("data", (d) => (buf += d.toString()));
    if (cp.stderr) cp.stderr.on("data", (d) => (buf += d.toString()));
    let settled = false;
    const done = (ok, note) => {
      if (settled) return;
      settled = true;
      if (ok) logf("ensureSchema OK");
      else {
        logf("ensureSchema FAIL" + (note ? " (" + note + ")" : "") + ": " + buf.slice(0, 1000));
        console.warn("[ns] 数据库自动建表失败，详见 ns-app.log" + (note ? "（" + note + "）" : ""));
      }
      resolve(ok);
    };
    cp.on("error", (e) => done(false, "spawn error: " + e.message));
    cp.on("close", (code) => done(code === 0, "exit code " + code));
    // 最多等 90s，超时当作失败继续，不卡住启动
    setTimeout(() => { try { cp.kill(); } catch { /* noop */ } done(false, "timeout 90s"); }, 90000);
  });
}

// 服务就绪后播种内置预设（幂等，已存在则跳过）
function seedPresets() {
  const url = `http://127.0.0.1:${PORT}/api/seed/presets`;
  const req = http.request(url, { method: "POST" }, (res) => {
    res.on("data", () => {});
    res.on("end", () => console.log("[ns] 内置预设播种完成（HTTP", res.statusCode, "）"));
  });
  req.on("error", () => { /* 非致命，忽略 */ });
  req.end();
}

// —— 自动更新（electron-updater）——
// 设计要点：
//  - 模块缺失 / feed 未配置 / 检查失败 都只记 warning，绝不阻塞启动或打开窗口。
//  - 启动后静默检查（不打断用户）；托盘提供"检查更新"手动入口。
//  - 发现新版本弹窗询问，确认后才下载；下载完成再提示重启安装。
//  - feed 默认走 GitHub Releases（依据 appId 推断）；可用环境变量 NS_UPDATE_FEED 覆盖为自托管地址。
function setupAutoUpdater() {
  let autoUpdater;
  try {
    autoUpdater = require("electron-updater").autoUpdater;
  } catch (e) {
    console.warn("[ns] 未安装 electron-updater，跳过自动更新");
    return;
  }
  const feed = process.env.NS_UPDATE_FEED;
  if (feed) {
    try {
      autoUpdater.setFeedURL({ provider: "generic", url: feed });
    } catch (e) {
      console.warn("[ns] setFeedURL 失败：", e.message);
    }
  }
  autoUpdater.autoDownload = false;
  autoUpdater.allowDowngrade = false;

  autoUpdater.on("update-available", (info) => {
    console.log("[ns] 发现新版本：", info && info.version);
    if (!win) return;
    dialog
      .showMessageBox(win, {
        type: "info",
        title: "发现新版本",
        message: `检测到新版本 v${info && info.version ? info.version : "?"}，是否立即下载并更新？`,
        buttons: ["现在更新", "稍后"],
        cancelId: 1,
      })
      .then(({ response }) => {
        if (response === 0) autoUpdater.downloadUpdate();
      });
  });

  autoUpdater.on("update-downloaded", () => {
    if (!win) return;
    dialog
      .showMessageBox(win, {
        type: "info",
        title: "更新已就绪",
        message: "新版本已下载完成，重启以应用更新？",
        buttons: ["重启更新", "稍后"],
        cancelId: 1,
      })
      .then(({ response }) => {
        if (response === 0) autoUpdater.quitAndInstall();
      });
  });

  autoUpdater.on("update-not-available", () => console.log("[ns] 当前已是最新版本"));
  autoUpdater.on("error", (e) => console.warn("[ns] 自动更新检查失败：", e && e.message));

  // 启动后静默检查（失败静默忽略）
  autoUpdater.checkForUpdatesAndNotify().catch(() => {});
  global.__nsUpdater = autoUpdater;
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: "Novel Smith · AI 长篇网文写作工坊",
    icon: iconPath,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      // 本地优先：不加载任何远程内容，所有数据走本地 SQLite
    },
  });

  // 外链用系统浏览器打开，避免脱离沙箱
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  win.loadURL(`http://127.0.0.1:${PORT}`);

  win.on("closed", () => { win = null; });
  // 关闭窗口不退出，缩到托盘
  win.on("close", (e) => {
    if (!app.isQuiting) {
      e.preventDefault();
      win.hide();
    }
  });
}

function createTray() {
  let img;
  try { img = nativeImage.createFromPath(iconPath); } catch { img = undefined; }
  if (img && img.isEmpty()) img = undefined;
  tray = new Tray(img || nativeImage.createEmpty());
  const ctx = Menu.buildFromTemplate([
    { label: "打开 Novel Smith", click: () => { if (!win) createWindow(); else { win.show(); win.focus(); } } },
    { label: "检查更新", click: () => { if (global.__nsUpdater) global.__nsUpdater.checkForUpdatesAndNotify().catch(() => {}); else dialog.showErrorBox("更新不可用", "未启用自动更新模块"); } },
    { type: "separator" },
    { label: "退出", click: () => { app.isQuiting = true; app.quit(); } },
  ]);
  tray.setToolTip("Novel Smith · AI 长篇网文写作工坊");
  tray.setContextMenu(ctx);
  tray.on("click", () => { if (!win) createWindow(); else { win.show(); win.focus(); } });
}

app.on("second-instance", () => {
  if (!win) createWindow();
  else { win.show(); win.focus(); }
});

app.whenReady().then(async () => {
 try {
  logf("whenReady start");
  const dataDir = resolveDataDir();
  const userDbPath = path.join(dataDir, "novelforge.db");

  // 1) 先确保表结构（用 Electron 自身跑 prisma db push，幂等）
  const schemaOk = await ensureSchema(userDbPath);
  if (!schemaOk) {
    // 建表失败：置标记供 /api/health 反向告警，避免自检假绿灯误导用户
    process.env.NS_SCHEMA_INIT_FAILED = "1";
    logf("WARN: ensureSchema 返回 false，数据库可能缺表，将继续启动但部分功能可能受限");
  }

  // 2) 数据库路径指向用户目录；工作目录切到用户目录，避免相对路径写进只读安装目录
  process.env.DATABASE_URL = "file:" + userDbPath;
  try { process.chdir(dataDir); } catch { /* 忽略，DATABASE_URL 已是绝对路径 */ }

  // 3) 进程内拉起 Next 生产服务
  const nextApp = next({ dev: isDev, dir: appRoot });
  await nextApp.prepare();
  const handler = nextApp.getRequestHandler();
  server = http.createServer((req, res) => handler(req, res));
  // HMR 的 WebSocket 只在开发态需要；打包后无 upgrade，直接忽略避免误触发
  if (isDev) {
    server.on("upgrade", (req, socket, head) => {
      const up = nextApp.getUpgradeHandler ? nextApp.getUpgradeHandler() : null;
      if (up) up(req, socket, head);
      else socket.destroy();
    });
  }
  server.on("error", (err) => {
    if (err && err.code === "EADDRINUSE") {
      console.error(`[ns] 端口 ${PORT} 被占用，无法启动本地服务`);
      try {
        dialog.showErrorBox(
          "无法启动本地服务",
          `本地端口 ${PORT} 已被其他程序占用。请关闭占用该端口的程序后重试，\n或通过环境变量 NS_PORT 指定其他端口（例如 3002）。`
        );
      } catch {}
    } else {
      console.error("[ns] 本地服务启动失败：", err && err.message);
    }
    app.quit();
  });
  await new Promise((resolve) => server.listen(PORT, "127.0.0.1", resolve));
  logf("server listening on " + PORT);

  // 4) 窗口 + 托盘
  createWindow();
  createTray();

  // 5) 服务就绪后播种内置预设（幂等）
  seedPresets();

  // 6) 启动自动更新检查（静默，失败不影响使用）
  setupAutoUpdater();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
  logf("whenReady done, server listening on " + PORT);
 } catch (e) {
  logf("FATAL whenReady: " + (e && e.stack ? e.stack : e));
  try { dialog.showErrorBox("启动失败", String((e && e.message) || e)); } catch {}
  app.quit();
 }
});

function shutdown() {
  if (server) {
    try { server.close(); } catch { /* noop */ }
    server = null;
  }
}

app.on("window-all-closed", () => { /* 留在托盘，不退出 */ });

app.on("before-quit", () => {
  app.isQuiting = true;
  shutdown();
});
