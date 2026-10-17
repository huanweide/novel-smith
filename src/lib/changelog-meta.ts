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

export const LATEST_VERSION = "v3.1.143";

/** 首页公告弹窗摘要（只列最新版本的关键项） */
export const CHANGELOG_BRIEF = [
  "界面风格切换器从 10 档扩到 13 档：新增柔和深夜（深炭灰零发光·默认）、暖白纸稿（暖米底书稿感）、简洁文档（近白 Notion 风）三套去 AI 味主题，整块 token 覆盖、全局随切换生效",
  "默认界面风格由夜航改为柔和深夜：首屏防闪烁与 localStorage 同步，老用户已选的风格不受影响",
  "写作区与建立小说两个页面去 AI 味：正文暖色阅读色 + 首行缩进 1.9 行高，辅助信息沉到页脚；建立小说去掉大圆角/发光/入场动画",
  "三套新主题灰阶按 WCAG AA 4.5:1 重算，文字层级不倒挂，全部通过对比度永久回归守卫",
];
