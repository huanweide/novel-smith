# Novel Smith 架构与功能复盘（2026-09-08）

> 基线：`main` @ v3.1.93（`a991a97`）｜607 个源文件｜12 个页面｜137 个 API 路由｜31 个 Prisma model
> 数据采集：`arch-audit.cjs` + `arch-audit2.cjs`（全量扫描，非抽样）＋ Explore 子代理依赖分析
> 门禁实测：`tsc --noEmit --incremental false` = 0 错｜`vitest run` = 144 文件 / 1529 测试全绿 / 15.5s
> 上接文档：`docs/novel-smith-升级计划-2026-09-08.md`（用户视角 / 增长视角），本文为**内部架构视角**，两者互补不重复。

---

## 结论先行（5 条）

1. **项目的"功能债"已还清，"结构债"刚开始。** 对照 `ROADMAP.md`，P0 全部落地、P1 三项未做、P2 多为规划。当前真正拖累的不是"缺功能"，而是**同一件事在代码里有多份实现**。
2. **头号技术债是 LLM-JSON 解析碎片化**：`src/lib/json-parser.ts` 里已有成熟的 `parseAIJson`（含 BOM 处理、```json 围栏剥离、尾逗号修复、括号补齐），但**只在 1 个文件被用**；与此同时全库有 **20+ 处手写 `indexOf("{") / lastIndexOf("}")`**。这是典型的"有了轮子但没人用"。
3. **测试冷热严重倒挂**：1529 个测试看着漂亮，但 `src/core` + `src/lib` 共 143 个模块里 **53 个零测试**，其中包含被 43 处引用的最热模块 **`src/lib/llm.ts`**、以及高风险操作 **`src/core/presets/undo.ts`（撤销）**。测试数量掩盖了覆盖缺口。
4. **只有 1 处真实循环依赖**（`babylore/entity-sync.ts ↔ fill.ts`），架构整体是健康的单向分层，**不需要重构**。
5. **本轮建议只做三件事：收敛重复、补齐核心测试、删掉死代码。不新增任何功能。** 上一轮已定的"提升 Star"主线靠 `/detector` 与 README 承担，架构侧这一轮的任务是**让它接下来半年还能改得动**。

---

## 1. 现状盘点

状态图例：✅ 已落地且接线完整 ｜ ⚠️ 部分实现（有代码但接线弱/无测试/有重复）｜ ❌ 仅设计未实现

### 1.1 创作主闭环

| 能力 | 主要文件 | 状态 | 证据 / 缺口 |
|---|---|---|---|
| 探讨模式（11 步 → 世界观） | `src/core/explore/`（被引用 15）、`src/app/explore/page.tsx`、4 个 API | ✅ | 全链路通，有 `utils.test.ts` |
| 项目工作台 | `src/app/workspace/[projectId]/page.tsx`（force-dynamic）、`src/components/workspace/`（103 文件 / 21570 行） | ✅ | 组件层最大聚集地 |
| 批量写作两段流 | `src/core/write-generation.ts` → `api/generate/write`、`api/story/batch-write` | ✅ | 有 `finish-reason` 兜底 |
| 写作流水线 | `src/core/pipeline/`（被引用 21） | ⚠️ | 功能完整，但 5 个子模块零测试：`context-loader.ts`、`generate-chapter-outline.ts`、`plan-chapter.ts`、`post-processor.ts`、`storyline-writer.ts` |
| Agent 编排 | `src/core/agents/orchestrator.ts`（**1600 行**，被引用 9） | ⚠️ | 已接线，但 1600 行 + 零测试 = 改一个字全靠人肉回归 |
| 章名抽签 / 章纲 | `src/core/pipeline/generate-chapter-outline.ts` | ✅ | v3.1.92 已修 HUD 标记混入 |
| 情节工作台 | `src/components/workspace/StorylineWorkbench.tsx`（**1633 行**） | ⚠️ | 功能在，单文件过大 |

### 1.2 设定与记忆（护城河区）

| 能力 | 主要文件 | 状态 | 证据 / 缺口 |
|---|---|---|---|
| 宝宝流数据库（自动填表） | `src/core/babylore/`（被引用 17） | ⚠️ | 功能最强，但存在**循环依赖**：`entity-sync.ts:22` 引 `./fill`，`fill.ts:27` 引 `./entity-sync` |
| 全局提示装配 | `src/core/sync-global-prompt.ts`（被引用 33） | ⚠️ | 事实上的唯一真相源；但 `src/core/explore/build-prompt.ts:buildGlobalPromptFromExplore` 是**第二个构造入口**，双头风险 |
| 一致性检测 | `src/core/consistency/`（被引用 16） | ⚠️ | 后端全套在（extractFacts / detectConflicts / suggestFix），但 `ROADMAP.md` P2-6 自述"冲突 API 没在 UI 显眼处呈现"——**半成品** |
| 伏笔管理 | `src/core/foreshadowing.ts`（被引用 8） | ✅ | 有测试 |
| 角色去重 | `src/core/character-dedupe.ts`（被引用 4） | ✅ | 有 3 组测试；但自带一份私有 `extractJson`（:67） |
| 蒸馏 | `src/core/distillation/`（被引用 2：`orchestrator.ts`、`assembly/engine.ts`） | ⚠️ | 已接线但面很窄，收益未验证 |

### 1.3 质量与过审（差异化杀手锏）

| 能力 | 主要文件 | 状态 | 证据 / 缺口 |
|---|---|---|---|
| 去 AI 味检测（humanize） | `src/core/humanize/`（`rules.ts` + `index.ts` + `platform-risk.ts`） | ✅ | 纯规则零 LLM；已接线 `HumanizePanel.tsx` 与新增的 `DetectorPanel.tsx`；有 `humanize.test.ts` |
| 零门槛检测页 | `src/app/detector/page.tsx` + `src/components/detector/DetectorPanel.tsx` | ✅ | v3.1.93 新增 |
| 质量分析 | `src/lib/quality-analyzer.ts` + `src/core/quality-thresholds.ts` | ⚠️ | 「质量」概念分跨 `lib/` 与 `core/` 两处，命名不统一 |
| 自动评分 | `src/core/auto-rate.ts`（被引用 1：`api/stats/monitor`） | ⚠️ | 单点挂载，零测试 |
| 叙事能量曲线 | `src/core/narrative-energy.ts`（被引用 1：`api/narrative-energy`） | ⚠️ | 单点挂载，零测试 |
| 提示词评估 | `src/core/prompt-eval.ts` | ❌ | **孤儿模块**——除自身测试和 changelog 字符串外全库零引用（详见第 5 节） |

### 1.4 导出与发布

| 能力 | 主要文件 | 状态 | 证据 / 缺口 |
|---|---|---|---|
| DOCX / EPUB / HTML | `src/core/docx.ts`、`epub.ts`、`html*.ts` | ✅ | 有 `docx.stream.test.ts` / `epub.zip.test.ts` 等 |
| 发布管道 | `src/core/publish/pipeline.ts` | ✅ | 有 `pipeline.test.ts` |
| 正文转 HTML | `proseToHtml`（多处）与 `buildAttributionHtml` | ⚠️ | 两处职责相近，可共享（低优先） |

### 1.5 卫星与辅助

| 能力 | 主要文件 | 状态 | 证据 / 缺口 |
|---|---|---|---|
| 拆书 / 仿写 | `src/core/dissect/`（被引用 10） | ⚠️ | `engine.ts` 有测试，`imitation-engine.ts` 零测试 |
| 游戏模式 | `src/core/game/`（被引用 7）+ `app/workspace/[projectId]/game/[nodeId]/page.tsx`（**1571 行**） | ⚠️ | `ROADMAP.md` 已判定降级为卫星，但**仍占着全库第 3 大页面文件**——投入产出倒挂 |
| 创意工坊 / 预设 | `src/core/presets/`（被引用 5）、`src/lib/builtin-presets.ts` | ⚠️ | `apply.ts` / `undo.ts` / `validate.ts` / `llm-config.ts` **全部零测试**（撤销无测试是高风险） |
| 全文检索 | `src/core/story-search.ts` | ✅ | 接线 `FullTextSearchPanel.tsx` |
| 回收站 | `src/app/recycle/page.tsx` | ✅ | — |

### 1.6 工程与治理

| 能力 | 主要文件 | 状态 |
|---|---|---|
| 快照回滚 | `scripts/git-snapshot.sh` / `.ps1` | ✅ |
| 版本五件套 + README 自动同步 | `scripts/bump-version.js`（v3.1.93 新增 `syncReadmeVersion()`） | ✅ |
| 三道门禁 | tsc / vitest / next build | ✅ 实测绿 |
| API 无断链 | 137 个路由全部有引用（经 `lib/api.ts` 封装） | ✅ |
| 贡献指南 / Discussions | `CONTRIBUTING.md`、Discussions 已开 | ✅ v3.1.93 落地 |

### 1.7 仅设计未实现（对照 `ROADMAP.md`）

| 规划项 | ROADMAP 位置 | 现状 |
|---|---|---|
| 沉浸写作模式（F11 全屏） | P1-3 | ❌ 无代码 |
| 多项目快捷切换（顶部下拉） | P1-4 | ❌ 无代码 |
| 写作区视野优化（右侧 AI 助手可收起） | P1-5 | ❌ 无代码 |
| 世界书冲突检测可视化 | P2-6 | ⚠️ API 在，UI 未呈现 |
| 模板市集线上版 | P2-7 | ⚠️ 现为本地 `templates/` 替代方案 |
| 中英双语文档站 | P2-8 | ❌ 无代码 |
| 插件 API 草案 | P2-9 | ❌ 无代码 |

---

## 2. 架构分层与上下游关系

### 2.1 分层（实测规模）

```
L1 表现层   src/app           172 文件 / 27682 行   （12 个页面）
            src/components    137 文件 / 30592 行   （其中 workspace/ 103 文件 / 21570 行）
