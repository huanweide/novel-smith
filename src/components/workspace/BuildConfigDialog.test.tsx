// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { BuildConfigDialog } from "./BuildConfigDialog";

/**
 * v3.1.127：BuildConfigDialog 是「项目设定」保存对话框，9 个配置字段（书名/类型/受众/字数/
 * 情节结构/风格偏好/力量体系/金手指/核心冲突）+ 1 个流派标签搜索框原先只有「裸 <label> 兄弟节点」
 * 或纯 placeholder，没有 htmlFor/id 关联——看得见、读屏念不出、点标签不聚焦。
 * 这里把「每个字段都能被 getByLabelText 取到、id 与 htmlFor 对应、点标签可聚焦」钉死。
 */
const renderDialog = () =>
  render(
    <BuildConfigDialog
      projectId="p1"
      buildConfig={null}
      onSaved={vi.fn()}
      onClose={vi.fn()}
    />
  );

describe("v3.1.127 BuildConfigDialog 字段标签关联", () => {
  it("基础信息的四个字段都有标签，且 id 与 htmlFor 对应", () => {
    renderDialog();
    expect((screen.getByLabelText("书名") as HTMLInputElement).id).toBe("build-novel-name");
    expect((screen.getByLabelText("类型") as HTMLSelectElement).id).toBe("build-genre");
    expect((screen.getByLabelText("受众") as HTMLSelectElement).id).toBe("build-audience");
    expect((screen.getByLabelText("字数") as HTMLInputElement).id).toBe("build-word-count");
    expect((screen.getByLabelText("情节结构") as HTMLSelectElement).id).toBe("build-plot-structure");
  });

  it("风格与设定的四个字段都有标签，且 id 与 htmlFor 对应", () => {
    renderDialog();
    expect((screen.getByLabelText("风格偏好") as HTMLSelectElement).id).toBe("build-style-preference");
    expect((screen.getByLabelText("力量体系") as HTMLInputElement).id).toBe("build-power-system");
    expect((screen.getByLabelText("金手指") as HTMLInputElement).id).toBe("build-golden-finger");
    expect((screen.getByLabelText("核心冲突") as HTMLTextAreaElement).id).toBe("build-core-conflict");
  });

  it("流派标签搜索框通过 aria-label 获得可访问名", () => {
    renderDialog();
    const input = screen.getByLabelText("搜索流派标签") as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(input.getAttribute("aria-label")).toBe("搜索流派标签");
  });

  it("标签的 htmlFor 指向真实存在的控件 id（关联真实生效）", () => {
    renderDialog();
    const label = screen.getByText("书名") as HTMLLabelElement;
    expect(label.htmlFor).toBe("build-novel-name");
    expect(document.getElementById(label.htmlFor)).toBe(screen.getByLabelText("书名"));
  });
});
