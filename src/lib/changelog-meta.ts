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

export const LATEST_VERSION = "v3.1.142";

/** 首页公告弹窗摘要（只列最新版本的关键项） */
export const CHANGELOG_BRIEF = [
  "新增 GitHub Pages 免费公开演示站 huanweide.github.io/novel-smith：任何人点开链接就能直接试「去 AI 味检测」，真实引擎跑在浏览器里，不联网、不上传、不用 API Key",
  "演示页直接 import 项目真实 humanize 引擎（analyzeText / applyFixes / countFixable），不重写不 mock——演示与产品同一套逻辑，评分与修复结果完全一致",
  "支持单条套用修复与一键套用全部修复，实时看分数变化；push main 且引擎/demo 变动时自动重建部署，永远与最新版本同步，零成本零 token",
  "Vercel 预览站正式废弃（域名已失效且本机无凭证）：README / README_EN / agent.md 共 8 处死链全部换成 Pages 地址",
];
