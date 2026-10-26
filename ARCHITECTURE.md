# 🔨 Novel Smith 架构说明（简明版）

> 这份是「能上手改代码」的导航图。逐模块的深度文档在
> [`docs/architecture-reference/`](docs/architecture-reference/)（21 篇 + A–G 中文分册），
> 本文件只负责把全局结构讲清楚，并给出每个概念对应的真实源码位置。

---

## 一句话定位

**Novel Smith 是「本地优先 + 隐私零顾虑 + 白盒可改」的中文长篇 AI 写作工坊。**

它不是一个「调一次 LLM 就出文」的壳子，而是一条闭环：
**装载上下文 → 生成 → 蒸馏回写 → 本地过审 → 导出**。
设定与记忆不是塞进 prompt 的一次性文本，而是会随每一章**自动沉淀、自动衰减**的结构化档案。

---

## 为什么是本地 SQLite

| 决策 | 理由 |
|---|---|
| 单文件 SQLite（`./data/novelforge.db`） | clone 即用，零安装、零 Docker、零外部服务；备份就是复制一个文件 |
| API Key 与正文同库存放 | 换取「永不上传」的承诺——这是相对一切云端竞品唯一决定性的差异 |
| Prisma 7 + better-sqlite3 适配器 | 保留 schema 迁移与类型安全，同时不引入任何网络依赖 |

代价与边界也一并说清：单机单文件意味着**没有多端同步、没有多人协作**。这是取舍，不是缺陷。

---

## 三个隐喻

理解这套架构，记住三个比喻就够了：

1. **工程台，不是打字机** —— 它替你管设定、管记忆、管检测、管导出；每一章的章纲和正文都要你点头。作者是你。
2. **档案柜，不是聊天记录** —— 角色卡与世界书是 15 类的结构化档案，会自动分类、自动填表、自动去重，不是流水账。
3. **会遗忘的脑子，不是无限内存** —— 记忆按 S/A/B/C 分级衰减（S 永久、A 30 章降 B、B 15 章降 C、C 5 章删除）。
   「记不住的细节自动淡出」恰恰是长篇不降智的关键——上下文容量有限，必须让位给真正重要的事。

---

## 分层

```
┌─────────────────────────────────────────────────────────────┐
│ UI 层        Next.js 16 App Router + React 19 + Tailwind v4  │
│              src/app/**  src/components/**  src/store/**     │
├─────────────────────────────────────────────────────────────┤
│ API 层       140 个 /api/* 路由 + SSE 流式 + 后台任务表        │
│              src/app/api/**  （前置 net-guard 网段闸门）       │
├─────────────────────────────────────────────────────────────┤
│ 管线层       src/core/pipeline/**   上下文装载 → 章纲 → 正文    │
│ 引擎层       src/core/memory/**     分层记忆 · 语义召回 · 衰减  │
│              src/core/assembly/**   自动填表 · 关系检测         │
│              src/core/humanize/**   去 AI 味（纯本地规则）      │
│              src/core/distillation/** 事件分级与蒸馏            │
│              src/core/dissect/**    拆书 15 维 · 仿写           │
│              src/core/consistency/** 一致性事实抽取与冲突检测    │
│              src/core/storyline/**  故事线 · 缝合怪推进          │
├─────────────────────────────────────────────────────────────┤
│ 数据层       Prisma 7 + SQLite（./data/novelforge.db）         │
│              31 个 model，见 prisma/schema.prisma              │
└─────────────────────────────────────────────────────────────┘
```

---

## 核心概念表

| 概念 | 含义 | 源码 |
|---|---|---|
| **分层记忆（Tiered Memory）** | 近 4 章全文 + 近 3 章摘要 + 远楼层 AI 压缩，三层装配上下文 | `src/core/pipeline/context-loader.ts` |
| **事件分级（S/A/B/C）** | 事件重要性四档 + 遗忘曲线衰减 | `src/lib/memory-decay.ts` |
| **语义召回** | 远楼层事件按相关性召回，而非全量塞入 | `src/core/memory/semantic-recall.ts` |
| **蒸馏（Distillation）** | 每章写完后抽取结构化事实，回写角色卡 / 世界书 / 故事线 | `src/core/distillation/scorer.ts` |
| **世界书（World Book）** | 15 类设定词条库，按触发词在生成前注入 | `src/lib/world-category-classifier.ts` |
| **自动填表（Assembly）** | 表格 → 角色卡 / 世界书词条 → 关系检测 → 回写故事线 | `src/core/assembly/engine.ts` |
| **去 AI 味（Humanize）** | 12 条纯本地规则（9 段落级 + 3 全文级），段落级绿/黄/红评分 | `src/core/humanize/rules.ts` |
| **规则特异性** | 写作规则 6 档作用域加权，冲突按优先级/特异性裁决 | `src/core/rules.ts` |
| **伏笔（PendingCommitment）** | 五状态机独立管理，与记忆衰减互不干扰 | `src/core/foreshadowing.ts` |
| **缝合怪推进** | 主线完结后自动构造承接新主线 | `src/app/api/storylines/generate/route.ts` |
| **网络闸门** | `/api/*` 访问控制，三种信任模式 | `src/lib/net-guard.ts`、`src/proxy.ts` |

