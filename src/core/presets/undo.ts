// 撤销预设注入：按 apply 留下的「可撤销凭证」精准回退。
// 顺序：先还原被覆盖的旧值（逆序，后覆盖的先还原），再删除本次新建的实体。
// 所有操作单条容错——某条已被手动删掉不阻断整体撤销，只记进 skipped 供 UI 提示。

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface PrismaUndoWriter {
  loreTable: {
    findUnique(args: any): Promise<any>;
    delete(args: any): Promise<any>;
  };
  styleCard: {
    findUnique(args: any): Promise<any>;
    delete(args: any): Promise<any>;
    update(args: any): Promise<any>;
  };
  lorebookEntry: {
    findUnique(args: any): Promise<any>;
    delete(args: any): Promise<any>;
    update(args: any): Promise<any>;
  };
  characterCard: {
    findUnique(args: any): Promise<any>;
    delete(args: any): Promise<any>;
  };
  project: {
    findUnique(args: any): Promise<any>;
    update(args: any): Promise<any>;
  };
}

export interface UndoResult {
  /** 已删除的新建实体（kind:name） */
  deleted: string[];
  /** 已还原的被覆盖项（kind:name） */
  restored: string[];
  /** 跳过项（记录不存在等，附带原因） */
  skipped: string[];
}

interface CrtItem {
  kind: string;
  id: string;
  name: string;
}
interface UpdItem {
  kind: string;
  id: string;
  name: string;
  before: unknown;
}

/**
 * 浅层深度相等：支持原始值 / 数组 / 普通对象（撤销场景里的 before 快照只含这些）。
 * 用于判断「当前值是否已经等于撤销目标值」，从而跳过无意义的重复还原。
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
  }
  if (a && b && typeof a === "object" && typeof b === "object") {
    const ka = Object.keys(a as Record<string, unknown>);
    const kb = Object.keys(b as Record<string, unknown>);
    if (ka.length !== kb.length) return false;
    return ka.every((k) =>
      deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
    );
  }
  return false;
}

/** current 是否已完全匹配 before 快照（before 为部分字段时按字段逐个比较） */
function alreadyMatches(current: any, before: any): boolean {
  if (!current || !before || typeof before !== "object") return false;
  return Object.keys(before).every((k) => deepEqual(current[k], before[k]));
}

