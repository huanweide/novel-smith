/**
 * 生成后净化：剥离模型偶发泄漏的「后台协议标记」。
 *
 * 背景：orchestrator 的"输出协议"曾强制要求模型在正文头部输出【剧情校准 HUD】
 * 状态快照块（第八部分协议 · 一、头部）。即便已改为"后台静默自检、严禁输出正文"，
 * 个别模型仍可能把该标记吐进正文。本模块在落库前做最终兜底，
 * 保证进入 storyNode.content 的正文纯净、无协议残留。
 */
const PROTOCOL_LEAK_PATTERNS: RegExp[] = [
  // 整块：`---` 包裹且内含 HUD 标记（含其间的状态行）
  /---[\s\S]*?【剧情校准\s*HUD】[\s\S]*?---/gi,
  // 未用 `---` 包裹时：HUD 标题行 + 其后连续的缩进状态行（到首个非缩进正文行/空行停止）
  /^[ \t]*【剧情校准\s*HUD】[^\n]*\n(?:[ \t]+[^\n]*\n)*/gim,
];

/** 剥离后台协议泄漏标记，返回净化后的正文。空输入原样返回。 */
export function stripProtocolLeak(text: string): string {
  if (!text) return text;
  let out = text;
  for (const re of PROTOCOL_LEAK_PATTERNS) {
    out = out.replace(re, "");
  }
  // 剥离后可能产生多余空行，压缩为最多两个连续换行并收尾
  out = out.replace(/\n{3,}/g, "\n\n").replace(/^\n+/, "").replace(/\n+$/, "");
  return out;
}
