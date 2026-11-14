import { describe, expect, it } from "vitest";
import { actionGroupsFor, knowledgeLabel, knowledgeOf, riskLabel, shouldMask } from "./person-view";

describe("person-view · 看得到多少", () => {
  it("路人只见过面：底细看不清", () => {
    expect(knowledgeOf(0)).toBe("stranger");
    expect(knowledgeOf(14)).toBe("stranger");
    expect(knowledgeOf(-14)).toBe("stranger");
  });

  it("打过交道：中间一段", () => {
    expect(knowledgeOf(15)).toBe("acquainted");
    expect(knowledgeOf(-25)).toBe("acquainted");
  });

  it("知根知底：亲近和深仇都算——仇人比路人更值得研究", () => {
    expect(knowledgeOf(40)).toBe("close");
    expect(knowledgeOf(-60)).toBe("close");
  });

  it("档位词是人话，不是数字", () => {
    expect(knowledgeLabel("stranger")).toBe("只是见过");
    expect(knowledgeLabel("close")).toBe("知根知底");
  });

  it("空内容不算「看不清」——那是本来就没有，不该打码", () => {
    expect(shouldMask("", "stranger")).toBe(false);
    expect(shouldMask("   ", "stranger")).toBe(false);
    expect(shouldMask(undefined, "stranger")).toBe(false);
  });

  it("有内容 + 只是见过 → 才打码", () => {
    expect(shouldMask("他有个早夭的女儿", "stranger")).toBe(true);
    expect(shouldMask("他有个早夭的女儿", "acquainted")).toBe(false);
  });
});

describe("person-view · 能做什么", () => {
  const groups = actionGroupsFor("陈伯");

  it("四组都在，顺序是「越往下越难收场」", () => {
    expect(groups.map((g) => g.label)).toEqual(["温和", "试探", "强硬", "事务"]);
  });

  it("每个动作都带上了人名，且不带「TA」这种占位", () => {
    const all = groups.flatMap((g) => g.actions);
    expect(all.length).toBeGreaterThanOrEqual(10);
    for (const a of all) {
      expect(a.text).toContain("陈伯");
      expect(a.text).not.toContain("TA");
    }
  });

  it("强硬组一定标记风险——不能有「无代价的动手」", () => {
    const hard = groups.find((g) => g.tone === "hard")!;
    for (const a of hard.actions) {
      expect(a.risk === "risky" || a.risk === "deadly").toBe(true);
    }
  });

  it("温和组全部稳妥——聊天不该有翻脸风险", () => {
    const soft = groups.find((g) => g.tone === "soft")!;
    for (const a of soft.actions) {
      expect(a.risk).toBe("safe");
    }
  });

  it("偷和杀挂到基础动词上，好感结算认得出", () => {
    const hard = groups.find((g) => g.tone === "hard")!;
    expect(hard.actions.find((a) => a.label === "偷他东西")?.verb).toBe("steal");
    expect(hard.actions.find((a) => a.label === "动手")?.verb).toBe("kill");
  });

  it("风险词是人话", () => {
    expect(riskLabel("deadly")).toBe("必翻脸");
    expect(riskLabel("risky")).toBe("有险");
    expect(riskLabel("safe")).toBe("稳妥");
    expect(riskLabel(undefined)).toBe("稳妥");
  });
});
