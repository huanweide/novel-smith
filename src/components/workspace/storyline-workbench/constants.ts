/**
 * 故事线工作台：常量 / 类型 / 纯工具（原 StorylineWorkbench.tsx 顶部段）
 */

import type { IconName } from "@/components/ui/icons";

export const UNKNOWN_ERROR = "请求失败，请稍后重试";
export const MAX_POLLS = 240; // 轮询兜底上限（≈6min，1.5s/次）

export interface StorylineSuggestion {
  type: "main" | "side" | "thread";
  title: string;
  description: string;
  sevenElements: {
    desire: string;
    obstacle: string;
    action: string;
    result: string;
    twist: string;
    turn: string;
    ending: string | null;
  };
}

export type ElementKey =
  | "desire" | "obstacle" | "action" | "result" | "twist" | "turn" | "ending"
  | "origin" | "process";
export interface ElementMeta {
  key: ElementKey;
  icon: IconName;
  label: string;
  hint: string;
}
export type SevenKey = "desire" | "obstacle" | "action" | "result" | "twist" | "turn" | "ending";
export interface SevenMeta {
  key: SevenKey;
  icon: IconName;
  label: string;
  hint: string;
}

// 支线：七要素（完整骨架）—— 支线盘子小，七要素写得下
export const ELEMENT_META: SevenMeta[] = [
  { key: "desire", icon: "gem", label: "欲望", hint: "这条线里角色最想要什么" },
  { key: "obstacle", icon: "shield", label: "阻碍", hint: "挡在欲望前面的力量或人" },
  { key: "action", icon: "sword", label: "行动", hint: "角色为越过阻碍做了什么" },
  { key: "result", icon: "chart", label: "结果", hint: "行动带来的直接后果" },
  { key: "twist", icon: "sparkles", label: "意外", hint: "打乱预期的反转事件" },
  { key: "turn", icon: "arrowRight", label: "转折", hint: "角色立场或局势的关键变化" },
  { key: "ending", icon: "check", label: "结局", hint: "收束时的最终状态（写时再定，不预填）" },
];

// 主线：三要素（起因 / 经过 / 结果）—— 主线线索太多、事件太密，七要素写不下，改用三要素
export const THREE_ELEMENTS: ElementMeta[] = [
  { key: "origin", icon: "gem", label: "起因", hint: "这条主线因何而起、最初的引子" },
  { key: "process", icon: "arrowRight", label: "经过", hint: "主线推进的关键过程与转折" },
  { key: "result", icon: "chart", label: "结果", hint: "主线目前的走向与阶段性结果" },
];

// 按类型返回要素集合：主线三要素、支线七要素
export function elementsFor(type: string | undefined): ElementMeta[] {
  return type === "main" ? THREE_ELEMENTS : ELEMENT_META;
}
// 只保留当前类型允许的要素 key（主线清掉七要素残留，支线清掉三要素残留）
export function stripElements(
  se: Record<string, string | null | undefined>,
  type: string,
): Record<string, string | null> {
  const allowed = new Set(elementsFor(type).map((e) => e.key));
  const out: Record<string, string | null> = {};
  for (const k of Object.keys(se)) {
    if (allowed.has(k as ElementKey)) out[k] = se[k] ?? "";
  }
  return out;
}