L2 接口层   src/app/api       155 文件 / 19373 行   （137 个 route）
L3 领域层   src/core          179 文件 / 39136 行   （26 个子模块）
L4 基础层   src/lib            73 文件 / 24874 行
            src/generated/prisma（Prisma 生成代码，非手写）
L5 数据层   data/novelforge.db（1.05 MB，31 model，schema 830 行）
```

### 2.2 领域层冷热图（按被引用文件数排序）

```
43  llm                 ← 最热：LLM 调用与配置中心
33  sync-global-prompt  ← 全局提示唯一真相源
23  types
21  pipeline            ← 写作流水线
18  story-status
17  babylore            ← 宝宝流数据库
16  consistency
15  explore
11  templates   10 dissect   9 agents / assembly / confirm-guard
 8  foreshadowing   7 epub / game   5 editor / entity-highlighter / post-process / presets / settings
 4  character-dedupe / docx / rules / story-node-bridge
 3  diagnostics / humanize / node-type / publish / storyline / text
 2  distillation / finish-reason / quality-thresholds / story-search / write-generation
 1  auto-rate / narrative-energy / prompt-eval / workspace-derive
```

**读法**：`humanize` 只被 3 处引用，但它是**对外价值最大**的模块——引用数与价值不成正比，这是正常的（纯前端调用少）。反之 `llm` 被 43 处引用却**零测试**，风险与热度成正比。

### 2.3 六个结构性问题（按严重度）

**P1 · 循环依赖（唯一一处真环）**
- `src/core/babylore/entity-sync.ts:22` → `import { fillModelOf } from "./fill"`
- `src/core/babylore/fill.ts:27` → `import { syncChapterEntities } from "./entity-sync"`
- 后果：ESM 下靠"函数调用时才求值"侥幸能跑，但任何一方的模块级初始化都会炸；也无法单独测试。

**P2 · LLM-JSON 解析碎片化（最大技术债）**
已有统一实现却无人用：`src/lib/json-parser.ts:171 parseAIJson` / `:271 safeParseAIJson`（带 BOM、```json 围栏、尾逗号、括号补齐、ReDoS 无关的全套容错），**仅 `src/app/api/characters/expand/route.ts` 在用**。
与此同时，全库手写解析至少 20 处：

