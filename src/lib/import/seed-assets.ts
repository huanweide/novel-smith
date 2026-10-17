/**
 * 导入小说 · 前史资产落库（M3）
 *
 * 把 extract-assets 的规则提炼结果写进项目三卡。
 *
 * ## 铁律：全部落成待审草稿
 * 所有写入的卡一律 `reviewStatus = "pending"`。
 * approved-cards.ts 是所有生成端取用角色卡/世界书的唯一入口，硬过滤 approved，
 * 所以 pending 卡**不会**污染任何生成上下文——作者在角色页/世界书页
 * 逐个「采纳」后才生效。这是规则提炼唯一安全的落地方式。
 *
 * 伏笔 PendingCommitment 没有 reviewStatus 字段（它天生就是待兑现清单），
 * 但一律 `source = "import_inference"`，与用户手填的承诺区分开。
 *
 * ## 幂等
 * 同名角色卡 / 同名世界书条目直接跳过（不 update）——
 * 作者可能已经手工改过那张卡，导入提炼不该覆盖人工成果。
 */

import type { PrismaClient } from "@/generated/prisma/client";
import { prisma as defaultPrisma } from "@/lib/prisma";
import { resolveEntityCategory } from "@/lib/entity-auto-creator";
import type {
  CharacterCandidate,
  CommitmentCandidate,
  ExtractedAssets,
  LoreCandidate,
} from "./extract-assets";

export interface SeedAssetsInput {
  projectId: string;
  assets: ExtractedAssets;
  /** 关联的导入来源节点 id（写进角色卡 background 作为溯源） */
  importSourceKey?: string | null;
}

export interface SeedAssetsResult {
  charactersCreated: number;
  charactersSkipped: number;
  loreCreated: number;
  loreSkipped: number;
  commitmentsCreated: number;
  commitmentsSkipped: number;
  /** 角色卡草稿 id → 名称，供前端做「一键全采纳」 */
  characterIds: Array<{ id: string; name: string; confidence: number }>;
  loreIds: Array<{ id: string; title: string; confidence: number }>;
  digestsUpdated: boolean;
}

/** 伏笔去重键：同 description 已存在则跳过 */
async function existingCommitmentKeys(
  db: PrismaClient,
  projectId: string,
): Promise<Set<string>> {
  const rows = await db.pendingCommitment.findMany({
    where: { projectId },
    select: { description: true },
  });
  return new Set(rows.map((r) => r.description.trim()));
}

/**
 * 把提炼结果落成三卡草稿。
 * 整个过程包在一个事务里：提炼失败不该留下半套卡。
 */
