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

export const LATEST_VERSION = "v3.1.125";

/** 首页公告弹窗摘要（只列最新版本的关键项） */
export const CHANGELOG_BRIEF = [
  "世界书（世界观模块）的新建表单补齐字段标签：此前每个输入框只有一个灰色 placeholder（「大陆/国家/城市」这种提示语），一打字提示就消失，用户填到一半认不出这一格是「类型」还是「所属上层地域」，读屏软件也念不出字段名（FORM-NO-LABEL）",
  "修法：字段的中文名本就存在数据里（只被拿去拼正文【标签】），现用 <label htmlFor> + id 显式关联渲染给用户，覆盖标题与全部字段，并与同表单早就有的「记忆注入方式」下拉标签统一；提交按钮文案「保存」统一为「创建」，与角色/章节弹窗同词（BTN-TEXT-INCONSISTENT）",
  "新增 WorldEditor 组件测试（6 例）：逐字段断言 getByLabelText 能取到标签、标题必填带星号、提交按钮为「创建」且不存在「保存」、保存中显示「创建中...」并禁用",
  "前端黑箱新增「核心用户旅程」环节：真实点击建角色 → 建世界书 → 手动加章节 → 后端补正文 → 阅读模式核验 → 回读 API 核对真落库（全程零 LLM 调用，前端断言 74 → 91）",
  "三道门禁：tsc 0 错 + vitest 167 文件 1814 测试全绿（新增 6）+ next build 通过",
];
