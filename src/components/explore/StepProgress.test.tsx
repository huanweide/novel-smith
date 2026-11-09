// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { StepProgress } from "./StepProgress";
import type { AdoptedItem } from "@/core/explore/types";

const adoptedItem = (step: AdoptedItem["step"], title: string): AdoptedItem => ({
  id: `adopt_${title}`,
  step,
  title,
  content: "测试内容",
  timestamp: Date.now(),
});

function setup(currentStep: Parameters<typeof StepProgress>[0]["currentStep"], adopted: AdoptedItem[] = []) {
  const onStepChange = vi.fn();
  render(<StepProgress currentStep={currentStep} adopted={adopted} onStepChange={onStepChange} />);
  return onStepChange;
}

describe("StepProgress - 探讨模式进度条", () => {
  it("渲染 11 个步骤标签", () => {
    setup("opening");
    for (const label of ["开篇", "世界观", "主角身份", "金手指", "核心冲突", "势力阵营", "力量体系", "货币体系", "地图", "情节脉络", "自由讨论"]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
  });

  it("点击任意步骤直接切到该步（未完成步骤）", () => {
    const onStepChange = setup("opening");
    fireEvent.click(screen.getByText("世界观"));
    expect(onStepChange).toHaveBeenCalledWith("worldview");
  });

  it("点击已完成步骤回跳到该步本身，而不是链跳到下一步（回归：用户要求可回前面继续讨论）", () => {
    const onStepChange = setup("worldview", [adoptedItem("opening", "都市异能方向")]);
    fireEvent.click(screen.getByText("开篇"));
    expect(onStepChange).toHaveBeenCalledWith("opening");
  });

  it("已完成步骤显示 ✓ 与采纳计数徽标", () => {
    setup("worldview", [adoptedItem("opening", "都市异能方向")]);
    expect(screen.getByText("✓")).toBeTruthy();
    expect(screen.getByText("1")).toBeTruthy();
  });
});
