// ============================================================
// 去 AI 味 · 「一键套用」执行层（纯函数 / 零依赖 / 零网络）
// ============================================================
//
// 背景：规则引擎只会告诉你「这里像 AI 写的，建议删掉」，
//       但真正动手还得作者自己回编辑器选中、删除、再回来重跑一次。
//       一万字的稿子有几十处痕迹时，这个来回就是几十次摩擦，
//       绝大多数人在搬第七趟的时候就放弃了。
//
//       本文件把「机器自己有把握的那部分」变成一次点击：
//       拍板权仍然完全在作者手里（不点就不改），只是不用再手动搬运。
//
// 三条安全底线（与 types.ts 的设计原则严格一致）：
//  1. 被动执行 —— applyFixes 只有在被调用时才动字，没有调用就一个字都不改。
//                  绝不存在「检测到什么就顺手改掉」这种自动改写行为。
//  2. 只做有把握的 —— 只处理带 fix 的命中。需要作者判断留哪一半、怎么重写
//                  结构性句子的规则（不是…而是… / 三段排比 / 动作堆砌等）
//                  一律不带 fix，本文件碰都不会碰。
//  3. 位置不能错 —— 同时改多处时，如果从前往后替换，前面删掉几个字之后，
//                  后面所有片段的下标就全偏了，会改到完全无关的原文上去。
//                  这里统一从后往前改，前面的下标永远不受影响。

import type { AiTraceFix, AiTraceHit } from "./types";

/** 套用结果：除了新文本，还要告诉调用方改了几处、跳过了几处（用于界面提示） */
export interface ApplyFixResult {
  text: string;
  /** 实际写入了的处数 */
  applied: number;
  /** 因为和其他修复区块重叠而被跳过的处数（宁可不改，也不改坏） */
  skipped: number;
}

/**
 * 删词时要顺手吞掉的尾巴符号。
 *
 * 为什么不能只删词本身：
 *   「值得注意的是，他推门进来了」—— 只删「值得注意的是」会剩下「，他推门进来了」，
 *   句首挂一个孤零零的逗号，比原来的 AI 腔更难看。
 *   「她情不自禁地笑了」 —— 只删「情不自禁」会剩下「她地笑了」，直接病句。
 *
 * 下面这批符号只有在紧贴命中词时才会被吞掉，一遇到别的字符立刻收手，
 * 所以它们正常出现在别处时不会被误伤。
 */
const TAIL_SWALLOW = new Set(["，", ",", "、", "：", ":", "；", ";", "地", "说", "讲", " ", "　"]);

/** 最多往后吞几个字符：防止极端文本里一口气吞掉半句话 */
const MAX_TAIL_SWALLOW = 4;

/**
 * 计算「删除」这个动作真正要覆盖的区间。
 *
 * 下标这里有个容易踩的坑，写死在这儿以免后人再踩：
 *   段落级规则拿到的是「段文本 + 段首在全文里的偏移」，它内部下标 i 是**段内**下标，
 *   而 hit.start / hit.end 存的是**全文**下标（界面高亮要用）。
 *   所以要吞尾巴只能在段文本上顺着 localEnd 往后看，
 *   返回时再统一加回 offset 换算成全文下标。
 *
 * @param text 规则手上的那段文本（段落级就是单段，全文级就是整篇）
 * @param localStart 起点在该段文本内的下标
 * @param localEnd 终点在该段文本内的下标
 * @param offset 该段文本首字符在全文中的下标（全文级规则传 0）
 */
export function deletionFix(
  text: string,
  localStart: number,
  localEnd: number,
  offset = 0
): AiTraceFix {
  let e = localEnd;
  let swallowed = 0;
  while (e < text.length && swallowed < MAX_TAIL_SWALLOW && TAIL_SWALLOW.has(text[e])) {
    e++;
    swallowed++;
  }
  return { replacement: "", start: offset + localStart, end: offset + e, label: "删除" };
}

/**
 * 计算「替换」这个动作的方案（如「宛如」→「像」）。
 * 替换长度变化不会导致下标偏移恶化，因为同样是从后往前处理。
 */
export function replacementFix(to: string, label: string): AiTraceFix {
  return { replacement: to, label };
}

/** 取出某条命中实际要操作的区间：fix 可以自定义，缺省就是命中片段本身 */
function scopeOf(hit: AiTraceHit): [number, number] {
  const s = hit.fix?.start ?? hit.start;
  const e = hit.fix?.end ?? hit.end;
  return [s, e];
}

/**
 * 把一组命中的可机改修复应用到原文上。
 *
 * 注意细节：
 *  - 越界或空区间直接丢弃。宁可少改一处，也不能把下标算错改到无关内容。
 *  - 区间重叠时只改一处。同一段原文常被多条规则同时命中，
 *    两条修复叠着写会把原文改坏，所以后来的那条让位。
 *
 * @param hits 想套用的命中集合。单条套用时传长度为 1 的数组即可（调用方负责挑选）。
 */
export function applyFixes(text: string, hits: readonly AiTraceHit[]): ApplyFixResult {
  if (!text || hits.length === 0) return { text, applied: 0, skipped: 0 };
  const len = text.length;

  // 只认机器有把握的那些；其余规则结构上需要作者重写，本函数碰都不碰
  const candidates = hits
    .filter((h) => h.fix)
    .map((h) => ({ fix: h.fix as AiTraceFix, range: scopeOf(h) }))
    .filter(({ range }) => {
      const [s, e] = range;
      return Number.isFinite(s) && Number.isFinite(e) && s >= 0 && s < e && e <= len;
    });

  // 关键：从后往前排。改尾巴不会影响前面片段的下标。
  candidates.sort((a, b) => b.range[0] - a.range[0] || b.range[1] - a.range[1]);

  let out = text;
  const used: Array<[number, number]> = [];
  let applied = 0;
  let skipped = 0;

  for (const c of candidates) {
    const [s, e] = c.range;
    // 重叠检测：两条修复抢同一段原文时，只让先排到的（更靠后的）那条动手
    if (used.some(([us, ue]) => s < ue && us < e)) {
      skipped += 1;
      continue;
    }
    out = out.slice(0, s) + c.fix.replacement + out.slice(e);
    used.push([s, e]);
    applied += 1;
  }

  return { text: out, applied, skipped };
}

/** 这批命中里有几处是可以一键套用的（界面据此决定要不要显示「全部套用」） */
export function countFixable(hits: readonly AiTraceHit[]): number {
  let n = 0;
  for (const h of hits) if (h.fix) n += 1;
  return n;
}