export async function executeUndo(
  db: PrismaUndoWriter,
  projectId: string,
  record: Partial<{
    created: CrtItem[];
    updatedBefore: UpdItem[];
    ruleNames: string[];
    configKeys: string[];
  }> | null | undefined,
): Promise<UndoResult> {
  const deleted: string[] = [];
  const restored: string[] = [];
  const skipped: string[] = [];

  if (!record) return { deleted, restored, skipped: ["无撤销记录"] };

  const created: CrtItem[] = Array.isArray(record.created) ? record.created : [];
  const updatedBefore: UpdItem[] = Array.isArray(record.updatedBefore) ? record.updatedBefore : [];

  // ── 1) 还原被覆盖的旧值（逆序）。幂等：当前已等于 before 则跳过，避免重复还原。 ──
  for (let i = updatedBefore.length - 1; i >= 0; i -= 1) {
    const u = updatedBefore[i];
    try {
      if (u.kind === "style" && u.id && u.before) {
        const cur = await db.styleCard.findUnique({ where: { id: u.id } });
        if (!cur) { skipped.push(`style:${u.name}（实体已不存在，无法还原）`); continue; }
        if (alreadyMatches(cur, u.before)) continue; // 已还原，静默跳过
        await db.styleCard.update({ where: { id: u.id }, data: u.before });
        restored.push(`style:${u.name}`);
      } else if (u.kind === "lorebook" && u.id && u.before) {
        const cur = await db.lorebookEntry.findUnique({ where: { id: u.id } });
        if (!cur) { skipped.push(`lorebook:${u.name}（实体已不存在，无法还原）`); continue; }
        if (alreadyMatches(cur, u.before)) continue; // 已还原，静默跳过
        await db.lorebookEntry.update({ where: { id: u.id }, data: u.before });
        restored.push(`lorebook:${u.name}`);
      } else if (u.kind === "regex") {
        const project = await db.project.findUnique({ where: { id: projectId } });
        const rules = (Array.isArray(project?.postProcessingRules)
          ? [...(project!.postProcessingRules as Record<string, unknown>[])]
          : []);
        const idx = rules.findIndex((r) => r && r.name === String(u.name));
        if (idx >= 0) {
          const target = (u.before as Record<string, unknown>) ?? null;
          if (target && deepEqual(rules[idx], target)) continue; // 已还原，静默跳过
          if (target) rules[idx] = target;
          else rules.splice(idx, 1);
          await db.project.update({ where: { id: projectId }, data: { postProcessingRules: rules } });
          restored.push(`regex:${u.name}`);
        }
      } else if (u.kind === "api_config") {
        const before = (u.before || {}) as {
          values?: Record<string, unknown>;
          addedKeys?: string[];
        };
        const project = await db.project.findUnique({ where: { id: projectId } });
        const cfg: Record<string, unknown> = { ...((project?.llmConfig as Record<string, unknown>) || {}) };
        const target: Record<string, unknown> = { ...cfg };
        for (const k of before.addedKeys || []) delete target[k];
        for (const [k, v] of Object.entries(before.values || {})) target[k] = v;
        if (deepEqual(cfg, target)) continue; // 已还原，静默跳过
        await db.project.update({ where: { id: projectId }, data: { llmConfig: target } });
        restored.push("api_config:LLM参数");
      }
    } catch (e) {
      skipped.push(`${u.kind}:${u.name}（还原失败：${e instanceof Error ? e.message : String(e)}）`);
    }
  }

  // ── 2) 删除本次新建的实体 ──
  for (const c of created) {
    try {
      if (c.kind === "table") {
        await db.loreTable.delete({ where: { id: c.id } });
        deleted.push(`table:${c.name}`);
      } else if (c.kind === "style") {
        await db.styleCard.delete({ where: { id: c.id } });
        deleted.push(`style:${c.name}`);
      } else if (c.kind === "lorebook") {
        await db.lorebookEntry.delete({ where: { id: c.id } });
        deleted.push(`lorebook:${c.name}`);
      } else if (c.kind === "character") {
        await db.characterCard.delete({ where: { id: c.id } });
        deleted.push(`character:${c.name}`);
      } else if (c.kind === "regex") {
        const project = await db.project.findUnique({ where: { id: projectId } });
        const rules = (Array.isArray(project?.postProcessingRules)
          ? [...(project!.postProcessingRules as Record<string, unknown>[])]
          : []);
        const next = rules.filter((r) => !r || r.name !== String(c.name));
        if (next.length !== rules.length) {
          await db.project.update({ where: { id: projectId }, data: { postProcessingRules: next } });
          deleted.push(`regex:${c.name}`);
        }
      }
    } catch (e) {
      skipped.push(`${c.kind}:${c.name}（删除失败，可能已被手动删除）`);
    }
  }

  // ── 3) 向后兼容：老版 appliedPresets 记录只有 ruleNames / configKeys ──
  if (!created.length && !updatedBefore.length) {
    const ruleNames: string[] = Array.isArray(record.ruleNames) ? record.ruleNames : [];
    const configKeys: string[] = Array.isArray(record.configKeys) ? record.configKeys : [];
    if (ruleNames.length) {
      const project = await db.project.findUnique({ where: { id: projectId } });
      const rules = (Array.isArray(project?.postProcessingRules)
        ? [...(project!.postProcessingRules as Record<string, unknown>[])]
        : []);
      const set = new Set(ruleNames);
      const next = rules.filter((r) => !r || !set.has(String(r.name)));
      if (next.length !== rules.length) {
        await db.project.update({ where: { id: projectId }, data: { postProcessingRules: next } });
        deleted.push(...ruleNames.map((n) => `regex:${n}`));
      }
    }
    if (configKeys.length) {
      const project = await db.project.findUnique({ where: { id: projectId } });
      const cfg: Record<string, unknown> = { ...((project?.llmConfig as Record<string, unknown>) || {}) };
      for (const k of configKeys) delete cfg[k];
      await db.project.update({ where: { id: projectId }, data: { llmConfig: cfg } });
      deleted.push(...configKeys.map((k) => `api_config:${k}`));
    }
  }

  return { deleted, restored, skipped };
}
