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

export const LATEST_VERSION = "v3.1.133";

/** 首页公告弹窗摘要（只列最新版本的关键项） */
export const CHANGELOG_BRIEF = [
  "新增对比模式：正文生成 / 精修 / 续写 / 游戏模式导出，只要目标章节已有内容（非空），生成完成后进入左右并排对比界面，由作者选择保留哪一边，不再静默覆盖原稿（COMPARE-MODE）",
  "统一判据抽成纯函数 src/lib/compare-mode.ts：shouldEnterCompare = 原有内容非空 且 新内容非空；原有为空（首次生成）直接采用不做对比。写作生成与游戏导出两条入口共用同一套逻辑、同一个组件",
  "新增 src/components/workspace/CompareModeModal.tsx：左右两栏同时观看（各带字数 / 段落数），点击选边高亮，底部按钮落定保留；未保留的一边仍可在版本历史找回",
  "游戏模式导出：/api/game/end 回传作者入游时的原正文快照；导出后若原有内容非空即进入同一对比界面。门禁 tsc 0 错 · vitest 177 文件 1921 测试全绿 · next build 通过",
];
