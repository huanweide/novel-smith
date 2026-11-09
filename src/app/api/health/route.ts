/**
 * GET /api/health —— 系统状态自检探针
 *
 * 供全局状态横幅（SystemStatusBanner）调用，用来判断：
 *   1) 数据库是否可连接（本地 SQLite 文件库已建并可查询）
 *   2) AI 是否已配置（数据库 AppSettings 或环境变量 LLM_API_KEY 至少其一就绪）
 *
 * 设计原则：
 *   - 只读、轻量（$queryRaw SELECT 1 + 配置读取），不影响业务
 *   - 任何异常都被吞掉并返回结构化结果，绝不因自检本身报错而拖垮页面
 *   - 客户端在根布局里调用一次，DB / LLM 有问题时即时给出修复指引
 *
 * 零配置说明：本项目使用本地 SQLite 文件库（better-sqlite3），无需 Docker / 外部 Postgres。
 * DATABASE_URL 默认 file:./data/novelforge.db，prisma.ts 在未设置时也会回落到该路径并自动建库，
 * 因此 health 探针直接尝试查询即可，不硬性依赖环境变量是否显式设置。
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/llm";
import { classifyError } from "@/lib/api-error";
// 引轻量版：健康检查只要一个版本号，不该把几千条历史文案拖进来
import { LATEST_VERSION } from "@/lib/changelog-meta";

export const dynamic = "force-dynamic";

export async function GET() {
  // 运行态判定：打包态 Electron 内 main.js 注入了 NS_IS_PACKAGED，或能探测到 electron 运行时。
  // 据此决定给用户的修复文案——桌面端没有 npm/源码，「npx prisma db push」是死命令。
  const isDesktop =
    process.env.NS_IS_PACKAGED === "true" ||
    (typeof process.versions === "object" && !!process.versions.electron);

  // ── 数据库 ──
  // 关键修复（P2）：不能只 SELECT 1（空库也成功，会假绿灯）。必须确认核心表已存在，
  // 否则把「表未创建」如实报出，而不是让用户点功能时再炸成「结构不匹配」。
  let db: { ok: boolean; error: string; hint: string; fixCommand?: string } = {
    ok: true,
    error: "",
    hint: "",
  };
  try {
    const tables = await prisma.$queryRaw<{ name: string }[]>`
      SELECT name FROM sqlite_master
      WHERE type='table' AND name IN ('AppSettings','Project')
    `;
    if (!tables || tables.length < 2) {
      throw new Error("DB_TABLES_MISSING");
    }
    await prisma.$queryRaw`SELECT 1`;
  } catch (e) {
    if (e instanceof Error && e.message === "DB_TABLES_MISSING") {
      db = {
        ok: false,
        error: "数据库表未创建",
        hint: isDesktop
          ? "数据库初始化未完成。请重启 Novel Smith（启动时会自动建表）；若重启后仍报错，请重新安装或联系支持。"
          : "数据库尚未初始化，请运行 `npx prisma db push` 建表后再试。",
        fixCommand: isDesktop ? "" : "npx prisma db push",
      };
    } else {
      const info = classifyError(e);
      db = {
        ok: false,
        error: info.error,
        hint:
          info.hint ||
          (isDesktop
            ? "请重启 Novel Smith；若仍报错请重新安装。"
            : "请确认本地 SQLite 文件已生成：运行 `npx prisma db push` 建表。"),
        fixCommand: isDesktop ? "" : "npx prisma db push",
      };
    }
  }

  // ── AI 配置 ──
  // 关键修复（P4）：DB 本身就是根因时，跳过 LLM 检查——否则 getSettings 读不到 Key
  // 会被误报成「LLM API Key 未配置」，把用户引向填 Key 的死循环（设置页保存同样走坏库）。
  let llm: { ok: boolean; error: string; hint: string } = { ok: true, error: "", hint: "" };
  if (db.ok) {
    try {
      await getSettings();
    } catch (e) {
      const info = classifyError(e);
      llm = { ok: false, error: info.error, hint: info.hint || "" };
    }
  }

  return NextResponse.json({ version: LATEST_VERSION, db, llm });
}
