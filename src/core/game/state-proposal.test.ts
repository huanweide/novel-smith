/**
 * R7 判别测试 · 状态提案校验 + 自由度（先红 → 改 → 绿）
 *
 * 真缺陷锚点：`game-engine.ts:1148` / `:692` 把 LLM 输出的 itemChanges / newEntities 直接落库，
 * 幻觉字段（负数数量、超长名称、未知 operation、凭空改主角状态）会污染世界状态。
 * 外部基准：ink 5,015★ MIT 状态机 + novel2game「模型只提案、应用层校验后落地」。
 */
import { describe, expect, it } from "vitest";
import { validateStateProposal, normalizeCustomAction } from "./state-proposal";

describe("R7 · 状态提案校验（模型只提案，应用层裁决）", () => {
  it("合法提案原样通过", () => {
    const r = validateStateProposal({
      itemChanges: [{ operation: "gain", name: "青铜钥匙", quantity: 1 }],
      newEntities: [{ name: "赵六", type: "character", description: "账房伙计" }],
    });
    expect(r.accepted.itemChanges).toHaveLength(1);
    expect(r.accepted.newEntities).toHaveLength(1);
    expect(r.rejected).toHaveLength(0);
  });

  it("非法 operation / 负数数量 / 空名称被拒并给出理由", () => {
    const r = validateStateProposal({
      itemChanges: [
        { operation: "delete_all", name: "账册", quantity: 1 },
        { operation: "gain", name: "钥匙", quantity: -5 },
        { operation: "gain", name: "  ", quantity: 1 },
      ],
    });
    expect(r.accepted.itemChanges).toHaveLength(0);
    expect(r.rejected).toHaveLength(3);
    expect(r.rejected.every((x) => x.reason.length > 0)).toBe(true);
  });

  it("数量被夹到合理上限，防一次刷出百万道具", () => {
    const r = validateStateProposal({
      itemChanges: [{ operation: "gain", name: "铜钱", quantity: 99999999 }],
    });
    expect(r.accepted.itemChanges[0].quantity).toBeLessThanOrEqual(99);
  });

  it("超长实体名/描述被拒（防提示词注入塞进状态库）", () => {
    const r = validateStateProposal({
      newEntities: [{ name: "甲".repeat(500), type: "character", description: "乙".repeat(5000) }],
    });
    expect(r.accepted.newEntities).toHaveLength(0);
    expect(r.rejected.length).toBeGreaterThan(0);
  });

  it("未知实体类型被拒，不静默归类", () => {
    const r = validateStateProposal({ newEntities: [{ name: "怪东西", type: "root_admin" }] });
    expect(r.accepted.newEntities).toHaveLength(0);
  });

  it("空提案零行为变化", () => {
    const r = validateStateProposal({});
    expect(r.accepted.itemChanges).toEqual([]);
    expect(r.accepted.newEntities).toEqual([]);
    expect(r.rejected).toEqual([]);
  });
});

describe("R7 · 自定义行动自由度", () => {
  it("自由文本行动被识别为 custom 且不被截断成选项编号", () => {
    const a = normalizeCustomAction("悄悄把账册塞进袖子，然后假装什么都没发生");
    expect(a.type).toBe("custom");
    expect(a.text).toContain("袖子");
  });

  it("纯选项编号仍走 option，不破坏既有分支", () => {
    expect(normalizeCustomAction("2").type).toBe("option");
    expect(normalizeCustomAction("选 3").type).toBe("option");
  });

  it("过长输入被安全截断，不炸库", () => {
    const a = normalizeCustomAction("甲".repeat(5000));
    expect(a.text.length).toBeLessThanOrEqual(500);
  });

  it("控制字符被清理（防提示词/日志注入）", () => {
    const a = normalizeCustomAction("打开门\u0000\u001b[31m然后离开");
    expect(a.text).not.toContain("\u0000");
    expect(a.text).not.toContain("\u001b");
  });
});
