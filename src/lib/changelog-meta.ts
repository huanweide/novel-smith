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

export const LATEST_VERSION = "v3.1.118";

/** 首页公告弹窗摘要（只列最新版本的关键项） */
export const CHANGELOG_BRIEF = [
  "组件层测试加固收口：故事线工作台的要素工具纯函数 stripElements / elementsFor 此前完全没单测——这两个函数按主线或支线类型过滤七要素与三要素，主线切支线时残留字段会污染保存 payload，是隐性 bug 高发点",
  "新增 src/components/workspace/storyline-workbench/constants.test.ts，7 条用例钉死关键行为：主线条目只留三要素并丢弃七要素残留、支线条目反向丢弃主线残留、null 或 undefined 要素值归一为空串、同名 result 不冲突、空对象返回空对象",
  "实测发现 P1-1 计划书里「组件层核心业务层缺口明显」的前提已不成立：v3.1.x 多轮迭代中 countByModule / aggregateQuality / storyline-progress / reconcile / stream-error 等核心纯函数早已被覆盖，src/lib 现有 38 个、src/core 现有 80+ 个测试文件，本次只补真正剩余的纯逻辑缺口",
  "三道门禁：tsc 0 错 + vitest 158 文件 1778 测试全绿（新增 7）+ next build 通过；未对 useGamePage / useStorylineWorkbench 等 React hook 做脆弱的 mock 测试，避免假绿",
];
