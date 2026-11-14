import { describe, expect, it } from "vitest";
import {
  clamp, inspectPower, inspectVerdict, tierLabel,
  INSPECT_CHANNELS, isInspectChannel, isCultivationWorld, compareCultivation,
  deepBackgroundPossible, buildInspectDirective, inspectBrief,
} from "./inspect";

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

describe("探查判定：四档骰面（只裁这一眼清不清，不裁知道多少）", () => {
  const rate = 60;

  it("成功 → 只看清表象，绝不解锁底细/随身，没被察觉", () => {
    const v = inspectVerdict(60, rate);
    expect(v.tier).toBe("success");
    expect(v.reveals).toEqual({ surface: true, clarity: "normal" });
    expect(v.alertDelta).toBe(0);
    expect(v.note).toContain("不知道");
  });

  it("大成功（roll ≤ rate/5）→ 看穿", () => {
    expect(inspectVerdict(12, rate).tier).toBe("critical");
    expect(inspectVerdict(1, 5).tier).toBe("critical"); // rate=5 时 ceil(1)=1，roll=1 仍可看穿
  });

  it("失败 → 白看、不扣好感（大部分时候只是看一眼，盯久了不必一律露形）", () => {
    const v = inspectVerdict(75, rate);
    expect(v.tier).toBe("fail");
    expect(v.reveals).toEqual({ surface: false, clarity: "none" });
    expect(v.alertDelta).toBe(0);
  });

  it("大失败（roll ≥ 96）→ 被当场抓住（-10），即使成功率很高", () => {
    expect(inspectVerdict(96, 95).tier).toBe("blunder");
    expect(inspectVerdict(100, 95).alertDelta).toBe(-10);
  });

  it("骰面收口 1-100、rate 收口 5-95（脏输入不炸）", () => {
    expect(inspectVerdict(0, 1000).d100).toBe(1);
    expect(inspectVerdict(999, 0).rate).toBe(5);
  });

  it("档位中文不再用「看穿」这种全知口吻", () => {
    expect(tierLabel("critical")).toBe("看真切");
    expect(tierLabel("success")).toBe("看个大概");
    expect(tierLabel("fail")).toBe("没看出名堂");
    expect(tierLabel("blunder")).toBe("被察觉");
  });
});

describe("探查分层 · 看一眼不是全知道（用户口径 2026-11-15）", () => {
  const power = inspectPower(["神识", "望气术"], 0); // 59
  const verdict = inspectVerdict(50, power.rate);     // 看个大概

  it("四个通道：默认是观察，且每个通道都写明「绝对不许」", () => {
    expect(Object.keys(INSPECT_CHANNELS)).toEqual(["observe", "inquire", "sense", "background"]);
    expect(INSPECT_CHANNELS.observe.label).toBe("打量");
    expect(INSPECT_CHANNELS.observe.canSee).toContain("主观的评价");
    expect(INSPECT_CHANNELS.observe.cannotSee).toContain("随身物品");
    expect(isInspectChannel("observe")).toBe(true);
    expect(isInspectChannel("omniscience")).toBe(false);
  });

  it("动作文本是尝试语气，不是既成结果", () => {
    expect(INSPECT_CHANNELS.observe.action("苏绾")).toContain("想看清楚");
    expect(INSPECT_CHANNELS.inquire.action("苏绾")).toContain("想知道");
    expect(INSPECT_CHANNELS.observe.action("苏绾")).not.toMatch(/已经|看透了/);
  });

  it("修为只有自己更高、且世界有修为体系时才可判——比不出就是看不出", () => {
    expect(isCultivationWorld("江南市井，绸缎生意")).toBe(false);
    expect(isCultivationWorld("修士以神识探人，筑基期可御剑")).toBe(true);
    expect(compareCultivation("金丹期修士", "筑基弟子")).toBe("higher");
    expect(compareCultivation("炼气三层", "元婴老祖")).toBe("lower");
    expect(compareCultivation("云锦阁少东家", "铁匠")).toBeNull();

    const blocked = buildInspectDirective({
      channel: "sense", targetName: "苏绾", power, verdict,
      cultivationWorld: true, selfRank: null, knownFragments: 0,
    });
    expect(blocked).toContain("只知道不知道");
    expect(blocked).not.toContain("对方气息比你弱");

    const allowed = buildInspectDirective({
      channel: "sense", targetName: "苏绾", power, verdict,
      cultivationWorld: true, selfRank: "higher", knownFragments: 0,
    });
    expect(allowed).toContain("对方气息比你弱");
    expect(allowed).toContain("除此之外一概不知");
  });

  it("深背景极小概率：d100 ≤ 2 且已攒 ≥2 条碎片，否则明写没查到", () => {
    expect(deepBackgroundPossible(2, 2)).toBe(true);
    expect(deepBackgroundPossible(3, 9)).toBe(false);
    expect(deepBackgroundPossible(1, 0)).toBe(false); // 再好的骰子也换不来凭空的身世

    const miss = buildInspectDirective({
      channel: "background", targetName: "苏绾", power,
      verdict: inspectVerdict(50, power.rate),
      cultivationWorld: false, selfRank: null, knownFragments: 0,
    });
    expect(miss).toContain("什么也没打听到");
    expect(miss).toContain("不许硬凑");
  });

  it("注入指令强制写过程、留余地、不写 RESULT|（探查通常不结算）", () => {
    const d = buildInspectDirective({
      channel: "observe", targetName: "苏绾", power, verdict,
      cultivationWorld: false, selfRank: null, knownFragments: 0,
    });
    expect(d).toContain("尝试的过程");
    expect(d).toContain("不知道就是不知道");
    expect(d).toContain("RESULT|未定");
    expect(d).toContain("慢慢攒");
    expect(inspectBrief({ channel: "observe", power, verdict })).toContain("只看表象，底细要慢慢聊");
  });
});