| 文件 | 行 |
|---|---|
| `src/app/api/characters/[id]/autofill/route.ts` | 253 |
| `src/app/api/lorebook/[id]/autofill/route.ts` | 88 |
| `src/app/api/agent/sync-relations/route.ts` | 128 |
| `src/app/api/agent/extract-chapter/route.ts` | 329 |
| `src/app/api/agent/analyze-relationships/route.ts` | 160 |
| `src/app/api/agent/analyze-chapter/route.ts` | 183-184 |
| `src/app/api/import/parse/route.ts` | 34 |
| `src/app/api/generate/outline/route.ts` | 267 |
| `src/app/api/generate/chapter-outline/draw/route.ts` | 150 |
| `src/app/api/generate/chat/route.ts` | 221 |
| `src/app/api/storylines/generate/route.ts` | 155 |
| `src/app/api/presets/enrich/route.ts` | 90-91 |
| `src/core/agents/orchestrator.ts` | 469、583 |
| `src/core/dissect/engine.ts` | 503 |
| `src/core/character-dedupe.ts` | 70-71（私有 `extractJson`） |
| `src/core/explore/utils.ts` | 47（另一份 `extractJson`） |
| `src/core/storyline/generate.ts` | 153-154 |
| `src/core/babylore/fill.ts` | 140-141、369 |
| `src/core/babylore/entity-sync.ts` | 119 |
| `src/core/settings/parser.ts` | 620 |
| `src/core/editor/prompts.ts` | 172-173、344-345 |
| `src/core/pipeline/generate-chapter-outline.ts` | 143 |
| `src/core/pipeline/plan-chapter.ts` | 39-40 |

