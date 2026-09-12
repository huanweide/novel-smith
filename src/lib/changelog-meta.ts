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

export const LATEST_VERSION = "v3.1.128";

/** 首页公告弹窗摘要（只列最新版本的关键项） */
export const CHANGELOG_BRIEF = [
  "表单标签横扫第四轮：顺着 v3.1.125 / v3.1.126 / v3.1.127 同类的「输入框没有可被读出的字段名」问题，继续横扫到导出 / 审稿面板（PublishCheckPanel）",
  "该面板 6 个会提交的控件（目标平台 / 导出格式 / 审稿角色 / 审稿范围 / 选择章节 / 提示词（可编辑））原先是兄弟 <span> 文字 + 无 id 的控件——看得见、读屏念不出、点文字不聚焦；现把 <span> 改为 <label htmlFor>、给每个控件补 id，一一对应关联（FORM-LABEL-SWEEP-4）",
  "新增 PublishCheckPanel.test.tsx（2 例）：导出面板的目标平台 / 导出格式，以及切到模拟审稿后的审稿角色 / 审稿范围 / 提示词（可编辑）均可被 getByLabelText 取到且 id 与 htmlFor 对应",
  "三道门禁：tsc 0 错 + vitest 172 文件 1839 测试全绿（新增 2）+ next build 通过",
];
