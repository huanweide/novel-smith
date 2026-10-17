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

export const LATEST_VERSION = "v3.1.140";

/** 首页公告弹窗摘要（只列最新版本的关键项） */
export const CHANGELOG_BRIEF = [
  "工作台的「过审自检」也有了「成就时刻」：点「套用 N 处到本章」后，面板直接显示「套用前 23 分 → 现在 8 分 ↓15」。这是每章写完都会跑一次的高频入口，此前只有静静变化的数字",
  "顺带修掉一个入口割裂：/detector 页有「一键套用 + 撤销」，而工作台面板此前只有检测展示——想改稿得去 detector 页复制粘贴。现在两个入口能力对齐（工作台保留二次确认与版本历史回滚，创作主权底线不动）",
  "门禁：tsc 0 错 · vitest 183 文件 2058 测试全绿 · next build 通过 · GitHub CI 全绿",
];