后果：每处容错能力各不相同 → AI 返回格式稍变就某一路崩；改一处不管其他 19 处。

**P3 · 全局提示双头**
`src/core/sync-global-prompt.ts:buildGlobalPrompt`（被引用 33，真相源） vs
`src/core/explore/build-prompt.ts:buildGlobalPromptFromExplore`（被引用 14，探讨态专用）。
两者语义重叠，改动其一容易漏掉其二 → 用户会遇到"探讨时和写作时 AI 记得不一样"。

**P4 · 三个巨型文件**
`StorylineWorkbench.tsx` 1633 行 ｜ `orchestrator.ts` 1600 行 ｜ `game/[nodeId]/page.tsx` 1571 行。
（第 4/5 名是 `ImportWizard.tsx` 1283、`CenterPanel.tsx` 1191。）
超大文件的代价不是"丑"，是**每次改动都要脑内跑全量回归**，而这三处恰恰零/少测试。

**P5 · 测试冷热倒挂**
`src/core` + `src/lib` 共 143 个模块，**53 个零测试**。其中高危的：
- `src/lib/llm.ts`（被引用 43，全库最热，**零测试**）
- `src/core/llm/client.ts`（零测试）
- `src/core/agents/orchestrator.ts`（1600 行，零测试）
- `src/core/presets/{apply,undo,validate,llm-config}.ts`（**撤销逻辑零测试**）
- `src/core/pipeline/*` 5 个子模块（零测试）
- `src/core/babylore/{fill,loop}.ts`（零测试）

**P6 · 同名函数重复**
`extractJson` 存在两份实现：`src/core/explore/utils.ts:43`（导出）与 `src/core/character-dedupe.ts:67`（私有）。

---

## 3. 可用性验证

### 3.1 门禁实测（2026-09-08）

| 检查 | 命令 | 结果 |
|---|---|---|
| 类型 | `tsc --noEmit --incremental false` | **EXIT=0** |
| 测试 | `vitest run` | **144 文件 / 1529 测试全过 / 15.5s** |
| API 断链 | 全量扫描 137 路由 | **0 断链**（均经 `lib/api.ts` 封装或服务端互调） |
| 数据 | `data/novelforge.db` | 1.05 MB，31 model |
| 死链页面 | 12 个 `page.tsx` | 全部可路由 |

### 3.2 但"测试多"≠"覆盖对"

1529 个测试是真实成绩，但分布在**容易测的纯函数**上（解析器、格式化、规则匹配），而**最容易出错、最常被改的热路径**反而裸奔：

```
被引用 43 次  src/lib/llm.ts                 → 0 测试   ← 风险最高
被引用 21 次  src/core/pipeline/*            → 0 测试
被引用  9 次  src/core/agents/orchestrator   → 0 测试（1600 行）
被引用  5 次  src/core/presets/undo          → 0 测试（撤销 = 不可逆操作）
```

**判定**：当前测试体系能防"纯函数写错"，防不住"接线改错"。这与项目当前阶段（功能已全、进入打磨期）的主要风险不匹配。

### 3.3 其他实证

