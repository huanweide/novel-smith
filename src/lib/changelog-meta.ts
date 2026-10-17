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

export const LATEST_VERSION = "v3.1.141";

/** 首页公告弹窗摘要（只列最新版本的关键项） */
export const CHANGELOG_BRIEF = [
  "文档体检抓到真问题：agent.md 的「真身路径」还指向落后 5 个版本的旧克隆（package.json 甚至停留在 3.1.53），按图索骥的会话会在错目录里改代码——现已改指当前克隆，全部旧副本标注真实版本",
  "ROADMAP 回填 v3.1.85–140 共 56 个版本：P1 三项（F11 沉浸写作 / 多项目切换 / 视野优化）与 P2 世界书冲突可视化其实早已交付，「完成一项回填一项」的规则这次补执行",
  "新增 scripts/check-doc-links.py：52 个文档的路径引用一键体检，断链退出码 1 可挂 CI；顺带修好烂掉的 bump-version.js（LATEST_VERSION 早迁去 changelog-meta.ts，脚本却还在读旧文件，一跑就报错）",
];
