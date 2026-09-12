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

export const LATEST_VERSION = "v3.1.135";

/** 首页公告弹窗摘要（只列最新版本的关键项） */
export const CHANGELOG_BRIEF = [
  "首页 Hero 新增零门槛试用引导条：检测到 AI 尚未配置时，引导访客先去「去 AI 味检测」（纯本地规则引擎 —— 不需要 Key、不联网、不上传），让价值验证从 30 分钟压缩到 30 秒，而不是在「要配 Key」这一步就流失",
  "依据：去 AI 味检测是纯前端实现（use client + core/humanize，零 API 调用、零数据库写入），在线 demo 上完全可用；但此前首页没有任何引导把它暴露给访客，访客点进 demo 只能看界面、试不了，构成最大的转化断点",
  "README 首屏重构（中英同步）：删掉劝退式的「在线预览只能看界面、做不了实际操作」，改为「先花 30 秒试一下（不用配 Key、不用安装）」价值前置；新增「哪些功能不需要 Key」对照表；导航行加 30 秒试用直达入口",
  "门禁：tsc 0 错 · vitest 177 文件 1921 测试全绿 · next build 通过",
];