- TODO/占位扫描 331 处，逐一核对后**全是业务语义占位**（"第N章"标题、输入框 placeholder、forkPointNodeId 迁移占位），**无空 catch、无 `return null` 兜底式半成品**。代码完成度确实高。
- `.next-detect*` 已在 `.gitignore:18` 忽略，本地磁盘残留（`.next` / `.next-detect` / `.next-detect3`）不影响仓库。

---

## 4. 价值评估与整合

评估维度：**对外价值**（能否带来用户/Star/留存）× **维护成本**（是否重复、是否难改）。

### 4.1 保留并强化（高价值）

| 模块 | 理由 | 动作 |
|---|---|---|
| `src/core/humanize/` | 唯一"不配 Key 也有价值"的杀手锏，竞品结构上做不到（云端必须上传稿件） | 已在 v3.1.93 前置到 `/detector`；继续在 README/SEO 上加码 |
| `src/core/babylore/` + `consistency/` + `foreshadowing/` | 三者构成"长篇不失忆"闭环，是四维护城河的核心 | 保留；优先解循环依赖 + 补测 |
| `src/core/pipeline/` + `write-generation.ts` | 主收益路径 | 保留；补测试（P5 最高优先） |
| `src/core/explore/` | 零到一的世界观入口，转化漏斗第一环 | 保留；收敛双头提示（P3） |

### 4.2 整合（重复 → 收敛）

| 现状 | 目标 | 收益 |
|---|---|---|
| 20+ 处手写 JSON 解析 | 全部收口到 `src/lib/json-parser.ts` 的 `parseAIJson` / `safeParseAIJson` | AI 返回格式变化时**一处修、处处修**；消除"某一路崩" |
| `buildGlobalPrompt`（33 引用）vs `buildGlobalPromptFromExplore`（14 引用） | 前者为唯一构造入口，后者退化为"产出 adopted 配置"再交给前者 | 消除"探讨态与写作态记忆不一致" |
| `lib/quality-analyzer.ts` + `core/quality-thresholds.ts` + `core/auto-rate.ts` + `core/narrative-energy.ts` | 统一归入 `src/core/quality/` 命名空间，共享阈值定义 | "质量"概念从 4 处收敛到 1 处；便于后续对外讲一个完整的质量故事 |
| `extractJson` 两份 | 删 `character-dedupe.ts:67` 私有版，改用 `explore/utils.ts:43` 或直接 `safeParseAIJson` | -15 行重复 |
| `proseToHtml` / `buildAttributionHtml` | 抽共享函数（docx/epub/publish 共用） | 低优先，导出格式统一 |

### 4.3 降级（保持但不投入）

| 模块 | 判定 | 理由 |
|---|---|---|
| `src/core/game/` + `game/[nodeId]/page.tsx`（1571 行） | 保持卫星 | `ROADMAP.md` P3-10 已定"不进主闭环、不自动注入上下文"。但它占着全库第 3 大页面——**不做新功能，但应拆分以降维护成本** |
| `src/core/dissect/imitation-engine.ts` | 保持，补测 | 拆书是差异化功能，但仿写引擎零测试 |
| `src/core/distillation/` | 保持观察 | 仅 2 处引用，收益未验证；暂不删也不扩 |

### 4.4 明确不做的（本轮）

- ❌ 框架/依赖升级（eslint 9→10 等）——用户零感知，且有已知兼容阻塞
- ❌ 架构大重构——分层是健康的（只有 1 处环），重构收益不抵回归风险
- ❌ 新增功能（沉浸模式 / 多项目切换 / 文档站 / 插件 API）——详见第 7 节排期，但**不与本轮收敛工作并行**
- ❌ 拆分 `changelog-data.ts`（14474 行）——它是自动生成的版本历史，拆分收益低、破坏面大

---

## 5. 精简与删除

### 5.1 立即删除清单（零风险）

