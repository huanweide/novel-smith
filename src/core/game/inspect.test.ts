import { describe, expect, it } from "vitest";
import { clamp, inspectPower, inspectVerdict, tierLabel } from "./inspect";

describe("探查力：来源透明，全部确定性", () => {
  it("毫无底子的人基础眼力 35", () => {
    const p = inspectPower([], 0);
    expect(p.rate).toBe(35);
    expect(p.parts).toEqual([{ label: "基础眼力", value: 35 }]);
  });

  it("神识/感知类功法加分，最多认 3 个", () => {
    const two = inspectPower(["望气术", "炼剑", "神识"], 0);
    expect(two.rate).toBe(35 + 24);
    expect(two.parts.map((x) => x.label)).toEqual(["基础眼力", "功法神通 · 望气术", "功法神通 · 神识"]);

    const four = inspectPower(["神识", "望气", "洞察", "听风"], 0); // 4 个命中，只认 3
    expect(four.rate).toBe(35 + 36);
  });

  it("无关功法不加分——探查认机制，不堆数量", () => {
    expect(inspectPower(["金剑十三式", "铁布衫"], 0).rate).toBe(35);
  });

  it("情报也是探查力：打过交道 +10，知根知底 +20；仇人同样被研究透", () => {
    expect(inspectPower([], 18).rate).toBe(45); // acquainted
    expect(inspectPower([], 50).rate).toBe(55); // close
    expect(inspectPower([], -45).rate).toBe(55); // 恨到 -45 也是「研究得很透」
  });

  it("成功率有天花板：35+36+20=91，够高但永远到不了 95——探查没有稳拿的", () => {
    expect(inspectPower(["神识", "望气", "洞察"], 60).rate).toBe(91);
    expect(clamp(-10, 5, 95)).toBe(5);
  });
});

describe("探查判定：四档骰面", () => {
  const rate = 60;

  it("成功（roll ≤ rate）→ 看清底细与随身，没被察觉", () => {
    const v = inspectVerdict(60, rate);
    expect(v.tier).toBe("success");
    expect(v.reveals).toEqual({ background: true, inventory: true });
    expect(v.alertDelta).toBe(0);
  });

  it("大成功（roll ≤ rate/5）→ 看穿", () => {
    expect(inspectVerdict(12, rate).tier).toBe("critical");
    expect(inspectVerdict(1, 5).tier).toBe("critical"); // rate=5 时 ceil(1)=1，roll=1 仍可看穿
  });

  it("失败（rate < roll < 96）→ 白看，对方只是起疑（-3）", () => {
    const v = inspectVerdict(75, rate);
    expect(v.tier).toBe("fail");
    expect(v.reveals).toEqual({ background: false, inventory: false });
    expect(v.alertDelta).toBe(-3);
  });

  it("大失败（roll ≥ 96）→ 被当场抓住（-10），即使成功率很高", () => {
    expect(inspectVerdict(96, 95).tier).toBe("blunder");
    expect(inspectVerdict(100, 95).alertDelta).toBe(-10);
  });

  it("骰面收口 1-100、rate 收口 5-95（脏输入不炸）", () => {
    expect(inspectVerdict(0, 1000).d100).toBe(1);
    expect(inspectVerdict(999, 0).rate).toBe(5);
  });

  it("档位有中文", () => {
    expect(tierLabel("critical")).toBe("看穿");
    expect(tierLabel("success")).toBe("看清");
    expect(tierLabel("fail")).toBe("白看");
    expect(tierLabel("blunder")).toBe("被抓住");
  });
});
