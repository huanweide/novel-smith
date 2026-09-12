// ============================================================
// Novel Smith 更新公告 · 轻量元数据（首页专用）
// ============================================================
//
// 为什么要单独拆出这个文件：
//   上一版 changelog-data.ts 已经累积到 **14848 行 / 539 个版本条目**。
//   实测发现首页（home-dashboard）只想要一个 LATEST_VERSION 字符串，
//   却被迫把 819KB 的历史版本数据一起打进首屏产物——tree-shaking 没摇掉，
//   因为它在同一个模块里。首屏为了拿一个版本号下载 800KB，太冤。
//
//   拆开之后：
//    - 首页 / 健康检查 只引本文件（几百行，几 KB）——首屏不再背历史包袱；
//    - /changelog 页面才引完整的 changelog-data.ts（14848 行）。
//
// ⚠️ 单一数据源纪律：
//   LATEST_VERSION / CHANGELOG_BRIEF / CHANGELOG_USER_BRIEF **只在本文件定义**，
//   changelog-data.ts 用 `export * from "./changelog-meta"` 转发出去。
//   所以发版时照旧改这一个地方就行，不存在「改了这里忘了那里」。
//
// 每次发版要改的三处（与 CHANGELOG.md 同步）：
//   1. LATEST_VERSION → 新版本号
//   2. CHANGELOG_BRIEF → 新版本摘要
//   3. CHANGELOG.md（项目根目录）→ 完整公告

export interface VersionEntry {
  version: string;
  date: string;
  title: string;
  sections: Array<{
    label: string;
    items: string[];
  }>;
}

export const LATEST_VERSION = "v3.1.124";

/** 首页公告弹窗摘要（只列最新版本的关键项） */
export const CHANGELOG_BRIEF = [
  "API 健壮性收口：5 个此前缺少 try/catch 兜底的读取路由（projects/[id]/chapters GET、presets GET、projects/[id]/lore-tables GET、projects/[id]/lore-tables/[tableId] DELETE、storylines/[id] GET）统一接入 jsonError 兜底（ROBUST-UNGUARDED-ROUTES）",
  "此前 dev 模式下这些路由一旦抛错会冒泡成 Next 错误页（透传内部错误栈 / 文件路径），生产下也只是无提示 500；现在统一返回 {error, code, hint} 泛化形态，成功路径零变化（仅包裹错误路径）",
  "新增 projects/[id]/chapters 路由错误兜底用例（1 例）：prisma 抛含 SQL/表名的错时，断言收敛为统一脱敏响应、不透传内部串",
  "统一错误层补 Prisma P2025（记录不存在）→ 404：此前「删除一条已被删除的记录」会返回 503「数据库访问出错」并引导用户去跑 npx prisma db push，把「记录不存在」误导成「数据库没起来」（P2025-SAYS-DB-DOWN）",
  "三道门禁：tsc 0 错 + vitest 165 文件 1800 测试全绿（新增 3）+ next build 通过",
];