| # | 目标 | 位置 | 依据 |
|---|---|---|---|
| D1 | 提示词评估模块（整文件） | `src/core/prompt-eval.ts` + `src/core/prompt-eval.test.ts` | 全库唯一引用是 `changelog-data.ts` 里的历史字符串，**真实消费为 0** |
| D2 | 未被引用的转换函数 | `src/core/explore/build-prompt.ts:88 lorebookToAdopted` | 定义处外全库 0 命中 | ✅ 已删除（v3.1.94） |
| D3 | 未被引用的提示装配器 | `src/core/agents/layered-prompt.ts:187 assembleLayeredPrompt`（连同 `agents/index.ts:11-12` 的 re-export） | 仅经 index 再导出，**无真实消费者**（changelog 字符串除外） |
| D4 | 重复的 JSON 解析私有实现 | `src/core/character-dedupe.ts:67 extractJson` | 与 `explore/utils.ts:43` 重复；改调统一实现 | ✅ 已收敛（v3.1.94，改调 `safeParseAIJson`） |

### 5.2 收敛替换清单（有收益，需逐个验证）

| # | 动作 | 范围 | 验收 |
|---|---|---|---|
| R1 | 手写 JSON 解析 → `parseAIJson` / `safeParseAIJson` | 第 2.3 节 P2 表列 23 处 | 全库 `indexOf("{")` 手写解析归零（仅 `json-parser.ts` 内保留 1 处） |
| R2 | 全局提示双头 → 单一入口 | `sync-global-prompt.ts` + `explore/build-prompt.ts` | 只有 1 个 `buildGlobalPrompt*` 构造函数 |
| R3 | 质量模块归位 `src/core/quality/` | `quality-analyzer` / `quality-thresholds` / `auto-rate` / `narrative-energy` | 4 个文件在同一命名空间，共享阈值常量 |

### 5.3 拆分清单（降维护成本）

| # | 目标 | 现状 | 拆法建议 |
|---|---|---|---|
| S1 | `src/components/workspace/StorylineWorkbench.tsx` | 1633 行 | 按「事件列表 / 编辑器 / 侧栏」拆 3 个子组件 |
| S2 | `src/core/agents/orchestrator.ts` | 1600 行 | 先补冒烟测试（S2 前置），再按「调度 / 工具执行 / 结果归约」拆 |
| S3 | `app/workspace/[projectId]/game/[nodeId]/page.tsx` | 1571 行 | 游戏为卫星功能，拆出 `components/game/` 即可，不做增强 |
| S4 | 解循环依赖 | `babylore/entity-sync.ts:22` ↔ `fill.ts:27` | 抽 `babylore/table-model.ts` 承载 `fillModelOf`，两方共同依赖第三方 |

### 5.4 删除纪律（必须遵守）

1. 删前先建快照：`./scripts/git-snapshot.sh create "架构清理-删除死代码"`
2. 每删一项跑一次 `tsc --noEmit --incremental false`，红了立即回滚该次删除
3. 删除与收敛**分批提交**，一批一类，禁止"删代码 + 加功能"混在一个 commit
4. 删除后同步在 `CHANGELOG.md` 记一行（走 bump 五件套，`scripts/bump-version.js` 会自动同步 README 版本）

---

## 7. 落地计划

> 前提：与上一轮的增长主线并行不冲突——增长做「对外（README / detector / 社区）」，本轮做「对内（收敛 / 补测 / 瘦身）」。

### P0 · 本周（低风险 · 高确定性）

| # | 动作 | 涉及文件 | 验收标准 | 风险 | 状态 |
|---|---|---|---|---|---|
| 1 | 建快照 | `scripts/git-snapshot.sh` | `list` 能看到新 tag | 无 | ✅ 已完成（v3.1.93 基线快照） |
| 2 | 删 D1–D4 死代码 | `prompt-eval.ts`、`build-prompt.ts:88`、`layered-prompt.ts:187`+`agents/index.ts:11-12`、`character-dedupe.ts:67` | tsc 0 错 + vitest 全绿（测试数从 1529 降到 ~1520，属预期） | 低 | ✅ 已删除（v3.1.94） |
| 3 | 解循环依赖 S4 | `babylore/{entity-sync,fill}.ts` + 新建 `babylore/table-model.ts` | 两文件间无直接互引；babylore 相关测试全绿 | 低（纯搬移） | ✅ 已解除（v3.1.95） |
| 4 | 补 `src/lib/llm.ts` 测试 | 新建 `src/lib/llm.test.ts` | 覆盖：provider 选择、baseUrl 强制走 `PROVIDER_BASE_URLS`、占位 key 拒绝调用、超时 | 中（需 mock fetch） | ✅ 已补齐（v3.1.95，15 例；占位 key 拒绝 / 超时属 client.ts·local-parser，已注明） |
| 5 | 补 `presets/undo.ts` + `apply.ts` 测试 | 新建 `src/core/presets/undo.test.ts` 等 | 注入→撤销后状态完全还原；异常中断不留半截 | 低 | ✅ 已补齐（v3.1.95，含 undo 幂等修复 + undo-atomic 测试） |

