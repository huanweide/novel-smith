# Novel Smith 插件 API 草案（P2 #9）

> 状态：**草案 / 规划** —— 本文描述「社区如何扩展 Novel Smith」的目标形态与最小落地路径。
> 当前版本 v3.1.111 三个扩展点**均为硬编码白名单，尚无注册表**。本文是设计先行，不背包、不 bump。
> 关联：ROADMAP P2 #9、P2 #8（中英双语文档站收录本文）。

---

## 1. 目标

让社区能给 Novel Smith 加三类能力，**不改核心代码、不提 PR 也能用**：

1. **导出器（Exporter）** —— 新增一种导出格式（如 PDF / LaTeX / 自定义排版 / 平台专用格式）。
2. **记忆策略（Memory Strategy）** —— 自定义「长效记忆遗忘曲线 / 保留规则」，替代当前固定的 S/A/B/C 四级衰减。
3. **UI 主题（Theme）** —— 注册一套新配色皮肤（一组 CSS 变量覆盖），无需改组件。

约束（来自项目护城河）：**纯本地、不联网、不碰核心数据、不触碰 API Key 隔离**。插件只扩展「产出物与观感」，不碰写作/生成内核。

---

## 2. 现状盘点（v3.1.111 代码事实）

| 扩展点 | 文件位置 | 当前形态 | 痛点 |
|---|---|---|---|
| 导出器 | `src/app/api/projects/[id]/export/route.ts`<br/>`@/core/epub.ts`、`@/core/docx.ts` | `SUPPORTED_FORMATS = ["markdown","txt","html","epub","docx"]` 硬编码数组 + `if (format === "x")` 分支 | 加格式 = 改白名单 + 加 if 分支 + 实现 `buildXxxStream`，强耦合路由 |
| 记忆策略 | `src/app/api/cron/memory-decay/route.ts`<br/>`@/lib/memory-decay.ts` | `DECAY_RULES` 硬编码常量（S→永久、A→30章降B、B→15章降C、C→5章删） | 规则写死，社区无法按「标签 / 重要性 / 自定义周期」衰减 |
| UI 主题 | `src/components/ui/ThemeToggle.tsx`<br/>`globals.css` | `ThemeId = "dark" \| "light" \| "azure"` 联合类型 + `THEMES` 数组；主题 = `<html>` 上挂 class，CSS 变量按 class 定义 | 新主题要改联合类型 + 数组 + 写一套 CSS 变量，三处联动 |

**共性**：三者都是「枚举/白名单在代码里」，没有「注册」这个概念。这就是插件 API 要补的缺口。

### 导出器的关键契约（已确认，可直接复用）

```ts
// src/core/epub.ts
export interface ChapterItem {
  title: string;
  depth: number;            // 层级：1=卷/书、2=章、3=节……
  outline?: string | null; // 该节点大纲（includeOutline 时才有）
  content?: string | null; // 正文（空壳节点为 null）
}

// 把节点树（roots + allNodes）前序遍历成有序章节列表
export function buildChapterList(
  roots: any[], allNodes: any[], includeOutline: boolean
): ChapterItem[];
```

每种现有格式都消费 `ChapterItem[]`：`buildHtmlDocStream(project, chapters, ...)`、`buildEpubStream(stream, project, chapters, ...)`、`buildDocxStream(stream, project, chapters, ...)`。
**这是导出器插件化的稳定输入边界**——社区只需拿到 `chapters: ChapterItem[]` 自己写出文件流。

---

## 3. 统一插件模型（目标形态）

引入一个轻量**插件注册表**（进程内 `Map`，零新依赖，沿用 `useApi.ts` 的 mini 框架思路）：

```ts
// src/plugins/registry.ts（目标文件，尚未实现）
export interface PluginManifest {
  id: string;          // 全局唯一，如 "exporter-pdf"
  name: string;        // 展示名
  version: string;     // 语义化版本
  kind: "exporter" | "memoryStrategy" | "theme";
  author?: string;
}
```

注册表提供三个 `register` 入口，分别对应三类扩展点（见 §4）。插件在「插件加载点」被 import 即完成注册（本地优先，后续文档站可给「社区插件清单」）。

---

## 4. 三个扩展点的最小路径

### 4.1 导出器插件

**目标 API（草案）：**

```ts
// src/plugins/exporters.ts
export interface ExporterContext {
  project: { name: string };
  chapters: ChapterItem[];      // 来自 buildChapterList 的稳定契约
  includeOutline: boolean;
  author?: string;
  totalWords: number;
  completedNodes: number;
}

export interface ExporterPlugin {
  id: string;                   // 如 "pdf"
  label: string;                // 展示名「PDF」
  ext: string;                  // 文件后缀
  mime: string;                 // Content-Type
  // 流式写入给定 stream，由注册表负责包成 HTTP 响应（复用现有 Readable 背压）
  build(stream: Writable, ctx: ExporterContext): Promise<void>;
}

export function registerExporter(p: ExporterPlugin): void;
```

**社区最小路径（示例：自写 PDF 导出）：**

```ts
// my-plugins/pdf-exporter.ts
import { registerExporter } from "@/plugins/exporters";
import { renderPdf } from "some-pdf-lib";

registerExporter({
  id: "pdf",
  label: "PDF",
  ext: "pdf",
  mime: "application/pdf",
  async build(stream, { project, chapters, author }) {
    const doc = renderPdf({ title: project.name, author });
    for (const c of chapters) {
      if (c.content) doc.addChapter(c.title, c.content);
    }
    await doc.pipeTo(stream); // 流式写入，复用现有大书防 OOM 机制
  },
});
```

