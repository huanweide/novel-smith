import { describe, it, expect } from "vitest";
import {
  parseAttemptLine,
  resolveAttempt,
  toRelationOutcome,
  itemSettlementAllowed,
  deathSettlementAllowed,
  attemptLabel,
  attemptHint,
} from "./attempt";

describe("尝试律 · 结算只认正文证据，不认玩家输入", () => {
  it("没有 RESULT| 行 → 默认未定，什么都不结算", () => {
    const r = resolveAttempt("你把手探向他的袖口，指尖刚碰到布边，他忽然侧过身来。\n\n【情节进度：5%】");
    expect(r.outcome).toBe("undecided");
    expect(r.source).toBe("default");
    expect(toRelationOutcome(r.outcome)).toBeNull();
    expect(itemSettlementAllowed(r.outcome)).toBe(false);
    expect(deathSettlementAllowed(r.outcome)).toBe(false);
  });

  it("玩家文本里写「偷」「杀」不构成得手——resolveAttempt 根本不看输入", () => {
    // 这正是旧实现最致命的洞：inferVerb(输入) + 无骰恒 success → 直接结算
    const r = resolveAttempt("你没能靠近，他一直把手按在腰间的刀上。\n\n【情节进度：5%】");
    expect(r.outcome).toBe("undecided");
  });

  it("RESULT| 明写才结算；取最后一条（容忍模型写多次）", () => {
    const raw = "……\nRESULT|未定|还在试探\nRESULT|得手|袖里那枚铜牌落进掌心\n【情节进度：6%】";
    const r = resolveAttempt(raw);
    expect(r.outcome).toBe("gained");
    expect(r.note).toContain("铜牌");
    expect(r.source).toBe("result_line");
    expect(toRelationOutcome(r.outcome)).toBe("success");
    expect(itemSettlementAllowed(r.outcome)).toBe(true);
  });

  it("受阻：不夺物、不杀人、不锁死，只记这一步没顺", () => {
    const r = resolveAttempt("……\nRESULT|受阻|被他一把握住手腕，你笑着把手收了回来");
    expect(r.outcome).toBe("blocked");
    expect(toRelationOutcome(r.outcome)).toBe("fail");
    expect(itemSettlementAllowed(r.outcome)).toBe(false);
    expect(deathSettlementAllowed(r.outcome)).toBe(false);
    expect(attemptHint(r.outcome)).toContain("还能换个法子");
  });

  it("有代价：到手了，但按 cost 口径记好感", () => {
    const r = resolveAttempt("……\nRESULT|有代价|东西拿到了，袖口被划开一道");
    expect(r.outcome).toBe("costly");
    expect(toRelationOutcome(r.outcome)).toBe("cost");
    expect(itemSettlementAllowed(r.outcome)).toBe(true);
  });

  it("死必须明写：只有 RESULT|丧命 才允许标死", () => {
    const explicit = resolveAttempt("……\nRESULT|丧命|他再没起来");
    expect(explicit.outcome).toBe("fatal");
    expect(deathSettlementAllowed(explicit.outcome)).toBe(true);

    // 正文里出现「死了」但没落 RESULT| 行 → 绝不推导死亡
    const implicit = resolveAttempt("他倒下去，像是死了。你不敢上前确认。\n\n【情节进度：9%】");
    expect(implicit.outcome).toBe("undecided");
    expect(deathSettlementAllowed(implicit.outcome)).toBe(false);
  });

  it("防静默失效①：AI 自己打了 CI|获得 → 算到手（他记的账，不是玩家点的按钮）", () => {
    const r = resolveAttempt("他把铜牌塞进你手里。\nCI|获得|铜牌|1|主角", [
      { operation: "gain", name: "铜牌" },
    ]);
    expect(r.outcome).toBe("gained");
    expect(r.source).toBe("item_evidence");
  });

  it("防静默失效②：只有消耗/丢弃不算得手", () => {
    const r = resolveAttempt("你丢了块碎银。", [{ operation: "consume", name: "碎银" }]);
    expect(r.outcome).toBe("undecided");
  });

  it("上帝档是作者权例外：编排即成事实", () => {
    const r = resolveAttempt("天降陨石，落在院中。", [], true);
    expect(r.outcome).toBe("gained");
    expect(r.source).toBe("god_mode");
  });

  it("RESULT| 优先级高于一切兜底（模型说了受阻就不能按 CI 算得手）", () => {
    const r = resolveAttempt("RESULT|受阻|被拦下了\nCI|获得|铜牌|1|主角", [{ operation: "gain" }], true);
    expect(r.outcome).toBe("blocked");
    expect(r.source).toBe("result_line");
  });

  it("认不出的 RESULT| 词一律按未定——宁可不结算，不可替模型宣布结果", () => {
    const r = parseAttemptLine("RESULT|量子纠缠|有点怪");
    expect(r?.outcome).toBe("undecided");
  });

  it("回执人话里不许出现终局宣判", () => {
    for (const a of ["undecided", "gained", "costly", "blocked", "fatal"] as const) {
      expect(attemptLabel(a)).not.toMatch(/你失败了|游戏结束|你死了/);
    }
    expect(attemptHint("undecided")).toContain("下一轮");
  });
});
