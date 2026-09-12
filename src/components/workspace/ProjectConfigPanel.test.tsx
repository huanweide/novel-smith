// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ProjectConfigPanel } from "./ProjectConfigPanel";

/**
 * v3.1.126：本面板的 11 个输入框原先全是"裸 input + placeholder"——
 * 规则名 / 正则 pattern / flags / 替换为、以及项目级 LLM 覆盖的 模型名 / Base URL / API Key，
 * 一打字提示就消失，用户填到一半认不出这一格是什么，读屏也念不出字段名。
 * 这里把「每个字段都能被 getByLabelText 取到、且 id 与 htmlFor 对应」钉死。
 */
const project = {
  appliedPresets: [],
  postProcessingRules: [{ name: "去空格", pattern: "\\s+", flags: "g", replace: "" }],
  llmConfig: { model: "", baseUrl: "", apiKey: "" },
};

const renderPanel = () =>
  render(<ProjectConfigPanel projectId="p1" project={project} onSaved={vi.fn()} onClose={vi.fn()} />);

describe("v3.1.126 ProjectConfigPanel 字段标签", () => {
  it("规则列表的四个字段都有标签，且 id 按规则下标生成", () => {
    renderPanel();
    expect((screen.getByLabelText("规则名") as HTMLInputElement).id).toBe("rule-0-name");
    expect((screen.getByLabelText(/正则 pattern/) as HTMLInputElement).id).toBe("rule-0-pattern");
    expect((screen.getByLabelText("flags") as HTMLInputElement).id).toBe("rule-0-flags");
    expect((screen.getByLabelText("替换为（留空=删除匹配内容）") as HTMLInputElement).id).toBe("rule-0-replace");
  });

  it("项目级 LLM 覆盖的三个字段都有标签", () => {
    renderPanel();
    expect((screen.getByLabelText("模型名") as HTMLInputElement).id).toBe("proj-llm-model");
    expect((screen.getByLabelText("Base URL") as HTMLInputElement).id).toBe("proj-llm-baseurl");
    expect((screen.getByLabelText("API Key") as HTMLInputElement).id).toBe("proj-llm-apikey");
  });

  it("新增规则弹窗默认关闭，故字段名不会与列表里的重复", () => {
    renderPanel();
    // 列表里各字段名唯一（弹窗未打开 → new-rule-* 的控件不在文档里）
    expect(screen.queryByLabelText("flags")).toBeTruthy();
    expect(document.querySelector("#new-rule-name")).toBeNull();
  });
});
