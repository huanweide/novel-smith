// 无头验证：用打包产物里的 next + .next + node_modules 直接拉起生产服务，
// 绕过 Electron / 显示器，专门验证“最难的一半”——Next 服务 + SQLite + 路由。
const { createRequire } = require("module");
const path = require("path");
const http = require("http");

const APP = "C:/Users/Administrator/Projects/novel-smith/release/win-unpacked/resources/app";
const req = createRequire(path.join(APP, "package.json"));
process.env.NODE_ENV = "production";
process.env.NEXT_TELEMETRY_DISABLED = "1";
process.env.DATABASE_URL = "file:C:/Users/Administrator/ns-validate.db";

(async () => {
  const nextPkg = req("next/package.json");
  console.log("[validate] next version:", nextPkg.version);
  const next = req("next");
  const nextApp = next({ dev: false, dir: APP });
  console.log("[validate] preparing Next production app...");
  await nextApp.prepare();
  console.log("[validate] prepared OK");
  const handler = nextApp.getRequestHandler();
  const server = http.createServer((rq, rs) => handler(rq, rs));
  const PORT = 3099;
  await new Promise((res) => server.listen(PORT, "127.0.0.1", res));
  console.log("[validate] LISTENING on", PORT);
  await new Promise((r) => setTimeout(r, 2500));

  const probe = (p) => new Promise((resolve) => {
    const rq = http.request({ host: "127.0.0.1", port: PORT, path: p, method: "GET" }, (res) => {
      let body = ""; res.on("data", (d) => (body += d)); res.on("end", () => resolve({ status: res.statusCode, body }));
    });
    rq.on("error", (e) => resolve({ status: 0, body: "ERR " + e.message }));
    rq.end();
  });

  const health = await probe("/api/health");
  console.log("[validate] /api/health status:", health.status);
  console.log("[validate] /api/health body:", health.body);

  const home = await probe("/");
  console.log("[validate] / status:", home.status, "len:", home.body.length);

  server.close();
  process.exit(0);
})().catch((e) => {
  console.error("[validate] FATAL", (e && e.stack) || e);
  process.exit(1);
});
