"use client";

/**
 * 表单字段标签（全站共享）。
 *
 * 为什么要有它（v3.1.125 在 WorldEditor 里诞生，v3.1.126 提取为共享组件）：
 * 项目里不少输入框只有一个灰色 placeholder 当"提示语"，**一打字提示就消失**——
 * 用户填到一半回头看认不出这格是什么；读屏软件也只能念提示语、念不出字段名。
 * 更隐蔽的是第三种情况：标签视觉上明明写着字，却没和输入框建立语义关联
 * （label 摆在旁边、既没有 htmlFor 也没把控件包进去）——**看得见、念不出、点不到**。
 *
 * 本组件用 `htmlFor` + `id` **显式关联**，一次性把上面三种情况都解决：
 *   - 视觉：字段名常驻显示，不随输入消失；
 *   - 读屏：能被念出字段名；
 *   - 交互：点标签可聚焦/切换对应控件。
 *
 * 用法：
 *   <FormLabel htmlFor="rule-0-name" text="规则名" required />
 *   <input id="rule-0-name" ... />
 *
 * 注意：`htmlFor` 必须与控件的 `id` 完全一致，且 `id` 在页面内唯一
 * （列表渲染时把下标拼进 id，例如 `rule-${idx}-name`）。
 * 行内紧凑控件（放不下可见标签）请改用 `aria-label`，不要硬塞本组件。
 */
export function FormLabel({
  htmlFor,
  text,
  required,
  className,
}: {
  htmlFor: string;
  text: string;
  required?: boolean;
  className?: string;
}) {
  return (
    <label htmlFor={htmlFor} className={`mb-0.5 block text-[10px] text-[var(--nv-text-muted)] ${className ?? ""}`}>
      {text}
      {required && <span className="ml-0.5 text-[var(--nv-danger)]">*</span>}
    </label>
  );
}
