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

export const LATEST_VERSION = "v3.1.136";

/** 首页公告弹窗摘要（只列最新版本的关键项） */
export const CHANGELOG_BRIEF = [
  "设定库认得出你在写谁：正文写「那个叛变北境的将军」、设定写「北境守将·曾率部倒戈」时，此前关键词一个都对不上，这条设定永远注入不到 prompt，AI 只会按「将军=忠臣」去写，把叛徒写成了忠臣。现在补一层语义比对——意思对得上就召回，不要求字面重合",
  "你不需要做任何操作：没配 embedding key 时行为与更新前完全一致；老设定由后台悄悄补，补不上也不影响正常写作（任何失败都静默退回关键词召回）",
  "修复一个真实安全漏洞：伪造 X-Forwarded-For 可绕过全部入站访问控制（一次放行 = 137 个 API 的读写权）。现已改为按部署形态选择信任来源，未知来源一律拦下；ALLOW_PUBLIC 必须配套令牌才生效",
  "门禁：tsc 0 错 · vitest 2027 测试通过 · next build 通过 · GitHub CI 双 job 全绿",
];
