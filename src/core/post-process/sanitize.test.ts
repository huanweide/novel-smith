import { describe, it, expect } from "vitest";
import { stripProtocolLeak } from "./sanitize";

describe("stripProtocolLeak", () => {
  it("剥离 --- 包裹的 HUD 整块", () => {
    const input =
      "正文开头。\n\n---\n【剧情校准 HUD】\n  时间 | 地点\n  修为: 筑基\n---\n\n正文继续。";
    const out = stripProtocolLeak(input);
    expect(out).not.toContain("剧情校准");
    expect(out).toContain("正文开头。");
    expect(out).toContain("正文继续。");
  });

  it("剥离未包裹的 HUD 标题行及其缩进状态行", () => {
    const input =
      "第一章内容。\n【剧情校准 HUD】\n  修为: 练气\n  进度: 瓶颈\n后续正文。";
    const out = stripProtocolLeak(input);
    expect(out).not.toContain("剧情校准");
    expect(out).not.toContain("修为");
    expect(out).toContain("第一章内容。");
    expect(out).toContain("后续正文。");
  });

  it("兼容 HUD 字样中的空白变体", () => {
    const input = "正文。\n\n【剧情校准  HUD】\n  修为: 练气\n更多正文。";
    const out = stripProtocolLeak(input);
    expect(out).not.toContain("剧情校准");
    expect(out).not.toContain("修为");
  });

  it("不含 HUD 的正文原样保留", () => {
    const input = "他拔出长剑，寒光映雪。\n夜风凛冽，山道寂寥。";
    expect(stripProtocolLeak(input)).toBe(input);
  });

  it("空输入安全返回空串", () => {
    expect(stripProtocolLeak("")).toBe("");
  });
});
