/**
 * GitHub Pages 演示页入口 —— 「去 AI 味检测」本地规则引擎
 *
 * 关键点：这里直接 import 项目真实引擎 src/core/humanize，
 * 保证演示站跑的就是产品本体那套逻辑（不重写、不 mock）。
 * 引擎纯本地：正则 + 统计，不调 LLM、不联网、不要 API Key、不碰数据库。
 */
import {
  analyzeText,
  applyFixes,
  countFixable,
} from "../../src/core/humanize/index";
import type { HumanizeReport, AiTraceHit } from "../../src/core/humanize/types";

const $ = <T extends HTMLElement>(sel: string) =>
  document.querySelector(sel) as T;

const input = $<HTMLTextAreaElement>("#input");
const output = $<HTMLDivElement>("#output");

// ── 示例文本 ────────────────────────────────────────────────
const SAMPLE_AI = `值得注意的是，这段文字不仅描绘了风景，更深刻地触及了人物的内心世界。
总而言之，作者用细腻的笔触展现了一个复杂而动人的故事。人物的表情——那种既犹豫又坚定的神态——被刻画得淋漓尽致。
不仅如此，场景的描写也极为出色。天空是湛蓝的，大地是广袤的，风是柔和的。这种描写让人感到无比舒适。
然而，正是这样的 contrasts 造成了巨大的张力。人物在思考，在犹豫，在挣扎。这就是成长的代价，也是选择的必然。可以说，这个故事令人深思。`;

const SAMPLE_HUMAN = `他推开门，油烟味先扑过来。
锅里炖着东西，咕嘟咕嘟响。老头没回头，只说了句：回来了？鞋脱在门口。
他把湿外套挂上，雨水顺着袖口往下淌。桌上摆着两副碗筷，还有一只没动过的酒盅。
老头盛了一碗推过来，汤面上浮着葱花。他接住，手指烫了一下，也没说什么。`;

// ── 工具 ────────────────────────────────────────────────────
function esc(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!),
  );
}
function sevClass(sev: string): string {
  return sev === "high" ? "sev-high" : sev === "medium" ? "sev-mid" : "sev-low";
}
function scoreColor(score: number): string {
  if (score >= 60) return "#ef4444";
  if (score >= 30) return "#f59e0b";
  return "#22c55e";
}

let currentText = "";
let currentReport: HumanizeReport | null = null;

// ── 渲染 ────────────────────────────────────────────────────
function render(): void {
  currentReport = analyzeText(currentText);
  const r = currentReport;
  const s = r.stats;
  const fixable = countFixable(r.hits);
  const color = scoreColor(r.score);

  const statsChips = `
    <div class="chips">
      <span class="chip">字数 <b>${s.chars}</b></span>
      <span class="chip">句子 <b>${s.sentenceCount}</b></span>
      <span class="chip">平均句长 <b>${s.avgSentenceLen.toFixed(1)}</b></span>
      <span class="chip">短句率 <b>${(s.shortSentenceRatio * 100).toFixed(0)}%</b></span>
      <span class="chip">破折号/千字 <b>${s.dashPerK.toFixed(1)}</b></span>
      <span class="chip">AI高频词/千字 <b>${s.aiWordPerK.toFixed(1)}</b></span>
    </div>`;

  const byRule =
    r.byRule.length > 0
      ? `<div class="section">
           <h3>按规则汇总</h3>
           <ul class="rules">
             ${r.byRule
               .map(
                 (x) =>
                   `<li><span class="dot ${sevClass(x.severity)}"></span>${esc(
                     x.ruleName,
                   )} × <b>${x.count}</b></li>`,
               )
               .join("")}
           </ul>
         </div>`
      : "";

  const hits =
    r.hits.length > 0
      ? `<div class="section">
           <h3>命中痕迹（${r.hits.length} 条，每条都带原文证据）</h3>
           ${r.hits
             .map((h, i) => {
               const fixBtn = h.fix
                 ? `<button class="fix" data-fix="${i}">${esc(h.fix.label)}</button>`
                 : `<span class="nofix">需作者自己动笔</span>`;
               return `<div class="hit">
                 <div class="hit-head">
                   <span class="badge ${sevClass(h.severity)}">${
                     h.severity === "high" ? "高" : h.severity === "medium" ? "中" : "低"
                   }</span>
                   <span class="rname">${esc(h.ruleName)}</span>${fixBtn}
                 </div>
                 <div class="excerpt">${esc(h.excerpt)}</div>
                 <div class="why">${esc(h.reason)}</div>
                 <div class="fix-tip">建议：${esc(h.suggestion)}</div>
               </div>`;
             })
             .join("")}
         </div>`
      : `<div class="section clean">没检出明显 AI 痕迹，写得挺像人话。</div>`;

  const fixAll =
    fixable > 0
      ? `<button id="apply-all" class="apply-all">一键套用 ${fixable} 处安全修复</button>`
      : "";

  output.innerHTML = `
    <div class="card score-card">
      <div class="score" style="color:${color}">${r.score}<small>/100</small></div>
      <div>
        <div class="level" style="color:${color}">${esc(r.levelLabel)}</div>
        <div class="hint">AI 痕迹指数：越高越像 AI 写的</div>
      </div>
    </div>
    ${statsChips}
    ${fixAll}
    ${byRule}
    ${hits}
    <div class="disclaimer">${esc(r.disclaimer)}</div>
  `;

  const all = document.getElementById("apply-all");
  if (all) {
    all.addEventListener("click", () => {
      if (!currentReport) return;
      const res = applyFixes(currentText, currentReport.hits);
      currentText = res.text;
      input.value = currentText;
      render();
    });
  }
  output.querySelectorAll<HTMLButtonElement>("button.fix").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!currentReport) return;
      const idx = Number(btn.dataset.fix);
      const hit: AiTraceHit | undefined = currentReport.hits[idx];
      if (!hit || !hit.fix) return;
      const res = applyFixes(currentText, [hit]);
      currentText = res.text;
      input.value = currentText;
      render();
    });
  });
}

// ── 绑定 ────────────────────────────────────────────────────
function detect(): void {
  currentText = input.value || "";
  if (!currentText.trim()) {
    output.innerHTML = `<div class="section">先粘贴或载入一段文字。</div>`;
    return;
  }
  render();
}

document.getElementById("detect")!.addEventListener("click", detect);
document.getElementById("sample-ai")!.addEventListener("click", () => {
  input.value = SAMPLE_AI;
  detect();
});
document.getElementById("sample-human")!.addEventListener("click", () => {
  input.value = SAMPLE_HUMAN;
  detect();
});

// 首屏载入 AI 示例，让人一眼看到效果
input.value = SAMPLE_AI;
detect();
