// 解引用 .next 内 Turbopack 生成的 @prisma 绝对符号链接。
//
// 背景：Next 16 + Turbopack 生产构建会在 .next/node_modules/@prisma/ 下生成
//   client-<hash> 与 adapter-better-sqlite3-<hash> 两个「指向本机 node_modules 的绝对符号链接」。
// 直接打包（electron-builder / 上传服务器）会：① 沙箱无法重建符号链接而丢失；
// ② 即便保留，绝对路径指向开发者机器，到用户机器上必然失效 → 运行时
//   "Cannot find module '@prisma/client-<hash>/runtime/client'" → 所有 DB 路由 500。
// 处理：把这些符号链接替换成真实目录拷贝，使 .next 自包含、可分发。
//
// 关键坑（已踩）：必须用 lstatSync 检测符号链接，statSync 会跟随链接去 stat 目标，
// 永远判定成“不是符号链接”，导致整段逻辑空转、一个都没解引用。
import { existsSync, readdirSync, lstatSync, readlinkSync, rmSync, cpSync, statSync } from "fs";
import { join, resolve } from "path";

const ROOTS = [".next/node_modules/@prisma", ".next/dev/node_modules/@prisma"];

// 递归遍历 root 下的所有项；遇到符号链接就解引用成真实拷贝，遇到目录就继续下钻。
function walk(p) {
  let st;
  try {
    st = lstatSync(p);
  } catch {
    return;
  }
  if (st.isSymbolicLink()) {
    let target;
    try {
      target = readlinkSync(p);
    } catch {
      return;
    }
    // 把相对链接解析成绝对路径，确保 cpSync 能找到源。
    const absTarget = resolve(p, "..", target);
    console.log(`[deref] SYMLINK ${p} -> ${target}`);
    rmSync(p, { recursive: true, force: true });
    cpSync(absTarget, p, { recursive: true, dereference: true });
    return;
  }
  if (st.isDirectory()) {
    for (const name of readdirSync(p)) {
      walk(join(p, name));
    }
  }
}

for (const root of ROOTS) {
  if (!existsSync(root)) continue;
  walk(root);
}
console.log("[deref] prisma symlinks dereferenced (if any).");