**落地代价**：把 `route.ts` 的 `SUPPORTED_FORMATS` 白名单换成 `Map`，`GET` 里 `if (format === "x")` 换成 `const exp = getExporter(format); if (!exp) 400; else exp.build(...)`。内置 5 种格式转为 5 个 `registerExporter` 调用，社区格式无需改路由。

### 4.2 记忆策略插件

**目标 API（草案）：**

```ts
// src/plugins/memory.ts
export interface DecayInput {
  level: "S" | "A" | "B" | "C";
  chaptersSinceTouched: number; // 距上次被「最近章节」覆盖的章数
  tags?: string[];
}
export interface DecayDecision { nextLevel: "S" | "A" | "B" | "C" | "delete"; }
export interface MemoryStrategyPlugin {
  id: string;
  label: string;
  decide(input: DecayInput): DecayDecision;
}
export function registerMemoryStrategy(p: MemoryStrategyPlugin): void;
```

**社区最小路径（按标签保留）：**

```ts
// my-plugins/keep-worldbuilding.ts
import { registerMemoryStrategy } from "@/plugins/memory";
registerMemoryStrategy({
  id: "keep-worldbuilding",
  label: "世界观永驻",
  decide({ level, tags }) {
    if (tags?.includes("worldbuilding")) return { nextLevel: "S" }; // 世界观类永不衰减
    if (level === "C" && Math.random() < 0.2) return { nextLevel: "delete" };
    return { nextLevel: level };
  },
});
```

**落地代价**：`memory-decay/route.ts` 的 `cleanupExpiredMemories` 当前直接读 `DECAY_RULES` 常量；改为「若有注册的 `memoryStrategy` 则用插件的 `decide`，否则回退 `DECAY_RULES`」。内置规则作为默认插件注册，零行为变化。

### 4.3 UI 主题插件

**目标 API（草案）：**

```ts
// src/plugins/themes.ts
export interface ThemePlugin {
  id: string;                   // 如 "sakura"
  name: string;
  desc: string;
  icon: string;                // lucide 图标名
  base: "dark" | "light";      // 继承哪套变体
  // 一组 CSS 变量覆盖（与 globals.css 的 --nv-* 同名即覆盖）
  variables: Record<string, string>;
  themeColor: string;          // <meta name="theme-color">
}
export function registerTheme(p: ThemePlugin): void;
```

**社区最小路径（樱花主题）：**

```ts
// my-plugins/sakura-theme.ts
import { registerTheme } from "@/plugins/themes";
registerTheme({
  id: "sakura",
  name: "樱",
  desc: "粉调浅色",
  icon: "flower",
  base: "light",
  variables: {
    "--nv-primary": "oklch(0.72 0.13 350)",
    "--nv-accent": "oklch(0.80 0.10 25)",
    "--nv-surface-1": "oklch(0.98 0.01 350)",
  },
  themeColor: "#fff0f3",
});
```

**落地代价**：`ThemeToggle.tsx` 的 `THEMES` 数组换成注册表；应用主题时除了挂 `base` class，再把 `variables` 写到 `document.documentElement.style` 上。内置三主题作为默认插件注册。

---

## 5. 插件注册表 API 总览（草案签名）

```ts
registerExporter(p: ExporterPlugin): void      // §4.1
registerMemoryStrategy(p: MemoryStrategyPlugin): void  // §4.2
registerTheme(p: ThemePlugin): void            // §4.3

// 查询（核心代码内部用，插件作者一般不用）
getExporter(id: string): ExporterPlugin | undefined
listExporters(): ExporterPlugin[]
getMemoryStrategy(): MemoryStrategyPlugin | undefined   // 取「当前激活」策略
listThemes(): ThemePlugin[]
```

注册表实现：`Map<string, Plugin>`，同名 `id` 后注册者覆盖（便于本地覆盖内置）。进程内常驻，不落库、不联网。

---

## 6. 边界与安全

- **纯本地、不联网**：插件只处理本地数据（章节树 / 记忆条目 / CSS 变量），不得发起外部请求、不得读取 `.env` 或任何 API Key。
- **不碰写作内核**：插件不能干预生成、不能改 prisma schema、不能读他人项目。
- **失败隔离**：单个插件抛错不应拖垮导出/衰减/渲染主流程——注册表调用包裹 try/catch，插件异常降级为「忽略该插件」。
- **不 bump 版本**：插件 API 本身演进走文档与 RFC，不强制每次改核心就升版本号。
- **加载点明确**：插件在 `src/plugins/index.ts`（或文档站约定的 `plugins/` 本地目录）被 import 即注册；不自动扫描任意目录，避免误加载。

---

## 7. 落地路线（建议分阶段，均不 bump）

1. **Phase 0（最小可用）**：抽 `exporterRegistry`（`Map` + `registerExporter` + `getExporter`），把内置 5 格式迁过去，`route.ts` 改用注册表。验证：导出行为零变化。→ 这是 ROI 最高的一步，导出器是社区最想要、契约最清晰的扩展点。
2. **Phase 1**：`themeRegistry` 同上改造 `ThemeToggle`。
3. **Phase 2**：`memoryStrategy` 插件化（需先给 `cleanupExpiredMemories` 注入策略参数）。
4. **Phase 3（可选）**：文档站（P2 #8）收录本文 + 一篇「写你的第一个导出器」教程 + 社区插件清单页。

---

## 8. 一句话总结给社区

> 想加导出格式？实现 `build(stream, ctx)`，调 `registerExporter`，完事。
> 想换遗忘规则？实现 `decide(input)`，调 `registerMemoryStrategy`。
> 想做皮肤？给一组 CSS 变量，调 `registerTheme`。
> 三者都「import 即注册、纯本地、不碰核心」，不用改 Novel Smith 一行核心代码。
