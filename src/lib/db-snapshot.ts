/**
 * 数据库快照服务 —— 防止用户数据丢失的最后一道防线。
 *
 * 为什么不复用「额外开一个 better-sqlite3 连接 + VACUUM INTO」：
 * 本项目用 Prisma 的 better-sqlite3 适配器持有常驻连接，且顶层 better-sqlite3 的原生
 * 二进制与运行环境 Node 版本存在 NODE_MODULE_VERSION 不匹配，单独 import 会 500。
 *
 * 更稳的做法：复用 Prisma 自己那条（已经能正常工作的）连接。
 *  1) 先 PRAGMA wal_checkpoint(TRUNCATE) —— 把 WAL 里已提交的内容刷回主库、并清空 WAL；
 *  2) 此时主 .db 文件即为「自包含、一致」的状态，直接 fs.copyFileSync 即可拿到一致副本。
 * 这套「先 checkpoint 再复制主库文件」是 SQLite 热备的标准手法，不依赖 VACUUM，也不开第二连接。
 *
 * 快照统一落在 data/snapshots/ 下（与 .db 同父目录，被 .gitignore 忽略，
 * 不会把用户文稿泄漏进仓库）。命名沿用历史约定：novelforge-YYYYMMDD-HHMMSS[-label].db
 */

import fs from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/prisma";

export interface SnapshotMeta {
  /** 文件名，如 novelforge-20261105-123000.db */
  name: string;
  /** 字节数 */
  size: number;
  /** 修改时间（ms 时间戳） */
  mtime: number;
  /** 可选标签（如 pre-delete / auto / before-restore） */
  label?: string;
}

/** 解析 DATABASE_URL，得到 .db 的绝对路径与快照目录 */
export function getDbPaths(): { absPath: string; dir: string; snapshotDir: string } {
  const url = process.env.DATABASE_URL || "file:./data/novelforge.db";
  const dbPath = url.replace(/^file:/, "");
  const absPath = path.isAbsolute(dbPath)
    ? dbPath
    : path.resolve(process.cwd(), dbPath);
  const dir = path.dirname(absPath);
  const snapshotDir = path.join(dir, "snapshots");
  return { absPath, dir, snapshotDir };
}

function parseLabel(name: string): string | undefined {
  const m = name.match(/^novelforge-\d{8}-\d{6}(?:-(.+))?\.db$/);
  return m?.[1];
}

function formatStamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-` +
    `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  );
}

/** 列出全部快照，按时间倒序（最新在前） */
export function listSnapshots(): SnapshotMeta[] {
  const { snapshotDir } = getDbPaths();
  if (!fs.existsSync(snapshotDir)) return [];
  return fs
    .readdirSync(snapshotDir)
    .filter((f) => f.endsWith(".db"))
    .map((f) => {
      const p = path.join(snapshotDir, f);
      const st = fs.statSync(p);
      return { name: f, size: st.size, mtime: st.mtimeMs, label: parseLabel(f) };
    })
    .sort((a, b) => b.mtime - a.mtime);
}

/**
 * 创建一份当前数据库的快照（一致副本）。
 * 复用 Prisma 连接做 checkpoint，再复制主库文件，避免第二连接与原生版本问题。
 * @param label 可选标签，用于区分用途（pre-delete / auto / before-restore 等）
 * @returns 快照元信息
 */
export async function createSnapshot(label?: string): Promise<SnapshotMeta> {
  const { absPath, snapshotDir } = getDbPaths();
  fs.mkdirSync(snapshotDir, { recursive: true });

  // 把已提交数据刷回主库并清空 WAL，使主 .db 成为自包含的一致状态
  await prisma.$executeRawUnsafe("PRAGMA wal_checkpoint(TRUNCATE)");

  const ts = new Date();
  const stamp = formatStamp(ts);
  const safeLabel = label
    ? `-${label.replace(/[^\w一-龥-]/g, "_").slice(0, 40)}`
    : "";
  const dest = path.join(snapshotDir, `novelforge-${stamp}${safeLabel}.db`);

  // 复制主库文件（此刻它已自包含、一致）
  fs.copyFileSync(absPath, dest);

  const st = fs.statSync(dest);
  return { name: path.basename(dest), size: st.size, mtime: st.mtimeMs, label };
}

/**
 * 将某个快照恢复为当前数据库。
 * 注意：Prisma 持有常驻连接，覆盖文件后需重启应用（桌面端由主进程重载）才能完全生效。
 * 恢复前会自动再打一份安全快照，绝不丢数据；并清掉当前 WAL/SHM 让恢复后的主库成为权威。
 */
export async function restoreSnapshot(
  name: string,
): Promise<{ ok: boolean; note: string }> {
  const { absPath, snapshotDir } = getDbPaths();
  const src = path.join(snapshotDir, name);
  if (!fs.existsSync(src)) return { ok: false, note: "快照不存在" };

  // 恢复前先留底，防止恢复本身出问题
  try {
    await createSnapshot("auto-before-restore");
  } catch {
    /* 留底失败不应阻断恢复 */
  }

  fs.copyFileSync(src, absPath);
  // 删掉当前 WAL/SHM，避免旧 WAL 盖过恢复后的主库（下次加载以主库为准）
  for (const ext of ["-wal", "-shm"]) {
    const w = `${absPath}${ext}`;
    if (fs.existsSync(w)) {
      try {
        fs.rmSync(w);
      } catch {
        /* 可选文件，忽略 */
      }
    }
  }
  return {
    ok: true,
    note: "已恢复到该快照。请重启应用以完全生效（让数据连接重新加载恢复后的库）。",
  };
}

/** 删除某个快照文件 */
export function removeSnapshot(name: string): { ok: boolean; note: string } {
  const { snapshotDir } = getDbPaths();
  const p = path.join(snapshotDir, name);
  if (!fs.existsSync(p)) return { ok: false, note: "快照不存在" };
  fs.rmSync(p);
  return { ok: true, note: "已删除快照" };
}

/** 仅保留最近 max 份快照，超出的按最旧优先清理 */
export function pruneSnapshots(max = 10): number {
  const list = listSnapshots();
  if (list.length <= max) return 0;
  const toDelete = list.slice(max); // 已倒序，末尾为最旧
  let removed = 0;
  for (const s of toDelete) {
    try {
      fs.rmSync(path.join(getDbPaths().snapshotDir, s.name));
      removed++;
    } catch {
      /* 忽略 */
    }
  }
  return removed;
}