**P0 出口标准**：tsc 0 错、vitest 全绿、死代码清零、循环依赖清零、最热模块 `llm.ts` 有测试。 → **已全部达成（v3.1.95）**。

### P1 · 第 2–3 周（中风险 · 收益最大）

| # | 动作 | 涉及文件 | 验收标准 | 风险 | 状态 |
|---|---|---|---|---|---|
| 6 | JSON 解析全量收敛（R1） | 第 2.3 节 P2 表 23 处 → `src/lib/json-parser.ts` | 手写 `indexOf("{")` 解析归零；`json-parser.test.ts` 扩充各路真实 AI 脏输出用例 | 中（逐处替换需跑相关测试；分 3 批提交） | ✅ 已完成（v3.1.97） |
| 7 | 全局提示双头收敛（R2） | `sync-global-prompt.ts`、`explore/build-prompt.ts` | 只留 1 个构造函数；探讨态与写作态输出一致（加一条对比测试） | 中（提示词改动影响生成效果，需人工抽样比对） | ⬜ 待做 |
| 8 | 补 pipeline + orchestrator 冒烟测试 | `src/core/pipeline/*`、`src/core/agents/orchestrator.ts` | 主流程 mock LLM 后能跑通；orchestrator 覆盖正常/超时/脏 JSON 三态 | 中 | ⬜ 待做 |
| 9 | 质量模块归位（R3） | 4 个质量文件 → `src/core/quality/` | 阈值常量单一来源；对外行为不变 | 低 | ✅ 已归位（v3.1.96） |

**P1 出口标准**：JSON 解析单一实现、提示构造单一入口、热路径有冒烟测试、质量概念归一。

### P2 · 第 4–6 周（降维护成本）

| # | 动作 | 涉及文件 | 验收标准 |
|---|---|---|---|
| 10 | 拆 `StorylineWorkbench.tsx`（1633 行） | 拆出 3 个子组件 | 单文件 ≤ 600 行；工作台功能不变 |
| 11 | 拆 orchestrator（1600 行） | 拆调度/工具/归约 | 单文件 ≤ 700 行；冒烟测试全绿 |
| 12 | 拆游戏页（1571 行） | 抽出 `components/game/` | 单文件 ≤ 600 行；游戏功能零增强 |
| 13 | 补 `dissect/imitation-engine.ts`、`babylore/fill.ts` 测试 | 新建测试 | 核心分支覆盖 |

### P3 · 第 7 周以后（体验增量，接 `ROADMAP.md` P1）

| # | 动作 | 说明 |
|---|---|---|
| 14 | 沉浸写作模式（F11 全屏） | ROADMAP P1-3，呼声最高的体验项 |
| 15 | 多项目快捷切换 | ROADMAP P1-4 |
| 16 | 写作区视野优化（右侧助手可收起） | ROADMAP P1-5 |
| 17 | 世界书冲突检测可视化 | ROADMAP P2-6，后端已就绪，只差 UI |

### 排期依赖

```
P0-2（删死代码）─┐
P0-3（解循环）  ─┼─→ P1-6（JSON 收敛）──→ P2-10/11/12（拆大文件）
P0-4/5（补测） ─┘         ↑
                    依赖补出的测试做回归网
P1-7（提示收敛）独立，可与 6 并行，但**不要同 commit**
P3 体验项依赖 P1 完成（否则在碎片化的代码上堆功能，债务复利）
```

---

## 附：本轮审计可复现

- 脚本：`arch-audit.cjs`（模块冷热 / API 断链 / 大文件 / 目录规模 / TODO 扫描）、`arch-audit2.cjs`（死代码引用溯源 / 测试缺口 / 路由与 API 分组）—— 均在临时目录，如需长期复用可移入 `scripts/audit/`
- 复跑门禁：`tsc --noEmit --incremental false` + `vitest run`
- 依赖分析：Explore 子代理全量读 `src/core`
