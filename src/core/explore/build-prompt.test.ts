import { describe, it, expect } from "vitest";
import { buildGlobalPromptFromExplore, exploreToBuildInputs } from "./build-prompt";
import { buildGlobalPrompt } from "@/core/sync-global-prompt";
import { DEFAULT_BUILD_CONFIG } from "./types";
import type { AdoptedItem, ExploreStep } from "./types";

function makeConfig(overrides: Partial<typeof DEFAULT_BUILD_CONFIG> = {}) {
  return { ...DEFAULT_BUILD_CONFIG, ...overrides };
}

function adopted(step: ExploreStep, title: string, content: string): AdoptedItem {
  return { id: `a-${title}`, step, title, content, timestamp: 0 };
}

describe("buildGlobalPromptFromExplore（R2 收敛：单一构造入口 buildGlobalPrompt）", () => {
  it("输出与写作态同构：以「作品」段开头，含「探讨布置」段", () => {
    const out = buildGlobalPromptFromExplore(makeConfig(), []);
    expect(out.startsWith("# 作品：")).toBe(true);
    expect(out).toContain("## 探讨布置（结构配置）");
    expect(out).toContain("强制原创人名：是");
    expect(out).toContain("自动生成故事线：是");
  });

  it("完整配置：探讨布置段渲染全部结构化字段", () => {
    const out = buildGlobalPromptFromExplore(
      makeConfig({
        novelName: "测试之书",
        genre: "玄幻",
        audience: "男频·青年向",
        wordCount: "50-200万字",
        plotStructure: "five_act",
        styleTags: ["系统流", "升级流"],
        coreConflict: "主角对抗天道",
        powerSystem: "修仙体系",
        goldenFinger: "签到系统",
        stylePreference: "热血燃向",
      }),
      [],
    );
    expect(out).toContain("# 作品：《测试之书》");
    expect(out).toContain("类型：玄幻");
    expect(out).toContain("受众：男频·青年向");
    expect(out).toContain("篇幅：50-200万字");
    expect(out).toContain("情节结构：五幕式");
    expect(out).toContain("流派标签：系统流、升级流");
    expect(out).toContain("核心冲突：主角对抗天道");
    expect(out).toContain("力量体系：修仙体系");
    expect(out).toContain("金手指：签到系统");
    expect(out).toContain("风格偏好：热血燃向");
  });

  it("plotStructure 映射中文标签，未知 id 回退原值", () => {
    expect(buildGlobalPromptFromExplore(makeConfig({ plotStructure: "five_act" }), [])).toContain("情节结构：五幕式");
    expect(buildGlobalPromptFromExplore(makeConfig({ plotStructure: "unknown_x" }), [])).toContain("情节结构：unknown_x");
  });

  it("adopted 内容落入世界书段，标题加粗呈现", () => {
    const out = buildGlobalPromptFromExplore(makeConfig(), [adopted("opening", "开篇设定", "主角从废柴起步")]);
    expect(out).toContain("# 世界书");
    expect(out).toContain("**开篇设定**");
    expect(out).toContain("主角从废柴起步");
  });

  it("adopted 超长内容被世界书单条截断（最松档 loreCap=400）", () => {
    const long = "字".repeat(1200);
    const out = buildGlobalPromptFromExplore(makeConfig(), [adopted("opening", "长文", long)]);
    expect(out).not.toContain(long);
    expect(out).toContain("字".repeat(400) + "…");
  });

  it("中文与特殊字符原样保留", () => {
    const out = buildGlobalPromptFromExplore(makeConfig({ coreConflict: "「龙陨之地」的诅咒 & 复仇" }), []);
    expect(out).toContain("「龙陨之地」的诅咒 & 复仇");
  });

  it("R2 核心验收①：探讨态输出 === 写作态 buildGlobalPrompt(同套入参)", () => {
    const config = makeConfig({ novelName: "等价之书", genre: "科幻", coreConflict: "人机冲突", stylePreference: "严肃深沉" });
    const adoptedItems = [adopted("opening", "开篇", "地球停转"), adopted("power_system", "力量体系", "量子计算")];
    const { project, loreEntries } = exploreToBuildInputs(config, adoptedItems);
    const direct = buildGlobalPrompt(project, [], loreEntries, null);
    const via = buildGlobalPromptFromExplore(config, adoptedItems);
    expect(via).toBe(direct);
  });

  it("R2 核心验收②：genre 为空时与写作态一致（同样输出空「类型：」行）", () => {
    const config = makeConfig({ genre: "", novelName: "空类型之书" });
    const { project, loreEntries } = exploreToBuildInputs(config, []);
    const direct = buildGlobalPrompt(project, [], loreEntries, null);
    expect(buildGlobalPromptFromExplore(config, [])).toBe(direct);
    // 与写作态共享渲染：空 genre 仍输出「类型：」行（不再静默丢弃）
    expect(direct).toContain("类型：");
  });
});
