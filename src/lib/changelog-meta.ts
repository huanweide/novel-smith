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

export const LATEST_VERSION = "v3.1.153";

/** 首页公告弹窗摘要（只列最新版本的关键项） */
export const CHANGELOG_BRIEF = [
  "修：「旁边的苏长老沉声道」这类名字前带修饰语的写法会整段漏检——现改成以说话动词为右锚点往左回溯取名",
  "不再靠穷举两字修饰词，改为按「尾字属于说话动词字」逐字剥离，冷冷道/缓缓开口这类叠加写法也能剥干净",
  "拔掉一个隐藏 bug：4 字候选曾跳过汉字校验，跨标点碎片「宗。」他」只要首字是姓就直接放行",
  "顺带清掉同一批改动引出的三个碎片：宗主冷冷 / 宗。」他 / 赵无极叹",
  "实测语料回归：林川 / 苏长老 / 赵无极 / 宗主 四个正常角色，碎片 0 个",
  "门禁：tsc 0 错 + vitest 188 文件 / 2163 测试全绿",
];
