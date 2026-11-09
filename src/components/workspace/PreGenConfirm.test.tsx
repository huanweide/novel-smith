// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { PreGenConfirm } from "./PreGenConfirm";

/**
 * v3.1.126：本弹窗的 3 个标签原先都只是"视觉上写着字"——label 摆在输入框旁边，
 * 既没有 htmlFor、也没有把控件包进去，属"看得见、念不出、点不到"。
 * 修法是给 label 补 htmlFor、给控件补 id。这里用 getByLabelText 验证真实关联，
 * 若有人把 htmlFor 删掉，用例立刻失败。
 */
const renderDialog = (overrides: Record<string, unknown> = {}) =>
  render(
    <PreGenConfirm
      projectId="p1"
      authorNote=""
      onAuthorNoteChange={vi.fn()}
      onConfirm={vi.fn()}
      onCancel={vi.fn()}
      {...(overrides as unknown as Record<string, never>)}
    />,
  );

describe("v3.1.126 PreGenConfirm 标签与控件显式关联", () => {
  beforeEach(() => {
    // 组件挂载即拉取"预写角色卡"，空数组即可让表单进入可渲染态
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ scheduledCards: [] }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        ),
      ),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it("人物输入框能被标签文本定位，且 id 与 htmlFor 对应", async () => {
    renderDialog();
    const input = await screen.findByLabelText(/人物（可选/);
    expect(input.tagName).toBe("INPUT");
    expect(input.id).toBe("pregen-characters");
  });

  it("作者指令 textarea 能被标签文本定位", async () => {
    renderDialog();
    const ta = await screen.findByLabelText(/作者指令（本章权重/);
    expect(ta.tagName).toBe("TEXTAREA");
    expect(ta.id).toBe("pregen-author-note");
  });

  it("章纲标签的 htmlFor 指向 pregen-chapter-outline（控件按需渲染，但关联必须已就位）", async () => {
    renderDialog({ nodeId: "n1" });
    await screen.findByLabelText(/人物（可选/);
    // Modal 走 portal 渲染到 body，故用 document 查询而非 render 容器
    expect(document.querySelector('label[for="pregen-chapter-outline"]')).toBeTruthy();
  });
});
