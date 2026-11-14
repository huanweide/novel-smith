import { PrismaClient } from "@/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import fs from "node:fs";
import path from "node:path";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

/**
 * 按 DATABASE_URL 协议选驱动（路线③，2026-11-15）：
 *   · libsql:// / https://  → 云库（Turso 免费档或任意 libsql 服务），纯 JS 驱动，
 *     Serverless（Vercel 免费托管）可用——这是「每人 fork 部署、一人一库」的地基；
 *   · 其余（file:./data/novelforge.db）→ 本地 better-sqlite3，行为与此前完全一致，
 *     本地用户零感知、零迁移。
 * Token 从 DATABASE_AUTH_TOKEN 或 TURSO_AUTH_TOKEN 读（Turso 官方命名），没有就不带。
 */
export function selectDriver(url: string): "libsql" | "local" {
  return /^(libsql|https):/i.test(url.trim()) ? "libsql" : "local";
}

function createPrismaClient() {
  const url = process.env.DATABASE_URL || "file:./data/novelforge.db";

  if (selectDriver(url) === "libsql") {
    const authToken = process.env.DATABASE_AUTH_TOKEN || process.env.TURSO_AUTH_TOKEN || "";
    const adapter = new PrismaLibSql({
      url,
      ...(authToken ? { authToken } : {}),
    });
    return new PrismaClient({ adapter });
  }

  // DATABASE_URL 形如 file:./data/novelforge.db；适配器会按 url 打开本地 SQLite 文件
  //（自动剥离 file: 前缀），无需 Docker / 外部 Postgres。
  const dbPath = url.replace(/^file:/, "");
  const absPath = path.isAbsolute(dbPath)
    ? dbPath
    : path.resolve(process.cwd(), dbPath);
  // 确保数据目录存在（better-sqlite3 只建文件、不建目录）
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  const adapter = new PrismaBetterSqlite3({ url });
  // v3.1.55：schema 已把 52 个原 Json / 标量数组字段改回原生 Json 类型，
  // 由 Prisma 自己负责 parse / stringify，不再需要 prisma-serialize 扩展 ——
  // 若继续挂载该扩展，对象会先被扩展 stringify 一次、再被 Prisma stringify 一次，
  // 造成双重编码（读出来是「字符串里的 JSON」，而非对象）。
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
