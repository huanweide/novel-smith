// 项目卫生：识别「历史测试/E2E 残留的空壳项目」。
//
// 背景（2026-09-10 实测）：本机 8 个项目里 7 个零章节、6 个名字就是测试代号
// （P2003-DEFENSE-V350 / FT-VERIFY-V350 / FREETALK-TEST / EXPLORE-FIX-TEST×2 …），
// 成因是历史即写即弃的验证脚本只在成功路径结尾删临时项目，一中断就永久留下。
// 本模块只做「识别」，绝不做自动删除——删除必须由用户在 UI 里逐条确认，
// 且走既有软删（DELETE /api/projects/[id] 只写 deletedAt），可从回收站恢复。

export interface HygieneProject {
  id: string;
  name: string;
  /** 章节节点数（首页 ProjectSummary 里是 _count.storyNodes） */
  nodeCount: number;
  updatedAt?: string | null;
}

export interface ResidueCandidate extends HygieneProject {
  reason: string;
  idleDays: number;
}

/** 测试残留的名称特征（均要求同时满足「零章节」才判定） */
const TEST_NAME_PATTERNS: RegExp[] = [
  /^E2E-TEMP-/i,
  /TEST/i,
  /VERIFY/i,
  /DEFENSE/i,
  /FREETALK/i,
  /自检/i,
  /临时/i,
  /调试/i,
  /SMOKE/i,
];

/** 有正文的项目一律不判为残留——这是最硬的保命线，宁可漏判不可误删 */
export function isTestResidue(p: Pick<HygieneProject, "name" | "nodeCount">): boolean {
  if (!p) return false;
  if ((p.nodeCount ?? 0) > 0) return false;
  const name = p.name ?? "";
  return TEST_NAME_PATTERNS.some((re) => re.test(name));
}

/** 距今闲置天数（updatedAt 缺失或非法记 0） */
export function idleDays(updatedAt?: string | null, now: number = Date.now()): number {
  if (!updatedAt) return 0;
  const t = Date.parse(updatedAt);
  if (!Number.isFinite(t)) return 0;
  const d = Math.floor((now - t) / 86_400_000);
  return d > 0 ? d : 0;
}

/** 从项目列表里挑出疑似测试残留（返回带理由的候选，交给用户勾选） */
export function pickResidueCandidates(
  projects: HygieneProject[],
  now: number = Date.now(),
): ResidueCandidate[] {
  if (!Array.isArray(projects)) return [];
  return projects
    .filter((p) => p && p.id && isTestResidue(p))
    .map((p) => {
      const days = idleDays(p.updatedAt, now);
      return {
        ...p,
        idleDays: days,
        reason: `零章节 · 名称像测试${days > 0 ? ` · ${days} 天未更新` : ""}`,
      };
    });
}
