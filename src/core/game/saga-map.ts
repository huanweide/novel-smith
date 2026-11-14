/**
 * 游戏本地图 —— 把"谁在哪"画成一张可核对的格子表
 *
 * 移植自 novel-forge 的世界地图，但**数据源换成本项目已有的东西**：
 *   地点：世界书 category=geography（与意图盘同源，口径必须一致）
 *   人物位置：`saga.characterSheets[name].status.location`（人物档案里就有这一栏）
 *   关系：`saga.relations`（{ 角色名: { level, reason } }，负数=敌意）
 *
 * 三条硬判据（原样保留，因为它们是用真 bug 换来的）：
 *   1. **位置必须由数据唯一决定**：同一份档案每次打开都在同一格，能对着念、能核对。
 *      所以走格子表，不做力导向——力导向每次位置都不同，玩家记不住，也没法核对。
 *   2. **画线必须先掌握坐标**：人物在格内用固定槽位排（下标的排列组合），
 *      把点交给 flex 布局再连线，线一定错位。
 *   3. **没有位置就不画在图上**：不知道某人在哪，就进「行踪不明」，
 *      不推测、不硬塞进某个格子——猜错比留白更伤。
 *
 * 纯函数、零 IO、零 LLM。
 */

export interface MapPerson {
  name: string;
  /** 主角自己：实心标记，永远排第一 */
  isPlayer?: boolean;
  /** 与主角的关系值（saga.relations），没有就不给颜色 */
  level?: number;
}

export interface MapCell {
  /** A1 / B2 —— 玩家能念出来的坐标 */
  label: string;
  place: string;
  people: MapPerson[];
  /** 当前所在地 */
  isCurrent: boolean;
  /** 还有几个人没画下（格子放不下时报数，不静默丢人） */
  overflow: number;
}

export interface MapRelation {
  name: string;
  level: number;
  label: string;
}

export interface SagaMap {
  cols: number;
  rows: number;
  /** row-major，长度 = cols × rows；空格子为 null */
  cells: Array<MapCell | null>;
  /** 档案里没有位置的人 */
  unplaced: MapPerson[];
  relations: MapRelation[];
  stats: { places: number; people: number; placed: number; unplaced: number };
}

/** 每格最多显示几个人（再多就压成一行小字，看不清等于没画） */
export const MAP_PER_CELL = 4;

/**
 * 关系值 → 人话。数字玩家记不住，也不该记。
 * 分档依据：|level| < 20 基本是泛泛之交；≥50 才算"说得上话"；≥80 是过命的交情或死仇。
 */
export function relationLabel(level: number): string {
  if (level >= 80) return "生死之交";
  if (level >= 50) return "亲厚";
  if (level >= 20) return "相熟";
  if (level > -20) return "泛泛";
  if (level > -50) return "有隙";
  if (level > -80) return "仇怨";
  return "不共戴天";
}

/** A1、B2……列在前、行在后，和表格读法一致 */
export function cellLabel(col: number, row: number): string {
  return `${String.fromCharCode(65 + col)}${row + 1}`;
}

function placeKey(s: string): string {
  return (s || "").trim();
}

/**
 * 排序：当前所在 → 人多 → 人少 → 空。
 * 为什么不按世界书顺序：地图是给人"现在该看哪"的，
 * 空格子在最后垫底，才不会让一屏全是没人的地方。
 */
function orderCells(cells: Array<{ place: string; people: MapPerson[]; isCurrent: boolean }>): typeof cells {
  return [...cells].sort((a, b) => {
    if (a.isCurrent !== b.isCurrent) return a.isCurrent ? -1 : 1;
    if (a.people.length !== b.people.length) return b.people.length - a.people.length;
    return 0;
  });
}

