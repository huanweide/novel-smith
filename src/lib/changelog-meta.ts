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

export const LATEST_VERSION = "v3.1.131";

/** 首页公告弹窗摘要（只列最新版本的关键项） */
export const CHANGELOG_BRIEF = [
  "修复「点主题按钮没反应、无法切换」：首页顶栏「夜航」按钮的下拉菜单原为 absolute top-full，而父容器带 overflow-x-auto（会把 overflow-y 一并算成 auto）导致菜单被整块裁掉，点开也看不见（THEME-MENU-CLIP）",
  "主题菜单改用 React Portal 渲染到 document.body + fixed 定位（按按钮 rect 计算），彻底脱离任何祖先 overflow / transform 裁剪；首页顶栏 / 设置页外观区 / 系统状态横幅三处挂载点一并受益",
  "交互增强：右键主题按钮快速循环切换下一档（夜航→白昼→苍青）；Esc 关闭；滚动或缩放时菜单跟随定位；菜单项补齐 role=menuitemradio 与 aria-checked 语义",
  "门禁：tsc 0 错 · vitest 175 文件 1853 测试全绿（新增 ThemeToggle.test.tsx 5 例）· next build 通过"
]
