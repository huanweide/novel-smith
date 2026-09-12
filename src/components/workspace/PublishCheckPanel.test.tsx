// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { PublishCheckPanel } from "./PublishCheckPanel";

/**
 * v3.1.128：PublishCheckPanel（导出 / 审稿面板）6 个会提交的控件——目标平台 / 导出格式 /
 * 审稿角色 / 审稿范围 / 选择章节 / 提示词（可编辑）——原先是「兄弟 <span> 文字 + 控件」，
 * 没有 htmlFor/id 关联：读屏念不出、点文字不聚焦。现把 span 改为 <label htmlFor>、给控件加 id。
 * 这里把「导出面板 2 个 + 审稿面板 3 个」的标签关联钉死；
 * 「选择章节」需先切到 single 范围（会触发拉章节的网络请求），本测试不覆盖，留作后续。
 */
const renderPanel = () => render(<PublishCheckPanel projectId="p1" />);

describe("v3.1.128 PublishCheckPanel 字段标签关联", () => {
  it("导出面板：目标平台 / 导出格式 标签可定位且 id 对应", () => {
    renderPanel();
    expect((screen.getByLabelText("目标平台") as HTMLSelectElement).id).toBe("pc-platform");
    expect((screen.getByLabelText("导出格式") as HTMLSelectElement).id).toBe("pc-format");
  });

  it("切到模拟审稿后：审稿角色 / 审稿范围 / 提示词 标签可定位且 id 对应", async () => {
    renderPanel();
    fireEvent.click(screen.getByText("模拟审稿"));
    await waitFor(() => {
      expect((screen.getByLabelText("审稿角色") as HTMLSelectElement).id).toBe("pc-role");
    });
    expect((screen.getByLabelText("审稿范围") as HTMLSelectElement).id).toBe("pc-scope");
    expect((screen.getByLabelText("提示词（可编辑）") as HTMLTextAreaElement).id).toBe("pc-system-prompt");
  });
});
