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

export const LATEST_VERSION = "v3.1.120";

/** 首页公告弹窗摘要（只列最新版本的关键项） */
export const CHANGELOG_BRIEF = [
  "GET 接口密钥脱敏：project 列表/详情不再明文返回 llmConfig.apiKey——本地单机无虞，但公开部署（Vercel，VERCEL 存在即放行 API）会把作者项目级密钥明文发给所有访客，是真泄露",
  "新增 src/lib/llm-config-mask.ts 导出纯函数 maskLlmConfig（复用 settings 的 maskKey 逻辑：中间打码只留末 4 位），在 getProjectsForHome（列表 + 首页 SSR 共用源头）与详情 GET 出口统一脱敏，并附加 hasApiKey 便于前端判断是否已配置",
  "写路径（POST/PATCH）不动：作者在请求体里发送自己的密钥、拿回同源会话的同一密钥，非读取泄露；前端无项目级 key 回填 UI，脱敏不造成保存清空真 key 回归",
  "三道门禁：tsc 0 错 + vitest 163 文件 1792 测试全绿（新增 10）+ next build 通过",
];
