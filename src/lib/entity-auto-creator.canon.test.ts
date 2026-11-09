import { describe, it, expect } from "vitest";
import { isTitleVariant, resolveNameToCanonical, type CanonicalCharacter } from "./entity-auto-creator";

describe("isTitleVariant（姓 + 称谓/职业尊称变体）", () => {
  it("标准称谓变体：李大师 / 王神医 / 张郎中 / 赵城主 → true", () => {
    expect(isTitleVariant("李大师")).toBe(true);
    expect(isTitleVariant("王神医")).toBe(true);
    expect(isTitleVariant("张郎中")).toBe(true);
    expect(isTitleVariant("赵城主")).toBe(true);
  });
  it("普通姓名 / 姓+非称谓 / 称谓后还有实义字 → false（不误判）", () => {
    expect(isTitleVariant("韩立")).toBe(false);
    expect(isTitleVariant("李大山")).toBe(false); // 「大山」非称谓
    expect(isTitleVariant("李大师兄")).toBe(false); // 称谓后还有字
    expect(isTitleVariant("大师")).toBe(false); // 缺姓
  });
  it("繁简归一后判定（蕭大師 → true）", () => {
    expect(isTitleVariant("蕭大師")).toBe(true);
  });
});

describe("resolveNameToCanonical（实体名 → 角色卡正主归一）", () => {
  const chars: CanonicalCharacter[] = [
    { name: "李富贵", aliases: ["李大师", "李老哥"] },
    { name: "韩立" },
  ];

  it("精确命中正主名 → 正主名", () => {
    expect(resolveNameToCanonical(chars, "李富贵")).toBe("李富贵");
  });
  it("精确命中别名（李大师 → 李富贵）", () => {
    expect(resolveNameToCanonical(chars, "李大师")).toBe("李富贵");
  });
  it("称谓变体 + 同姓唯一正主（王神医 无同名 → 原名，因无王姓正主）", () => {
    // 没有王姓正主，变体无目标 → 退回原名
    expect(resolveNameToCanonical(chars, "王神医")).toBe("王神医");
  });
  it("称谓变体 + 同姓唯一正主（李神医 → 李富贵，正主无别名也并）", () => {
    const only: CanonicalCharacter[] = [{ name: "李富贵" }];
    expect(resolveNameToCanonical(only, "李神医")).toBe("李富贵");
  });
  it("同姓正主不唯一 → 安全回退原名（不误并）", () => {
    const two: CanonicalCharacter[] = [{ name: "李富贵" }, { name: "李小白" }];
    expect(resolveNameToCanonical(two, "李大师")).toBe("李大师");
  });
  it("尊称变体（韩先生 → 韩立）", () => {
    expect(resolveNameToCanonical(chars, "韩先生")).toBe("韩立");
  });
  it("非角色名保持原样（青龙镇 → 青龙镇，不臆造合并）", () => {
    expect(resolveNameToCanonical(chars, "青龙镇")).toBe("青龙镇");
  });
  it("高度相似繁简变体（蕭炎 → 萧炎，若注册）", () => {
    const x: CanonicalCharacter[] = [{ name: "萧炎" }];
    expect(resolveNameToCanonical(x, "蕭炎")).toBe("萧炎");
  });
  it("空名安全返回", () => {
    expect(resolveNameToCanonical(chars, "")).toBe("");
    expect(resolveNameToCanonical(chars, "  ")).toBe("  ");
  });
});