export function buildSagaMap(input: {
  /** 已知地点（世界书 geography + knownLocations，已去重） */
  places: string[];
  /** 当前所在（可能为空——没写清就不标） */
  currentPlace?: string;
  /** 主角名（可空） */
  playerName?: string;
  /** 人物档案里的人：名字 + 位置 */
  people?: Array<{ name: string; place?: string; level?: number }>;
  /** 与主角的关系表 */
  relations?: Record<string, { level?: number; reason?: string }>;
  /** 最多几列：右栏窄，默认 2 */
  maxCols?: number;
  /** 最多几个格子 */
  maxCells?: number;
}): SagaMap {
  const maxCols = Math.max(1, Math.min(input.maxCols ?? 2, 4));
  const maxCells = Math.max(1, input.maxCells ?? 6);

  const relationMap = input.relations || {};
  const playerName = (input.playerName || "").trim();
  const current = placeKey(input.currentPlace || "");

  // 人物：主角单独标记；位置按档案
  const people: MapPerson[] = [];
  const byPlace = new Map<string, MapPerson[]>();
  const unplaced: MapPerson[] = [];

  for (const p of input.people || []) {
    const name = (p.name || "").trim();
    if (!name) continue;
    const isPlayer = !!playerName && name === playerName;
    const level = typeof p.level === "number" ? p.level : relationMap[name]?.level;
    const person: MapPerson = { name, isPlayer, level };

    const place = placeKey(p.place || "");
    // 人物档案写了位置就信它——世界书的地名表常常不全，
    // 反过来把"知道在哪的人"丢进行踪不明，是更糟的谎。
    if (place) {
      const list = byPlace.get(place) || [];
      list.push(person);
      byPlace.set(place, list);
    } else {
      unplaced.push(person);
    }
    people.push(person);
  }

  // 地点集合：已知地点 ∪ 有人待着的地点（档案里写了、但世界书没登记的地方也要出现）
  const placeList = Array.from(new Set([...input.places.map(placeKey), ...Array.from(byPlace.keys())]))
    .filter(Boolean)
    .slice(0, maxCells);

  // 当前地点若不在表内，补进去（否则"我在哪"看不见）
  if (current && !placeList.includes(current) && placeList.length < maxCells) {
    if (input.places.includes(current) || byPlace.has(current)) placeList.unshift(current);
  }

  const ordered = orderCells(
    placeList.map((place) => ({
      place,
      people: (byPlace.get(place) || []).sort((a, b) => {
        if (!!a.isPlayer !== !!b.isPlayer) return a.isPlayer ? -1 : 1;
        return Math.abs(b.level ?? 0) - Math.abs(a.level ?? 0);
      }),
      isCurrent: place === current,
    }))
  );

  const cols = Math.max(1, Math.min(maxCols, Math.ceil(Math.sqrt(Math.max(ordered.length, 1)))));
  const rows = Math.max(1, Math.ceil(ordered.length / cols));

  const cells: Array<MapCell | null> = new Array(cols * rows).fill(null);
  ordered.forEach((c, i) => {
    const shown = c.people.slice(0, MAP_PER_CELL);
    cells[i] = {
      label: cellLabel(i % cols, Math.floor(i / cols)),
      place: c.place,
      people: shown,
      isCurrent: c.isCurrent,
      overflow: Math.max(0, c.people.length - shown.length),
    };
  });

  // 关系清单：只列有明确数值的，按 |level| 从重到轻
  const relations: MapRelation[] = Object.entries(relationMap)
    .map(([name, r]) => ({ name, level: typeof r?.level === "number" ? r.level : 0 }))
    .filter((r) => r.name && r.name !== playerName)
    .sort((a, b) => Math.abs(b.level) - Math.abs(a.level))
    .slice(0, 6)
    .map((r) => ({ ...r, label: relationLabel(r.level) }));

  return {
    cols,
    rows,
    cells,
    unplaced,
    relations,
    stats: {
      places: ordered.length,
      people: people.length,
      placed: people.length - unplaced.length,
      unplaced: unplaced.length,
    },
  };
}
