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

export const LATEST_VERSION = "v3.1.130";

/** 首页公告弹窗摘要（只列最新版本的关键项） */
export const CHANGELOG_BRIEF = [
  "新增「教练」右侧顶栏 tab（WritingCoachPanel）：作者写作时实时（300ms 防抖）对当前节点正文跑六维本地质量分析——废词率 / 展示vs讲述 / 视角一致性 / 句式多样性 / 对话自然度 / 主语多样性，边打字边给分数、问题清单与中文改法建议（WRITING-COACH）",
  "六维分析复用 src/core/quality/quality-analyzer 的纯本地规则引擎（正则+统计、零 Token），全部在浏览器本地计算、文本不出本机，契合「数据本地零外泄 + 本地规则引擎」护城河",
  "分析内核抽成 src/core/quality/coach.ts 纯函数（含中文教练话术映射），不依赖任何云端；组件/WritingCoachPanel 标注本地实时·零外泄",
  "三道门禁：tsc 0 错 · vitest 174 文件 1848 测试全绿 · next build 通过（新增 coach.test.ts 6 例 + WritingCoachPanel.test.tsx 3 例）"
];
