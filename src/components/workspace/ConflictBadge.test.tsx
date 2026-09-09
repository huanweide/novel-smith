// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ConflictBadge } from "./ConflictBadge";

const CONFLICTS = [
  {
    id: "cf1",
    nodeId: "n1",
    category: "角色状态",
    description: "新章说林越已死，但基线记的是失踪",
    excerpt: "林越倒在血泊里，再没起来",
    status: "open",
  },
  {
    id: "cf2",
    nodeId: "n2",
    category: "时间线",
    description: "本章发生在三年后，基线记的是同年",
    excerpt: "三年匆匆过去",
    status: "open",
  },
];

const stubFetch = (conflicts: unknown[] = CONFLICTS, ok = true) =>
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: { method?: string }) => {
      if (init?.method === "POST") return { ok, json: async () => ({ ok: true }) };
      return { ok, json: async () => ({ conflicts }) };
    }),
  );

describe("ConflictBadge 世界书冲突检测可视化（ROADMAP P2 #6）", () => {
  beforeEach(() => {
    stubFetch();
  });

  it("有待处理冲突 → 顶部显示冲突数量徽标", async () => {
    render(<ConflictBadge projectId="p1" onJumpToNode={vi.fn()} />);
    await waitFor(() => expect(screen.getByLabelText("2 处待处理冲突")).toBeTruthy());
    expect(screen.getByText("2")).toBeTruthy();
  });

  it("无冲突 → 徽标不显示数字，展开提示没有打架", async () => {
    stubFetch([]);
    render(<ConflictBadge projectId="p1" onJumpToNode={vi.fn()} />);
    await waitFor(() => expect(screen.getByLabelText("无待处理冲突")).toBeTruthy());
    fireEvent.click(screen.getByLabelText("无待处理冲突"));
    await waitFor(() => expect(screen.getByText(/暂无未处理的设定冲突/)).toBeTruthy());
  });

  it("展开后列出每条冲突的说明与正文摘录", async () => {
    render(<ConflictBadge projectId="p1" onJumpToNode={vi.fn()} />);
    await waitFor(() => expect(screen.getByLabelText("2 处待处理冲突")).toBeTruthy());
    fireEvent.click(screen.getByLabelText("2 处待处理冲突"));
    await waitFor(() => expect(screen.getByText(/基线记的是失踪/)).toBeTruthy());
    expect(screen.getByText(/林越倒在血泊里/)).toBeTruthy();
    expect(screen.getByText("角色状态")).toBeTruthy();
  });

  it("点「跳到该章」→ 回调该冲突所属 nodeId", async () => {
    const onJump = vi.fn();
    render(<ConflictBadge projectId="p1" onJumpToNode={onJump} />);
    await waitFor(() => expect(screen.getByLabelText("2 处待处理冲突")).toBeTruthy());
    fireEvent.click(screen.getByLabelText("2 处待处理冲突"));
    await waitFor(() => expect(screen.getAllByTitle("跳到引发冲突的章节").length).toBe(2));
    fireEvent.click(screen.getAllByTitle("跳到引发冲突的章节")[1]);
    expect(onJump).toHaveBeenCalledWith("n2");
  });

  it("标记「已修正」→ 该条移出列表，计数递减", async () => {
    render(<ConflictBadge projectId="p1" onJumpToNode={vi.fn()} />);
    await waitFor(() => expect(screen.getByLabelText("2 处待处理冲突")).toBeTruthy());
    fireEvent.click(screen.getByLabelText("2 处待处理冲突"));
    await waitFor(() => expect(screen.getAllByText("已修正").length).toBe(2));
    fireEvent.click(screen.getAllByText("已修正")[0]);
    await waitFor(() => expect(screen.getByLabelText("1 处待处理冲突")).toBeTruthy());
  });

  it("列表请求失败 → 显示错误提示而不是白屏", async () => {
    stubFetch([], false);
    render(<ConflictBadge projectId="p1" onJumpToNode={vi.fn()} />);
    await waitFor(() => expect(screen.getByLabelText("无待处理冲突")).toBeTruthy());
    fireEvent.click(screen.getByLabelText("无待处理冲突"));
    await waitFor(() => expect(screen.getByText("冲突列表加载失败")).toBeTruthy());
  });
});
