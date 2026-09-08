/**
 * presets/undo 幂等性测试 —— P0-5 加固「异常中断不留半截」保证。
 *
 * 背景：executeApplyPlan 不是数据库事务（中途失败会留下半截实体，且不会返回 record）。
 * 因此在失败重试 / 撤销补偿场景下，executeUndo 必须能被安全重复调用：
 * 第二遍撤销应当是「无副作用 no-op」，不能把已经还原的实体再删一次、也不能崩。
 *
 * 这是对 apply-undo.test.ts 中「撤销后状态完全还原」的补充——
 * 那里验证「能还原」，这里验证「反复撤销也安全」（生产环境重试容错）。
 */
import { describe, it, expect } from "vitest";
import { computeApplyPlan } from "./plan";
import { executeApplyPlan } from "./apply";
import { executeUndo } from "./undo";
import { createMemoryDb } from "./__fixtures__/memory-db";

const PID = "p_atomic";

async function inject(db: any, preset: { id: string; type: string; title: string; content: unknown }) {
  const plan = await computeApplyPlan(db, PID, { type: preset.type, content: preset.content });
  return executeApplyPlan(db, PID, preset, plan);
}

describe("executeUndo 幂等性（异常中断补偿安全）", () => {
  it("重复撤销同一 record：第二次是无副作用 no-op", async () => {
    const { db, state } = createMemoryDb({ projectId: PID });
    const record = await inject(db, {
      id: "pr_t", type: "table_template", title: "妃嫔表",
      content: {
        tables: [{ key: "w", name: "表", columns: [{ key: "name", label: "名", type: "text" }], rows: [{ row_id: 1, name: "甄嬛" }] }],
      },
    });
    expect(state.loreTables).toHaveLength(1);

    const first = await executeUndo(db, PID, record);
    expect(state.loreTables).toHaveLength(0);
    expect(first.deleted.length).toBeGreaterThan(0);

    // 关键：第二次撤销不得再删任何东西（数据不被重复删除损坏），状态保持正确。
    // 注：实体已不存在时本就会记进 skipped（提示用户"已被删"），这是信息性的、无害的，
    // 真正的幂等安全保证是 deleted=0 且 state 不变。
    const second = await executeUndo(db, PID, record);
    expect(state.loreTables).toHaveLength(0);
    expect(second.deleted).toHaveLength(0);
    expect(second.restored).toHaveLength(0);
  });

  it("对「覆盖既有」的预设重复撤销：第二次不重复还原、不报错", async () => {
    const { db, state } = createMemoryDb({
      projectId: PID,
      styleCards: [{ id: "sc_1", projectId: PID, styleDescription: "原文风", povType: "first_person", dialogueRatio: 0.2, avgSentenceLength: 20, shortSentenceRatio: 0.3, longSentenceRatio: 0.1, descriptionRatio: 0.2, actionRatio: 0.2, innerThoughtRatio: 0.1, tonalMarkers: {}, lexicalFeatures: {}, sampleText: null }],
    });
    const record = await inject(db, {
      id: "pr_style", type: "style", title: "冷峻文风",
      content: { styleDescription: "冷峻克制", povType: "third_person_limited", dialogueRatio: 0.5 },
    });
    expect(state.styleCards[0].styleDescription).toBe("冷峻克制");

    await executeUndo(db, PID, record);
    expect(state.styleCards[0].styleDescription).toBe("原文风");

    // 第二次撤销仍是 no-op
    const redo = await executeUndo(db, PID, record);
    expect(state.styleCards[0].styleDescription).toBe("原文风");
    expect(redo.restored).toHaveLength(0);
  });
});
