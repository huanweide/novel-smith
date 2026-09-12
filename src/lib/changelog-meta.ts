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

export const LATEST_VERSION = "v3.1.134";

/** 首页公告弹窗摘要（只列最新版本的关键项） */
export const CHANGELOG_BRIEF = [
  "全站端到端走查：12 个路由全部 HTTP 200、零 JS 错误；写作台 36 个可交互点逐一点击验证均有响应；其余 8 个页面（设置 / 检测 / 工坊 / 探讨 / 回收站 / 更新日志 / 拆书 / 阅读）交互点正常、零 JS 错误",
  "修复右侧面板顶部 tab 断字：6 个 tab 在 320px 面板内被挤到 48px 宽，3 字标签被迫换行成「AI助/手」「工具/箱」；改为可换行布局（每 tab 最小 5.5rem + whitespace-nowrap），标签完整显示，最小化按钮固定在右上角",
  "走查其余结论：全站无横向溢出；设置页 / 创意工坊 / 检测页 / 探讨模式零文字裁切；章节标题的省略属设计内 truncate；各对话框点击均正常弹出，无冗余、无重复、无失效",
  "门禁：tsc 0 错 · vitest 177 文件 1921 测试全绿 · next build 通过",
];
