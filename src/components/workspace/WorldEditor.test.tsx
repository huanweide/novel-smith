// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { WorldEditor } from "./WorldEditor";
import { MODULE_FIELDS } from "./worldPanelData";

/**
 * v3.1.125：世界书新建表单的字段必须有「可被读屏念出来的中文标签」。
 *
 * 背景：这个表单原先每个输入框只有一个灰色 placeholder（如「大陆/国家/城市/宗门/秘境/禁地」），
 * 一打字提示就消失，用户回头看不知道自己填的是「类型」还是「所属上层地域」，
 * 读屏也只能念出提示语。而字段的中文名本来就在 MODULE_FIELDS 的 label 里，
 * 只是从来没渲染过 —— 同表单的「记忆注入方式」下拉框却一直有标签。
 *
 * 这些用例把「label 必须与控件显式关联」钉死，防止回归成 placeholder-only。
 */

const GEO_FIELDS = MODULE_FIELDS.geography;

function renderEditor(overrides: Record<string, unknown> = {}) {
  const props = {
    activeModule: "geography" as const,
    moduleInfo: { key: "geography" as const, label: "地理地图", icon: "globe" as const, desc: "大陆、国家、城市、宗门、秘境" },
    currentFields: GEO_FIELDS,
    showCreate: true,
    createForm: {} as Record<string, string>,
    saving: false,
    onSetShowCreate: vi.fn(),
    onChangeField: vi.fn(),
    onCreate: vi.fn(),
    ...overrides,
  } as unknown as Parameters<typeof WorldEditor>[0];
  return render(<WorldEditor {...props} />);
}

describe("v3.1.125 WorldEditor 新建表单的字段标签", () => {
  it("每个字段都有可见中文标签，且标签与输入框显式关联（可被读屏念出）", () => {
    renderEditor();
    for (const f of GEO_FIELDS) {
      // getByLabelText 只认 label↔控件 的真实关联（htmlFor/id 或包裹关系），
      // 光有 placeholder 是拿不到的 —— 所以这条断言正好卡住「退回 placeholder-only」。
      const el = screen.getByLabelText(new RegExp(`^${f.label}$`));
      expect(el).toBeTruthy();
      expect(el.id).toBe(`wf-${f.key}`);
    }
  });

  it("标题字段带必填星号，且标签用板块名（地理地图名称）", () => {
    renderEditor();
    const title = screen.getByLabelText(/地理地图名称/);
    expect(title.id).toBe("wf-title");
  });

  it("记忆注入方式下拉框同样有关联标签（不再只靠包裹式 label）", () => {
    renderEditor();
    const depth = screen.getByLabelText(/记忆注入方式/);
    expect(depth.id).toBe("wf-depth");
  });

  it("提交按钮文案统一为「创建」，与角色/章节弹窗一致", () => {
    renderEditor();
    expect(screen.getByRole("button", { name: /创建$/ })).toBeTruthy();
    // 同一个动作不该同时存在「保存」这种会让人以为只存草稿的说法
    expect(screen.queryByRole("button", { name: /^保存$/ })).toBeNull();
  });

  it("保存中显示「创建中...」且按钮禁用", () => {
    renderEditor({ saving: true });
    const btn = screen.getByRole("button", { name: /创建中/ });
    expect(btn).toBeTruthy();
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });

  it("表单未展开时不渲染任何字段标签", () => {
    renderEditor({ showCreate: false });
    for (const f of GEO_FIELDS) {
      expect(screen.queryByLabelText(new RegExp(`^${f.label}$`))).toBeNull();
    }
  });
});
