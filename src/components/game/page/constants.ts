/**
 * 游戏模式页面：常量（原 game/[nodeId]/page.tsx 顶部段）
 */

export const QUICK_ACTIONS = [
  { type: "observe", label: "观察", icon: "search", desc: "观察环境/人物" },
  { type: "dialogue", label: "对话", icon: "message", desc: "与角色交谈" },
  { type: "combat", label: "战斗", icon: "sword", desc: "进入战斗" },
  { type: "explore", label: "探索", icon: "map", desc: "探索新区域" },
  { type: "use_item", label: "使用物品", icon: "backpack", desc: "使用背包物品" },
  { type: "rest", label: "休息", icon: "moon", desc: "休息恢复" },
];

export const LEFT_TABS = [
  { key: "plot", label: "情节", icon: "book" },
  { key: "characters", label: "角色", icon: "user" },
  { key: "factions", label: "势力", icon: "building" },
] as const;

export const RIGHT_TABS = [
  { key: "text", label: "正文", icon: "file" },
  { key: "backpack", label: "背包", icon: "backpack" },
  { key: "world", label: "世界", icon: "globe" },
] as const;
