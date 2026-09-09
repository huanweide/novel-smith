// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ProjectSwitcher } from "./ProjectSwitcher";

const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const PROJECTS = [
  { id: "p1", name: "当前之书", _count: { storyNodes: 3 } },
  { id: "p2", name: "另一本书", _count: { storyNodes: 7 } },
];

const stubFetchOk = () =>
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => PROJECTS })));

const stubFetchFail = () =>
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })));

const openPanel = () => fireEvent.click(screen.getByLabelText("切换项目"));

describe("ProjectSwitcher 多项目快捷切换（ROADMAP P1 #4）", () => {
  beforeEach(() => {
    push.mockReset();
    stubFetchOk();
  });

  it("未展开时不请求列表——避免每次进写作页都多打一次接口", () => {
    render(<ProjectSwitcher currentId="p1" currentName="当前之书" />);
    expect(screen.getByText("当前之书")).toBeTruthy();
    expect(vi.mocked(globalThis.fetch).mock.calls.length).toBe(0);
  });

  it("展开后拉取列表：渲染其他项目名 + 章节数，且当前项目不重复列出", async () => {
    render(<ProjectSwitcher currentId="p1" currentName="当前之书" />);
    openPanel();
    await waitFor(() => expect(screen.getByText("另一本书")).toBeTruthy());
    expect(screen.getByText("7 章")).toBeTruthy();
    // 「全部项目」+「另一本书」两项；当前项目 p1 被过滤掉
    expect(screen.getAllByRole("option").length).toBe(2);
  });

  it("点其他项目 → 跳转到该项目写作页", async () => {
    render(<ProjectSwitcher currentId="p1" currentName="当前之书" />);
    openPanel();
    await waitFor(() => expect(screen.getByText("另一本书")).toBeTruthy());
    fireEvent.click(screen.getByText("另一本书"));
    expect(push).toHaveBeenCalledWith("/workspace/p2");
  });

  it("点「全部项目」→ 回项目列表首页", async () => {
    render(<ProjectSwitcher currentId="p1" currentName="当前之书" />);
    openPanel();
    await waitFor(() => expect(screen.getByText("全部项目")).toBeTruthy());
    fireEvent.click(screen.getByText("全部项目"));
    expect(push).toHaveBeenCalledWith("/");
  });

  it("请求失败 → 显示错误提示而不是白屏", async () => {
    stubFetchFail();
    render(<ProjectSwitcher currentId="p1" currentName="当前之书" />);
    openPanel();
    await waitFor(() => expect(screen.getByText("项目列表加载失败")).toBeTruthy());
  });
});
