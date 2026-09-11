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

export const LATEST_VERSION = "v3.1.119";

/** 首页公告弹窗摘要（只列最新版本的关键项） */
export const CHANGELOG_BRIEF = [
  "API 路由越权裸写防护：堵上两个把整个请求体直接写库的 PUT 路由——projects/[id]/lore-tables/[tableId] 此前 data: { ...body } as any、rules/[id] 此前 data: body，客户端可借请求体把表格或规则挪到别的项目、篡改主键、倒签创建时间",
  "两条路由改为显式字段白名单写入并去掉 as any 恢复类型检查，与 characters/[id]、rules POST（readValidatedBody）既有约定保持一致；POST 路由本就只取白名单字段且 projectId 来自 URL，不受影响",
  "新增 route.test.ts 两个：用 mock prisma 断言 PUT 写入的 data 只含白名单字段、且经请求体注入的 projectId / id / createdAt 被彻底剥离",
  "三道门禁：tsc 0 错 + vitest 160 文件 1782 测试全绿（新增 4）+ next build 通过",
];
