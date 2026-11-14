import { describe, expect, it } from "vitest";
import {
  admissionReason,
  deadSeal,
  markDead,
  shouldAdmitCard,
  sortRoster,
} from "./character-admission";

describe("角色卡准入：谁配有一张卡", () => {
  it("无名泛称（店小二）不建卡——规则原文的第一案例", () => {
    expect(shouldAdmitCard("店小二")).toBe(false);
    expect(shouldAdmitCard("路人甲")).toBe(false);
    expect(shouldAdmitCard("侍女")).toBe(false);
    expect(shouldAdmitCard("修士")).toBe(false);
  });

  it("有名字的人建卡", () => {
    expect(shouldAdmitCard("林舟")).toBe(true);
    expect(shouldAdmitCard("柳掌柜")).toBe(true); // 姓+岗位是名字，不是泛称
    expect(shouldAdmitCard("小二哥")).toBe(true); // 绰号也是名字（泛称表是精确匹配）
  });

  it("泛称但作者钦定（有正经简介）→ 放行", () => {
    expect(shouldAdmitCard("店小二", { hasBrief: true })).toBe(true);
  });

  it("主角永远有卡；已建档的永远保留（不倒删）", () => {
    expect(shouldAdmitCard("店小二", { isPlayer: true })).toBe(true);
    expect(shouldAdmitCard("路人甲", { alreadySaved: true })).toBe(true);
  });

  it("空名/纯符号/超长不算名字", () => {
    expect(shouldAdmitCard("")).toBe(false);
    expect(shouldAdmitCard("   ")).toBe(false);
    expect(shouldAdmitCard("?!？！")).toBe(false);
    expect(shouldAdmitCard("一".repeat(21))).toBe(false);
  });

  it("准入理由给人话（名录悬浮提示用）", () => {
    expect(admissionReason("店小二")).toContain("无名之辈");
    expect(admissionReason("店小二", { hasBrief: true })).toContain("作者钦定");
    expect(admissionReason("林舟")).toBe("有名字的人");
    expect(admissionReason("林舟", { isPlayer: true })).toBe("这是你自己");
  });
});

describe("退场死亡：垫后，不删除", () => {
  it("sortRoster 活人在前、死者垫后，组内保持原序", () => {
    const roster = [
      { name: "甲", dead: false },
      { name: "亡者一", dead: true, exitRound: 3 },
      { name: "乙", dead: false },
      { name: "亡者二", dead: true, exitRound: 9 },
    ];
    expect(sortRoster(roster as any).map((e) => e.name)).toEqual(["甲", "乙", "亡者一", "亡者二"]);
  });

  it("markDead 幂等：第一次死在第几回合就永远是第几回合", () => {
    const once = markDead({ name: "张三" } as any, 5);
    expect(once).toMatchObject({ dead: true, exitRound: 5 });
    const twice = markDead(once, 12);
    expect(twice.exitRound).toBe(5);
  });

  it("markDead 容忍未建档的人（sheet undefined）", () => {
    expect(markDead(undefined, 7)).toMatchObject({ dead: true, exitRound: 7 });
  });

  it("deadSeal 出印章文案；活人无印章", () => {
    expect(deadSeal({ dead: true, exitRound: 9 })).toBe("殁 · 第9回合");
    expect(deadSeal({ dead: true })).toBe("殁");
    expect(deadSeal({ dead: false })).toBeNull();
    expect(deadSeal(undefined)).toBeNull();
    expect(deadSeal(null)).toBeNull();
  });
});
