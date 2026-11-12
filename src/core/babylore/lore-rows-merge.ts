/**
 * LoreTable.rows 三路合并 —— 修「整列覆盖导致并发丢行」。
 *
 * 背景（逐字符锚点）：
 *  - `prisma/schema.prisma:837` `rows Json`：整列存储、无 version 字段、无乐观锁。
 *  - `fill.ts:617` 把 rows 读进内存数组，`:739` `prisma.loreTable.update({ data: { rows } })` 整列写回。
 *  - 两个填表任务（后台 FillTask 与 auto-confirm）并发时，都从同一旧快照出发，后写者会抹掉先写者新增的行。
 *
 * 做法：写回前重读数据库最新 rows，把「本次相对起始快照的差异」应用到最新状态上，
 * 而不是拿本地结果整列覆盖。纯函数、零副作用、可判别测试。
 *
 * @param base     本次操作开始前读到的 rows（起始快照）
 * @param incoming 本次操作完成后的 rows（本地结果）
 * @param fresh    写回前从数据库重读到的最新 rows
 * @param idCol    身份列名（rows 无 row_id 时用它做归并键）
 */
export function mergeLoreRows(
  base: any[],
  incoming: any[],
  fresh: any[],
  idCol: string,
): any[] {
  const keyOf = (r: any): string => {
    if (r == null) return "";
    // 身份列优先：applyOps 的 insert/update 去重本就以身份列大小写不敏感匹配为业务主键。
    // 不能用 row_id —— 并发两个写者都从 maxId+1 起编号，会撞号，用 row_id 归并反而把并发新增行互相覆盖。
    const idVal = String(r[idCol] ?? "").trim().toLowerCase();
    if (idVal) return `@${idVal}`;
    return r.row_id != null ? `#${String(r.row_id)}` : "";
  };

  const baseMap = new Map<string, any>((base || []).map((r) => [keyOf(r), r]));
  const incomingMap = new Map<string, any>((incoming || []).map((r) => [keyOf(r), r]));
  const freshMap = new Map<string, any>((fresh || []).map((r) => [keyOf(r), r]));

  // 1) 本次新增 / 更新：以 incoming 为准，写进 fresh（若 fresh 已有同键则覆盖）
  for (const [k, row] of incomingMap) {
    freshMap.set(k, row);
  }

  // 2) 本次删除：base 里有、incoming 里没有 → 从 fresh 移除（尊重本次的删除意图）
  for (const k of baseMap.keys()) {
    if (!incomingMap.has(k)) freshMap.delete(k);
  }

  // 3) 保持 fresh 中「别人新增、与本次无关」的行 —— 它们本来就在 freshMap 里，无需额外处理
  // 顺序：先按 fresh 原顺序输出仍在的键，再追加本次新增的键，保证稳定可预期
  const out: any[] = [];
  const emitted = new Set<string>();
  for (const r of fresh || []) {
    const k = keyOf(r);
    if (freshMap.has(k) && !emitted.has(k)) {
      out.push(freshMap.get(k));
      emitted.add(k);
    }
  }
  for (const [k, row] of incomingMap) {
    if (!emitted.has(k)) {
      out.push(row);
      emitted.add(k);
    }
  }
  return out;
}
