// ============================================================
// 探讨模式 — 全局提示词构建（共享）
// explore/create 与 projects/[id]/build-config 复用，避免重复
// ============================================================
//
// R2 收敛（v3.1.98）：
// 全库「全局提示词」只有一个真正构造入口 —— sync-global-prompt.ts 的 buildGlobalPrompt。
// 本文件的 buildGlobalPromptFromExplore 退化为「把探讨配置 + 已采纳内容转换为
// buildGlobalPrompt 的入参」的适配壳，不再自行拼文本。这样无论是探讨态建项目、
// 还是写作态 sync 刷新，AI 看到的 globalPrompt 都是同一套渲染引擎产出，结构完全一致。

import type { BuildConfig, AdoptedItem, ExploreStep } from "@/core/explore/types";
import { buildGlobalPrompt } from "@/core/sync-global-prompt";
import { stepToCategory } from "@/core/explore/utils";
import { ALL_WORLD_CATEGORIES } from "@/lib/world-category-classifier";
import type { WorldCategory } from "@/lib/world-category-classifier";

/**
 * stepToCategory 历史上会返回 worldview / plot / economy 等旧类别，
 * 这些都不在 ALL_WORLD_CATEGORIES 里，会被 buildGlobalPrompt 的世界书段静默丢弃，
 * 导致探讨态采纳的设定「看得到共N条、却渲染不出来」。这里统一收敛到合法 WorldCategory，
 * 保证 adopted 设定一定落进世界书段、不被吞掉。
 */
const STEP_CATEGORY_FALLBACK: Record<string, WorldCategory> = {
  worldview: "custom",
  plot: "custom",
  economy: "currency",
};

function stepToBuildCategory(step: ExploreStep): WorldCategory {
  const raw = stepToCategory(step);
  if ((ALL_WORLD_CATEGORIES as readonly string[]).includes(raw)) return raw as WorldCategory;
  return STEP_CATEGORY_FALLBACK[raw] || "custom";
}

/** buildGlobalPrompt 入参所需的 project 投影（仅取它真正读取的字段）。 */
type ExploreProjectInput = {
  name: string;
  genre: unknown;
  synopsis: string;
  toneKeywords: unknown;
  authorNote?: string;
  llmConfig?: unknown;
  buildConfig?: unknown;
};

/**
 * 把探讨模式产物（BuildConfig + 已采纳设定）投影成 buildGlobalPrompt 的入参。
 * - project 携带 buildConfig，使 buildGlobalPrompt 的「探讨布置（结构配置）」段
 *   渲染出受众/篇幅/情节结构/原创人名/流派/核心冲突/力量体系/金手指/风格偏好；
 * - adopted 全部转为世界书词条（与 explore/create 路由落库逻辑一致），由 buildGlobalPrompt
 *   的「世界书」段统一渲染。
 */
export function exploreToBuildInputs(
  config: BuildConfig,
  adopted: AdoptedItem[],
): { project: ExploreProjectInput; loreEntries: any[] } {
  const project: ExploreProjectInput = {
    name: config.novelName || "未命名小说项目",
    genre: config.genre || "玄幻",
    synopsis: adopted
      .filter((a) => a.step === "opening" || a.step === "core_conflict")
      .map((a) => a.content)
      .join("\n")
      .slice(0, 500),
    toneKeywords: config.stylePreference ? [config.stylePreference] : [],
    buildConfig: config,
    llmConfig: undefined,
    authorNote: undefined,
  };

  const loreEntries = adopted.map((a) => ({
    title: a.title,
    category: stepToBuildCategory(a.step),
    content: a.content,
  }));

  return { project, loreEntries };
}

/**
 * 从 BuildConfig + 已采纳内容构建 globalPrompt 文本（探讨态）。
 * 直接委托给 buildGlobalPrompt —— 与写作态共用唯一构造引擎，保证输出同构。
 */
export function buildGlobalPromptFromExplore(
  config: BuildConfig,
  adopted: AdoptedItem[],
): string {
  const { project, loreEntries } = exploreToBuildInputs(config, adopted);
  return buildGlobalPrompt(project, [], loreEntries, null);
}
