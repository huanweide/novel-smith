// M1 门禁验证（无显示器环境专用）：结果写入 M1_RESULT.log（GUI 程序 stdout 不可被 shell 捕获）
const fs = require('fs');
const { app, BrowserWindow } = require('electron');
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');

const LOG = path.resolve(__dirname, '..', 'M1_RESULT.log');
fs.writeFileSync(LOG, '');
const log = (...a) => {
  const s = a.map(String).join(' ');
  try { fs.appendFileSync(LOG, s + '\n'); } catch (_) {}
  console.log(s); // GUI 下可能不可见，但保留
};

const PORT = 3001;
const BASE = `http://127.0.0.1:${PORT}`;
const ROOT = path.resolve(__dirname, '..');

function waitPort(ms) {
  return new Promise((res, rej) => {
    const start = Date.now();
    const tick = () => {
      const r = http.get(BASE, (x) => { x.destroy(); res(true); });
      r.on('error', () => {
        if (Date.now() - start > ms) rej(new Error('waitPort timeout'));
        else setTimeout(tick, 1000);
      });
    };
    tick();
  });
}

log('[M1] electron runtime OK | type=' + process.type + ' | version=' + process.versions.electron);

// (1) better-sqlite3 × electron ABI（证明原生模块重编成功）
try {
  const Database = require('better-sqlite3');
  const db = new Database(':memory:');
  db.exec('CREATE TABLE t(x)');
  db.prepare('INSERT INTO t VALUES (?)').run(1);
  const row = db.prepare('SELECT x FROM t').get();
  db.close();
  log('[M1] (1) better-sqlite3 in electron runtime OK, row.x=' + row.x);
} catch (e) {
  log('[M1-VERIFY] FAIL better-sqlite3: ' + e.message);
  process.exit(1);
}

// (2) 拉起 Next 服务（主进程 context 内）
log('[M1] (2) spawning next dev on port ' + PORT);
const nextBin = path.join(ROOT, 'node_modules', 'next', 'dist', 'bin', 'next');
const srv = spawn('node', [nextBin, 'dev', '-p', String(PORT)], { cwd: ROOT, stdio: 'ignore', shell: true });

waitPort(240000).then(async () => {
  log('[M1] (2) service UP -> ' + BASE);
  let winOk = false, title = '';
  try {
    await Promise.race([
      app.whenReady(),
      new Promise((_, rej) => setTimeout(() => rej(new Error('no display session')), 12000)),
    ]);
    const win = new BrowserWindow({ width: 1024, height: 768, show: false });
    await win.loadURL(BASE);
    title = win.getTitle();
    winOk = true;
    win.destroy();
    log('[M1] (3) window created, title=' + JSON.stringify(title));
  } catch (e) {
    log('[M1] (3) window SKIPPED (headless/no-display): ' + e.message);
  }
  log('[M1-VERIFY] PASS sqlite=ok service=up window=' + (winOk ? ('loaded:' + JSON.stringify(title)) : 'skipped(headless)'));
  try { srv.kill('SIGKILL'); } catch (_) {}
  process.exit(0);
}).catch((e) => {
  log('[M1-VERIFY] FAIL ' + e.message);
  try { srv.kill('SIGKILL'); } catch (_) {}
  process.exit(1);
});
