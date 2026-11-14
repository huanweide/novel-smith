/**
 * 存储驱动分流（路线③，2026-11-15）。
 *
 * 判据：
 *   · 本地路径（file:）行为零变化——老用户零感知零迁移；
 *   · libsql:// / https:// 走纯 JS 云驱动，Serverless（Vercel 免费托管）可用；
 *   · 云驱动烟测用 libsql 本地文件模式（同一条客户端代码路径，
 *     不需要 Turso 账号也能证明「适配器 + PrismaClient」栈成立）。
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { selectDriver } from "./prisma";

describe("驱动分流 · 协议判定", () => {
  it("本地文件 URL 走 better-sqlite3（现状不变）", () => {
    expect(selectDriver("file:./data/novelforge.db")).toBe("local");
    expect(selectDriver("file:C:/data/x.db")).toBe("local");
    expect(selectDriver("")).toBe("local"); // 缺省也是本地
  });

  it("Turso/libsql 云 URL 走 libsql 驱动", () => {
    expect(selectDriver("libsql://my-db-myuser.turso.io")).toBe("libsql");
    expect(selectDriver("LIBSQL://My-Db.turso.io")).toBe("libsql"); // 大小写不敏感
    expect(selectDriver("https://my-db-myuser.turso.io")).toBe("libsql");
  });

  it("带空白也不误判", () => {
    expect(selectDriver("  libsql://x.turso.io  ")).toBe("libsql");
    expect(selectDriver("  file:./x.db ")).toBe("local");
  });
});

describe("libsql 适配器烟测 · 同一客户端代码路径（本地文件模式，无需 Turso 账号）", () => {
  it("PrismaLibSQL + PrismaClient 能建连并执行原始查询", async () => {
    const { PrismaClient } = await import("@/generated/prisma/client");
    const { PrismaLibSql } = await import("@prisma/adapter-libsql");

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "libsql-smoke-"));
    const dbUrl = `file:${path.join(dir, "smoke.db")}`;

    const adapter = new PrismaLibSql({ url: dbUrl });
    const client = new PrismaClient({ adapter });
    try {
      // 原始查询走通 = 驱动建连、协议握手、结果回读全链路成立；
      // Turso 与本地 file: 用的是同一个 @libsql/client 客户端类，只是 url 不同。
      const rows = await client.$queryRawUnsafe<Array<{ n: number }>>("SELECT 40 + 2 AS n");
      expect(rows[0]?.n).toBe(42);
    } finally {
      await client.$disconnect();
      // Windows 下 libsql 释放文件句柄有延迟，删不掉就留给系统临时目录——不影响判定
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* 句柄未释放，容忍 */ }
    }
  }, 30_000);
});
