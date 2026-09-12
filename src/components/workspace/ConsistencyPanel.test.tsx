// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { FactForm } from "./ConsistencyPanel";

/**
 * v3.1.126：一致性事实的录入行是紧凑纵向表单，5 个控件原先全靠 placeholder 表达语义——
 * 一打字提示就消失，读屏软件也念不出字段名。这里把「每个控件必须有可访问名」钉死。
 *
 * 该行按设计保持紧凑（不塞可见标签），所以用的是 aria-label 而不是 FormLabel；
 * 无论哪种方式，`getByLabelText` 都只认"真实的标签关联"（aria-label / htmlFor / 包裹），
 * 光有 placeholder 是拿不到的——这正是本组用例的守门点。
 */
const base = { category: "character" as const, subject: "", attribute: "", value: "", confidence: 1 };
const renderForm = () => render(<FactForm initial={base} onSubmit={vi.fn()} onCancel={vi.fn()} />);

describe("v3.1.126 ConsistencyPanel 事实录入行的可访问名", () => {
  it("分类下拉能被可访问名定位", () => {
    renderForm();
    const el = screen.getByLabelText("一致性分类");
    expect(el.tagName).toBe("SELECT");
  });

  it("主体 / 属性 / 事实值 / 置信度 四个输入框都能被可访问名定位", () => {
    renderForm();
    for (const name of ["主体", "属性", "事实值", "置信度"]) {
      const el = screen.getByLabelText(name);
      expect(el).toBeTruthy();
      expect(el.tagName).toBe("INPUT");
    }
  });

  it("可访问名与 placeholder 语义一致（改一处忘另一处会被抓出来）", () => {
    renderForm();
    expect((screen.getByLabelText("主体") as HTMLInputElement).placeholder).toContain("主体");
    expect((screen.getByLabelText("属性") as HTMLInputElement).placeholder).toContain("属性");
    expect((screen.getByLabelText("事实值") as HTMLInputElement).placeholder).toContain("事实值");
    expect((screen.getByLabelText("置信度") as HTMLInputElement).placeholder).toContain("置信度");
  });
});
