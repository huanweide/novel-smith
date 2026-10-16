-- AlterTable
-- 项目当前数据库为 SQLite（Prisma 的 Json 类型在 SQLite 下映射为 TEXT），
-- 故此处用 TEXT 而非 Postgres 的 JSONB。
-- 注意：本仓库 prisma/migrations/ 下的历史迁移文件多为 Postgres 时代遗留
-- （JSONB / TEXT[] 语法），实际同步走 `npx prisma db push`（CI 与文档均如此）。
-- 本文件按当前 SQLite 环境书写，保持可执行。
ALTER TABLE "LorebookEntry" ADD COLUMN "embedding" TEXT;
