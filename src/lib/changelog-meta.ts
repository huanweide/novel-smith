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

export const LATEST_VERSION = "v3.1.129";

/** 首页公告弹窗摘要（只列最新版本的关键项） */
export const CHANGELOG_BRIEF = [
  "表单标签横扫第五轮：写作主面板 CenterPanel 的 3 个 placeholder-only 输入（本节点大纲草稿 / 章纲预览提示词 / 作者指令·微调指令）原先只有占位提示、读屏念不出字段名、无语义关联；现补 aria-label 让读屏能正确念出字段名（FORM-LABEL-SWEEP-5）",
  "这 3 处是「只有 placeholder」型控件，没有兄弟可见文字标签，补可见 FormLabel 会挤占紧凑的写作工具栏版式；按 v3.1.126 一致性录入行的既定决策，用 aria-label 兜底，不破坏版式",
  "CenterPanel 依赖 useWriterStore + 30+ props，完整渲染测试需构造复杂 selectedNode 易假绿；依 v3.1.126 先例与「避免脆弱 hook 测试」纪律，本轮未写脆弱单测，改用 tsc + 既有 1839 测试全绿 + 黑箱核心旅程 + grep 验证兜底",
  "三道门禁：tsc 0 错 · vitest 172 文件 1839 测试全绿 · next build 通过",
];
