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

export const LATEST_VERSION = "v3.1.126";

/** 首页公告弹窗摘要（只列最新版本的关键项） */
export const CHANGELOG_BRIEF = [
  "表单标签横扫第二轮：继上一轮修好世界书新建表单后，顺着同一类问题把全站表单控件过了一遍，又揪出三处「输入框没有可被读出的字段名」（FORM-LABEL-SWEEP）",
  "顺带揪出并修掉一个真实功能缺陷：项目配置的「保存规则」与内容安全的「保存自定义黑名单」点下去**永远提示保存失败**——PATCH 把这两个 Json 数组字段误当对象校验，合法数组被判「必须是对象」直接 400，用户改完规则根本存不进去（PATCH-ARRAY-400）",
  "① 项目设置面板 11 个裸 input 补可见标签：正则后处理规则的 规则名 / 正则 pattern / flags / 替换为（列表内与新增弹窗各一组）+ 项目级 LLM 覆盖的 模型名 / Base URL / API Key；id 按规则下标生成，列表增删不串号",
  "② 生成确认弹窗 3 处「看得见、念不出、点不到」：标签明明写着字却没有 htmlFor、也没把控件包进去，与输入框毫无语义关联；现补 htmlFor + id（LABEL-WITHOUT-FOR）",
  "③ 一致性事实录入行的 5 个控件（分类 / 主体 / 属性 / 事实值 / 置信度）按设计要保持紧凑，改用 aria-label——不破版式，读屏与自动化都能定位",
  "把上一轮写在 WorldEditor 内部的 FormLabel 提取为共享组件 src/components/ui/FormLabel.tsx（含「行内紧凑控件请改用 aria-label、id 必须唯一」的边界说明），WorldEditor 改为引用，消除重复",
  "新增测试 19 例：3 个组件测试文件 9 例（标签与可访问名）、validators 对象数组校验 4 例、PATCH 路由数组字段 6 例（数组 200 且原样落库 / 单个对象 400 且不落库 / 混入非对象 400 / null 清空 / llmConfig 传数组仍 400）",
  "三道门禁：tsc 0 错 + vitest 170 文件 1833 测试全绿 + next build 通过",
];
