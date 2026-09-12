/**
 * 实时写作教练内核 —— 100% 本地规则引擎，零 Token、零外泄。
 *
 * 复用 src/core/quality/quality-analyzer 的六维分析（纯正则+统计，不含任何 LLM 调用），
 * 把每维的「分数 + 问题」翻译成作者能直接用的中文教练建议（tip 讲清在测什么，
 * fix 给可落手的改法）。所有逻辑为纯函数，可独立单测，亦可被客户端组件直接 import。
 *
 * 设计原则（第一性原理）：
 *  - 不新增任何网络调用：分析器本就是本地算法，作者边打字边算，毫秒级、不耗钱。
 *  - 不重复造轮子：六维检测算法全部复用 analyzeQuality，本文件只做「结果→教练话术」的映射层。
 *  - 教练不替作者写：只点出问题 + 给方向，最终裁量是作者自己的（与 humanize 的「只建议不自动改写」同源）。
 */

import { analyzeQuality, type DimensionScore, type QualityReport } from "./quality-analyzer";

// ─── 教练话术（单一来源）───
// 每维一条：tip = 这个维度在测什么（大白话）；fix = 怎么改（可落手）。
export interface CoachAdvice {
  tip: string;
  fix: string;
}

export const COACH_ADVICE: Record<string, CoachAdvice> = {
  wasteWordRate: {
    tip: "废词率：正文里「然后/突然/仿佛/似乎」这类稀释力度的水词密度。",
    fix: "删掉可有可无的副词，用动作替代形容。例：「他突然冲出去」→「他撞开门冲了出去」。",
  },
  showVsTell: {
    tip: "展示 vs 讲述比：用动作、感官、对话「演」出来，还是用旁白直接「说」出来。",
    fix: "把「她很害怕」改成「她攥紧衣角，呼吸发紧」——让事实自己显形，别替读者下结论。",
  },
  povConsistency: {
    tip: "视角一致性：同一段最好锁定一个角色的视角，频繁跳视角会让读者「晕镜头」。",
    fix: "检查相邻段落是不是换了旁观者。一段只跟一个人的眼睛看、耳朵听。",
  },
  sentenceVariety: {
    tip: "句式多样性：连续多句用同样的开头/结构，读起来像机器人在报数。",
    fix: "打乱句子开头：长短交错、主被动交替、偶尔用对话或环境描写破局。",
  },
  dialogueNaturalness: {
    tip: "对话自然度：连续 5 句以上纯对话会像剧本，缺了动作和场景的「肉」。",
    fix: "每 2-3 句对话后插一句动作/神态/环境，让人物「活在场景里」而不是干说话。",
  },
  subjectDiversity: {
    tip: "主语多样性：连续多句以「他/她」开头，主语单调、镜头僵。",
    fix: "把部分「他」换成具体动作或环境切入：「他推开们」→「门轴吱呀一声，他闪身进屋」。",
  },
};

// ─── 类型 ─────────────────────────────────────────────────
export interface CoachDimension extends DimensionScore {
  advice: CoachAdvice;
}

export interface CoachReport {
  overallScore: number;
  grade: QualityReport["grade"];
  passed: boolean;
  summary: string;
  dimensions: CoachDimension[];
  /** 有问题（score<70 或含 issues）的维度数，供面板快速提示 */
  flaggedCount: number;
}

// ─── 主函数 ───────────────────────────────────────────────

/**
 * 对一段正文生成「写作教练报告」。
 * @param text 正文
 * @param characterNames 已知角色名（供 PoV / 主语检测，纯本地）
 * @returns 六维教练报告（含每维中文建议）
 */
export function buildCoachReport(text: string, characterNames: string[] = []): CoachReport {
  const qr = analyzeQuality(text, characterNames);
  const dimensions: CoachDimension[] = qr.dimensions.map((d: DimensionScore) => ({
    ...d,
    advice: COACH_ADVICE[d.key] ?? { tip: d.detail, fix: "通读该段，看是否有可删减或重组之处。" },
  }));
  const flaggedCount = dimensions.filter((d) => d.score < 70 || d.issues.length > 0).length;
  return {
    overallScore: qr.overallScore,
    grade: qr.grade,
    passed: qr.passed,
    summary: qr.summary,
    dimensions,
    flaggedCount,
  };
}

/** 分数 → 色阶（与整体配色一致，红=差 绿=好，符合中文网文惯例） */
export function scoreColor(score: number): string {
  if (score >= 85) return "var(--nv-success, #22C55E)";
  if (score >= 70) return "var(--nv-primary, #F97316)";
  if (score >= 60) return "#FACC15";
  return "var(--nv-danger, #EF4444)";
}
