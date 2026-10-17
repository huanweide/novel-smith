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

export const LATEST_VERSION = "v3.1.137";

/** 首页公告弹窗摘要（只列最新版本的关键项） */
export const CHANGELOG_BRIEF = [
  "README 说人话：新增「和直接跟 AI 聊天写有什么不一样」六行对比表 +「它不是什么」五条边界声明——把「聊天窗口是健谈的陌生人，本项目是住在你电脑里、记得你所有设定的写作工程台」这句话讲给零基础的人听",
  "修四个文档与代码不符的安全说明（严重）：文档此前声称「只设 ALLOW_PUBLIC 不会开放访问」，而代码行为是未配令牌即放行——错误方向是让用户低估暴露面；同时纠正「npm run dev 只监听 127.0.0.1」的错觉（实际绑定所有接口，局域网可达是刻意放行场景）",
  "修一个死脚本：deploy-local.ps1 还在跑 Docker + PostgreSQL 流程，而仓库早已全量迁往本地 SQLite（连 docker-compose.yml 都不存在），Windows 用户照它走第一步就卡死。已重写为 SQLite 一键版并新增 -Loopback 参数",
  "修两个 Postgres 时代遗留的测试占位串：它们把 DATABASE_URL 默认成 postgresql://…，让 prisma.ts 去 mkdir 一个不存在的目录，三个测试文件在干净环境必红",
  "门禁：tsc 0 错 · vitest 182 文件 2048 测试全绿 · next build 通过 · GitHub CI 全绿",
];