---

## 写作闭环

```
        ┌──────────────────────────────────────────┐
        │                                          │
  一句话灵感                                        │
        │                                          │
        ▼                                          │
   探讨模式（11 步）──► 世界观 / 角色 / 势力           │
        │                                          │
        ▼                                          │
   装载上下文 ◄──── 分层记忆（近章全文 + 摘要 + 远楼压缩）│
        │          ◄──── 世界书触发词注入              │
        │          ◄──── 写作规则（特异性裁决）         │
        ▼                                          │
   章纲生成 ──► 你确认/修改 ──► 正文生成               │
        │                                          │
        ▼                                          │
   蒸馏回写 ──► 角色卡 / 世界书 / 故事线 ──────────────┘
        │
        ▼
   本地过审自检（12 条规则，段落级评分）
        │
        ├── 命中少 ──► 定稿 ──► 导出 TXT/MD/HTML/EPUB/DOCX
        └── 命中多 ──► 回到正文（作者自己改，机器不代笔）
```

关键分叉在最后一步：**机器只标不改**。即便带「一键套用」的修复，也只在作者亲手点下时执行
（见 `src/core/humanize/fixes.ts` 的设计约束）。创作主权始终在作者手里。

---

## 数据模型（31 个 model，按职责分组）

| 分组 | model |
|---|---|
| 项目与写作主体 | `Project`、`StoryNode`、`StoryNodeRevision`、`StoryBranch`、`ChapterSummary` |
| 角色与设定 | `CharacterCard`、`CharacterCardRevision`、`LorebookEntry`、`LoreTable`、`StyleCard`、`GlobalPromptRevision` |
| 记忆与一致性 | `ConsistencyFact`、`ConsistencyConflict`、`PendingCommitment`、`StoryBeat` |
| 故事线 | `Storyline`、`StorylineEvent`、`GenerationTask` |
| 规则与配置 | `Rule`、`AppSettings`、`Preset` |
| 任务与导入 | `DissectionTask`、`ImportTask`、`FillTask`、`ImportCommitLock`、`PendingItem`、`BabyloreFillBatch` |
| 其他 | `GameSession`、`GameState`、`LlmCallLog`、`ChatSession` |

完整定义见 [`prisma/schema.prisma`](prisma/schema.prisma)，迁移记录在 `prisma/migrations/`。

---

## 三条不可动摇的设计约束

1. **稿件不出本机** —— 去 AI 味必须纯本地规则实现。一旦改为调 LLM 判分，就等于把未发表稿件传出去，
   这个功能的立身之本立刻消失。
2. **机器不代笔** —— 只标痕迹、给建议；所有改写必须作者亲手确认。
3. **不假绿、不吹牛** —— 规则引擎只能降低机器味，不能保证过审；README 与界面都必须如实声明。

---

## 门禁

三道硬门禁，任一失败即红（见 `.github/workflows/ci.yml`）：

```bash
npx prisma generate   # 必须先跑：缺 DATABASE_URL 时会「静默成功但不产出」
npx prisma db push    # 建本地表
npx tsc --noEmit      # 零错误
npm test              # 2163 个用例
npm run build         # 生产构建
```

`npm run lint`（ESLint）目前是**非阻断**的：存量 1134 errors 多为历史 `no-explicit-any`，
属于技术债，待专项清理后转为硬门禁。

---

## 延伸阅读

- [`docs/architecture-reference/01-architecture-overview.md`](docs/architecture-reference/01-architecture-overview.md) —— 架构总览
- [`docs/architecture-reference/21-platform-full-architecture.md`](docs/architecture-reference/21-platform-full-architecture.md) —— 平台全量架构
- [`docs/architecture-reference/23-core-architecture-patterns.md`](docs/architecture-reference/23-core-architecture-patterns.md) —— 核心架构模式
- [`docs/architecture-reference/A-平台总览.md`](docs/architecture-reference/A-平台总览.md) —— 中文分册 A–G
- [`ROADMAP.md`](ROADMAP.md) —— 排期与交付台账
- [`SECURITY.md`](SECURITY.md) —— 访问控制与信任模式
