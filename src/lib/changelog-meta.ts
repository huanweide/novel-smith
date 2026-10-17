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

export const LATEST_VERSION = "v3.1.152";

/** 首页公告弹窗摘要（只列最新版本的关键项） */
export const CHANGELOG_BRIEF = [
  "修：导入含人物的小说时提炼出 0 个角色，只剩「他低声」这类碎片——端到端实测抓到的真 bug",
  "两字说话修饰剥不干净：「林川低声说道」被贪婪匹配吃成「他低声」，现按 低声/沉声/没有 等整段剥离",
  "三字候选不再无条件放行：必须带姓氏才建卡，并挡掉「他/她/我/很/不」等代词虚词开头",
  "世界书不再有「座青铜」「口鼎」「本宗镇派」这类量词与切分碎片",
  "顺带修掉一个误伤：「玄天大道」这种正当设定名不再被当成切分碎片丢掉",
  "服务归属：实测确认 SYSTEM 身份会让 Prisma 失效，已改回用户身份，导入与落库正常",
];
