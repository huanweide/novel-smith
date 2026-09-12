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

export const LATEST_VERSION = "v3.1.123";

/** 首页公告弹窗摘要（只列最新版本的关键项） */
export const CHANGELOG_BRIEF = [
  "接口安全第四轮扫描收口：generation-metrics 路由（生成延迟硬指标聚合）错误响应接入统一 jsonError 脱敏层，不再回显原始 e.message（含 SQL / 表名），（SEC-LEAK-GENMETRICS）",
  "修复首页水合不一致（React #418）：ProjectCard 此前在渲染期用 new Date() 算相对时间，SSR 与客户端文本不一致；改为「SSR 渲染确定性绝对日期 + 挂载后升级相对时间并每分钟自更新」，与 InspirationSpark 既有范式一致",
  "新增 generation-metrics 路由脱敏回归测试（1 例）；前端 Playwright 黑箱 3 轮验证首页/设置页/更新页，密钥脱敏与版本号全通过、首页零 JS 异常",
  "三道门禁：tsc 0 错 + vitest 165 文件 1797 测试全绿（新增 1）+ next build 通过",
];