export async function seedAssets(
  input: SeedAssetsInput,
  db: PrismaClient = defaultPrisma,
): Promise<SeedAssetsResult> {
  const { projectId, assets, importSourceKey } = input;

  const result: SeedAssetsResult = {
    charactersCreated: 0,
    charactersSkipped: 0,
    loreCreated: 0,
    loreSkipped: 0,
    commitmentsCreated: 0,
    commitmentsSkipped: 0,
    characterIds: [],
    loreIds: [],
    digestsUpdated: false,
  };

  const project = await db.project.findUnique({
    where: { id: projectId },
    select: { id: true },
  });
  if (!project) throw new Error("项目不存在");

  return db.$transaction(async (tx) => {
    // ─── 1. 角色卡草稿 ───────────────────────────────────
    const charNameKey = (n: string) => n.trim();
    const existingChars = await tx.characterCard.findMany({
      where: { projectId },
      select: { id: true, name: true, aliases: true },
    });
    const existingCharNames = new Set<string>();
    for (const c of existingChars) {
      existingCharNames.add(charNameKey(c.name));
      const aliases = Array.isArray(c.aliases) ? (c.aliases as string[]) : [];
      for (const a of aliases) {
        if (typeof a === "string") existingCharNames.add(charNameKey(a));
      }
    }

    for (const cand of assets.characters) {
      if (existingCharNames.has(charNameKey(cand.name))) {
        result.charactersSkipped += 1;
        continue;
      }
      const row = await tx.characterCard.create({
        data: {
          projectId,
          name: cand.name,
          aliases: [],
          // 规则提炼判断不了主角/反派——频次最高的那个最有可能是主角，
          // 但也只是「可能」。一律先落 supporting，由作者改。
          role: "supporting",
          background: buildCharacterBackground(cand, importSourceKey),
          tags: buildCharacterTags(cand),
          currentStatus: "alive",
          reviewStatus: "pending",
        },
        select: { id: true },
      });
      existingCharNames.add(charNameKey(cand.name));
      result.charactersCreated += 1;
      result.characterIds.push({ id: row.id, name: cand.name, confidence: cand.confidence });
    }

    // ─── 2. 世界书草稿 ───────────────────────────────────
    const existingLore = await tx.lorebookEntry.findMany({
      where: { projectId },
      select: { id: true, title: true },
    });
    const existingLoreTitles = new Set(existingLore.map((l) => l.title.trim()));

    for (const cand of assets.lore) {
      if (existingLoreTitles.has(cand.name.trim())) {
        result.loreSkipped += 1;
        continue;
      }
      const category = safeCategory(cand);
      const row = await tx.lorebookEntry.create({
        data: {
          projectId,
          title: cand.name,
          category,
          keys: [cand.name],
          content: cand.content,
          insertionOrder: 50,
          // 深度 3 = 关键词触发。导入提炼的条目还没确认，
          // 不该靠 depth<=2 强制常驻注入正文。
          depth: 3,
          enabled: true,
          reviewStatus: "pending",
        },
        select: { id: true },
      });
      existingLoreTitles.add(cand.name.trim());
      result.loreCreated += 1;
      result.loreIds.push({ id: row.id, title: cand.name, confidence: cand.confidence });
    }

    // ─── 3. 伏笔草稿 ─────────────────────────────────────
    if (assets.commitments.length > 0) {
      const seen = await existingCommitmentKeys(tx as unknown as PrismaClient, projectId);
      for (const cand of assets.commitments) {
        const desc = cand.description.trim();
        if (!desc || seen.has(desc)) {
          result.commitmentsSkipped += 1;
          continue;
        }
        await tx.pendingCommitment.create({
          data: {
            projectId,
            source: "import_inference",
            priority: cand.priority,
            description: desc,
            entityIds: [],
            closureConditions: [],
            status: "pending",
            fulfillmentRatio: 0,
            statusHistory: [
              {
                at: new Date().toISOString(),
                from: null,
                to: "pending",
                by: "import_m3",
              },
            ],
            developmentHint: `由导入原文第 ${cand.chapter} 章自动识别（置信度 ${cand.confidence.toFixed(2)}），请确认是否为真伏笔。`,
          },
        });
        seen.add(desc);
        result.commitmentsCreated += 1;
      }
    }

    // ─── 4. 聚合摘要（长期记忆）─────────────────────────
    // 只在项目摘要为空时写入：已人工填过的 synopsis/timelineDigest 不覆盖。
    const digestUpdate: Record<string, string> = {};
    if (assets.timelineDigest.trim()) digestUpdate.timelineDigest = assets.timelineDigest;
    if (assets.storylineDigest.trim()) digestUpdate.storylineDigest = assets.storylineDigest;
    if (Object.keys(digestUpdate).length > 0) {
      const cur = await tx.project.findUnique({
        where: { id: projectId },
        select: { timelineDigest: true, storylineDigest: true },
      });
      const patch: Record<string, string> = {};
      if (digestUpdate.timelineDigest && !cur?.timelineDigest?.trim()) {
        patch.timelineDigest = digestUpdate.timelineDigest;
      }
      if (digestUpdate.storylineDigest && !cur?.storylineDigest?.trim()) {
        patch.storylineDigest = digestUpdate.storylineDigest;
      }
      if (Object.keys(patch).length > 0) {
        await tx.project.update({ where: { id: projectId }, data: patch });
        result.digestsUpdated = true;
      }
    }

    return result;
  });
}

/** 角色卡 background：只写客观事实 + 溯源，不编人物设定 */
function buildCharacterBackground(
  cand: CharacterCandidate,
  importSourceKey?: string | null,
): string {
  const evLabel: Record<string, string> = {
    speech: "对话标签",
    honorific: "称谓",
    surname: "姓氏频次",
  };
  const ev = cand.evidence.map((e) => evLabel[e] ?? e).join("、");
  const src = importSourceKey ? `（来源：导入 ${importSourceKey}）` : "";
  return (
    `导入原文自动识别${src}：证据=${ev || "无"}，采样范围内出现约 ${cand.mentions} 次，` +
    `首次出现在第 ${cand.firstChapter} 章。` +
    `外貌/性格/动机/关系均未提炼，需人工补充或用 AI 填表补齐。`
  );
}

function buildCharacterTags(cand: CharacterCandidate): string[] {
  const tags = ["导入提炼"];
  for (const e of cand.evidence) tags.push(`证据:${e}`);
  return tags;
}

/** entity-detector 类型 → 世界书分类；未知类型安全回落到 custom */
function safeCategory(cand: LoreCandidate): string {
  try {
    return resolveEntityCategory(cand.type, cand.name);
  } catch {
    return "custom";
  }
}
