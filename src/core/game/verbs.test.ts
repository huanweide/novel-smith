/**
 * 论交三件（切磋/论道/教诲）的动词判定与好感查表。
 *
 * 背景（2026-11-14 用户需求）：往来组按鬼谷八荒补三个正和动词。
 * 判据：动词只是入口不是权限；好感查表全确定性；文本识别只认施教/切磋侧
 * 的明确词——「请教」是求人不是教人，绝不许误判成 teach。
 */

import { describe, expect, it } from "vitest";

import { BASE_VERBS, inferVerb } from "./verbs";
import { applyRelations, baseDelta } from "./relation-ledger";

describe("论交三件 · 文本识别", () => {
  it("切磋：各种说法都认得", () => {
    expect(inferVerb("custom", "与苏绾切磋一番，点到为止")).toBe("spar");
    expect(inferVerb("custom", "向他讨教几手")).toBe("spar");
    expect(inferVerb("custom", "与王铁匠过招")).toBe("spar");
  });

  it("论道与教诲各归其位", () => {
    expect(inferVerb("custom", "与长老论道一场")).toBe("discuss");
    expect(inferVerb("custom", "向晚辈传授剑法")).toBe("teach");
    expect(inferVerb("custom", "替他指点迷津")).toBe("teach");
  });

  it("「请教」是求人不是教人——不许误判成 teach", () => {
    expect(inferVerb("custom", "向苏绾请教织锦的门道")).not.toBe("teach");
  });

  it("旧四动词不受影响", () => {
    expect(inferVerb("custom", "把玉佩送给苏绾")).toBe("gift");
    expect(inferVerb("custom", "摸走他的火钳")).toBe("steal");
    expect(inferVerb("custom", "对店小二下杀手")).toBe("kill");
    expect(inferVerb("custom", "在铺子里翻找了一遍")).toBe("describe");
  });
});

describe("论交三件 · 好感查表", () => {
  it("数值口径：切磋+4 / 论道+3 / 教诲+2，失败都不结死仇", () => {
    expect(baseDelta("spar", "success")).toBe(4);
    expect(baseDelta("discuss", "success")).toBe(3);
    expect(baseDelta("teach", "success")).toBe(2);
    expect(baseDelta("spar", "fail")).toBe(-3);
    expect(baseDelta("discuss", "fail")).toBe(-1);
    expect(baseDelta("teach", "fail")).toBe(-2);
  });

  it("成功会真实入账，回执带人话原因", () => {
    const r = applyRelations(null, [{ verb: "spar", outcome: "success", target: "王铁匠" }]);
    expect(r.next["王铁匠"].level).toBe(4);
    expect(r.next["王铁匠"].reason).toContain("不打不相识");
  });

  it("兜底回执文案无缺口（变化非零的组合必有人话原因；零变化按设计不入账）", () => {
    for (const v of ["spar", "discuss", "teach"] as const) {
      for (const o of ["success", "cost", "fail"] as const) {
        const delta = baseDelta(v, o);
        const r = applyRelations(null, [{ verb: v, outcome: o, target: "某人" }]);
        if (delta === 0) {
          expect(r.changes).toHaveLength(0); // 零变化不记账（如教诲「他听了，未必服」）
        } else {
          expect(r.changes[0].reason).toBeTruthy();
          expect(r.changes[0].reason).not.toBe("情形变了");
        }
      }
    }
  });

  it("BASE_VERBS 表完整性：三个新键都能拼出行动句", () => {
    for (const v of ["spar", "discuss", "teach"] as const) {
      expect(BASE_VERBS[v].phrase("苏绾")).toContain("苏绾");
    }
  });
});
