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

export const LATEST_VERSION = "v3.1.149";

/** 首页公告弹窗摘要（只列最新版本的关键项） */
export const CHANGELOG_BRIEF = [
  "导入小说从藏起来改成摆到台面上：首页 Hero、空状态引导卡、书架常驻卡、「我的作品」标题栏、顶栏五处都有",
  "导入后自动变成「我的作品」——直接落进书架，不需要再去工作台里找",
  "拆书 ≠ 导入：拆书是逆向学习别人的写法不产正文；导入是把自己已有的稿子落成可续写的作品",
  "拆书分析页内置「导入小说」入口，页面上直接讲清两者区别，不再让用户自己猜",
  "顶栏导入按钮去掉 hidden md:，补上文字，窄屏才收成图标",
  "空状态引导卡从 3 张扩到 4 张，三种方式各管一件事",
];
