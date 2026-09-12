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

export const LATEST_VERSION = "v3.1.127";

/** 首页公告弹窗摘要（只列最新版本的关键项） */
export const CHANGELOG_BRIEF = [
  "表单标签横扫第三轮：顺着 v3.1.125 / v3.1.126 同类的「输入框没有可被读出的字段名」问题，继续横扫到「项目设定」保存对话框（BUILD-CONFIG-DIALOG）",
  "该对话框 9 个配置字段（书名 / 类型 / 受众 / 字数 / 情节结构 / 风格偏好 / 力量体系 / 金手指 / 核心冲突）原先是裸 <label> 兄弟节点 + 无 id 的控件——看得见、读屏念不出、点标签不聚焦；现给每个控件补 id、给 Field 补 htmlFor，一一对应关联",
  "流派标签搜索框原先只有 placeholder、无可见标签也无 aria-label，补 aria-label=「搜索流派标签」，纳入读屏与自动化可定位范围",
  "新增 BuildConfigDialog.test.tsx（4 例）：9 字段均可被 getByLabelText 取到且 id 与 htmlFor 对应、搜索框通过 aria-label 获得可访问名、标签的 htmlFor 指向真实存在的控件 id",
  "三道门禁：tsc 0 错 + vitest 171 文件 1837 测试全绿（新增 4）+ next build 通过",
];
