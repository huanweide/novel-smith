/**
 * R7 · 游戏状态提案校验 + 自定义行动归一（纯函数、零依赖）
 *
 * 设计来源：ink 5,015★ MIT 的「状态机由应用层持有」+ novel2game 的
 * 「大模型只提交状态变更提案，应用层校验后才持久化」。
 * 本项目 `game-engine.ts` 此前把 LLM 输出的 itemChanges / newEntities 直接落库，
 * 幻觉字段会污染世界状态（负数量、超长名、未知 operation 等）。
 *
 * 边界：只校验「状态变更」，不校验叙事文本（那是创作自由，不该被规则卡）。
 */

const ALLOWED_OPERATIONS = new Set(["gain", "lose", "use", "transfer", "equip", "unequip"]);
const ALLOWED_ENTITY_TYPES = new Set(["character", "location", "item", "faction", "creature", "object"]);
const MAX_NAME = 40;
const MAX_DESC = 500;
const MAX_QUANTITY = 99;
const MAX_CUSTOM_ACTION = 500;

export interface ItemChangeProposal {
  operation: string;
  name: string;
  quantity?: number;
  category?: string;
  owner?: string;
}

export interface EntityProposal {
  name: string;
  type?: string;
  description?: string;
  [key: string]: unknown;
}

export interface StateProposalInput {
  itemChanges?: ItemChangeProposal[];
  newEntities?: EntityProposal[];
}

export interface RejectedProposal {
  kind: "itemChange" | "entity";
  index: number;
  reason: string;
}

/** 通过校验后字段必填，可直接交给需要 GameEntity 的调用方 */
export interface ValidatedEntity extends EntityProposal {
  name: string;
  type: string;
  description: string;
}

export interface ValidatedProposal {
  accepted: {
    itemChanges: ItemChangeProposal[];
    newEntities: ValidatedEntity[];
  };
  rejected: RejectedProposal[];
}

const clean = (s: string) => String(s ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u001b]/g, "").trim();

export function validateStateProposal(input: StateProposalInput): ValidatedProposal {
  const accepted: ValidatedProposal["accepted"] = { itemChanges: [], newEntities: [] };
  const rejected: RejectedProposal[] = [];

  (input.itemChanges || []).forEach((c, i) => {
    const op = String(c?.operation ?? "").trim();
    const name = clean(String(c?.name ?? ""));
    const qty = Number.isFinite(c?.quantity) ? Math.floor(Number(c?.quantity)) : 1;
    if (!ALLOWED_OPERATIONS.has(op)) {
      rejected.push({ kind: "itemChange", index: i, reason: `未知的物品操作「${op || "空"}」，已拒绝` });
      return;
    }
    if (!name) {
      rejected.push({ kind: "itemChange", index: i, reason: "物品名为空，已拒绝" });
      return;
    }
    if (name.length > MAX_NAME) {
      rejected.push({ kind: "itemChange", index: i, reason: `物品名超过 ${MAX_NAME} 字，疑似异常输出，已拒绝` });
      return;
    }
    if (qty < 0) {
      rejected.push({ kind: "itemChange", index: i, reason: "数量为负数，已拒绝" });
      return;
    }
    accepted.itemChanges.push({
      ...c,
      operation: op,
      name,
      quantity: Math.max(1, Math.min(MAX_QUANTITY, qty)),
    });
  });

  (input.newEntities || []).forEach((e, i) => {
    const name = clean(String(e?.name ?? ""));
    const type = String(e?.type ?? "object").trim();
    const desc = clean(String(e?.description ?? ""));
    if (!name) {
      rejected.push({ kind: "entity", index: i, reason: "实体名为空，已拒绝" });
      return;
    }
    if (name.length > MAX_NAME || desc.length > MAX_DESC) {
      rejected.push({ kind: "entity", index: i, reason: `实体名/描述超长（>${MAX_NAME}/${MAX_DESC} 字），疑似异常输出，已拒绝` });
      return;
    }
    if (!ALLOWED_ENTITY_TYPES.has(type)) {
      rejected.push({ kind: "entity", index: i, reason: `未知实体类型「${type}」，已拒绝` });
      return;
    }
    accepted.newEntities.push({ ...e, name, type, description: desc } as ValidatedEntity);
  });

  return { accepted, rejected };
}

/** 自定义行动归一：保留自由文本表达，只清理控制字符与超长输入。 */
export function normalizeCustomAction(raw: string): {
  type: "custom" | "option";
  text: string;
  optionIndex?: number;
} {
  const text = clean(String(raw ?? "")).slice(0, MAX_CUSTOM_ACTION);
  const optionMatch = /^(?:选\s*)?([1-9]\d?)$/.exec(text);
  if (optionMatch) {
    return { type: "option", text, optionIndex: Number(optionMatch[1]) - 1 };
  }
  return { type: "custom", text };
}
