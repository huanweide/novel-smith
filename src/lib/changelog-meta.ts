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

export const LATEST_VERSION = "v3.1.132";

/** 首页公告弹窗摘要（只列最新版本的关键项） */
export const CHANGELOG_BRIEF = [
  "主题从 3 档扩到 10 档：深色 7（夜航·墨蓝紫 / 苍青·青绿 / GitHub 暗 / 德古拉 / 北境 / 东京夜 / 古旧）+ 浅色 3（白昼 / 曜石 Solarized / 拿铁 Catppuccin），各主题底色与主色相互区分",
  "苍青重做配色（底 #04181A 青黑 + 主色 #5FE3C8 青绿），与夜航（#0B1322 墨蓝紫）明显拉开；新主题参考官方色值：GitHub #0D1117 / Dracula #282A36 / Nord #2E3440 / Tokyo Night #1A1B26 / Gruvbox #282828 / Solarized #FDF6E3 / Catppuccin #EFF1F5",
  "切换器升级：菜单按深色/浅色分组 + 每项带底色色点预览 + 超高可滚动；根布局防闪烁脚本同步支持 10 档；右键仍可快速循环切换",
  "文字色全部按 WCAG AA 程序化精算：新增主题的四级文字色在三类表面上均 ≥4.5:1 且层级不倒挂；对比度回归守卫从 43 断言扩到 92 断言（13 套主题块）"
];
