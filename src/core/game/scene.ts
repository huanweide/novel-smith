/**
 * 场景（Scene）—— "此刻谁在、身上有什么、能去哪"，从已有数据算出来，不问模型
 *
 * 为什么需要它：
 *   判断一件事做不做得到，必须先知道处境。但项目里没有地图、没有坐标、
 *   `knownLocations` 与 `characterSheets.status.location` 实际都是空的。
 *   唯一可靠的"谁在场"证据，是**上一段正文里出现了谁的名字**——人名真的被写进了正文，
 *   才说明这个人在这一场戏里。这不是推测，是取证。
 *
 * 三条判据：
 *   1. **拿不到就说不知道**。present 为空且 basis="none" 时，上层不许拦人——
 *      拦错比放过多更伤自由感（见 jev.ts）。
 *   2. **只认确定的名字**。人名库来自角色卡/实体表；正文里出现别的称呼（"那老者"）
 *      不猜，宁可少算一个在场的人。
 *   3. **扫最近的文本，不扫全书**。取末尾 4000 字，长度封顶，避免长章节拖慢每次判断。
 *
 * 纯函数，零 IO、零 LLM。
 */

export interface ScenePlace {
  name: string;
  /** 到那里大概要多久（小时）；没有依据就不给，别编 */
  hours?: number;
}

export interface SceneThread {
  text: string;
  /** 这件事挂在谁/哪个势力身上（有就用它当牌面，比整句话好读） */
  subject?: string;
  risk?: boolean;
}

export interface SceneBundle {
  time?: string;
  /** 当前所在（只在地点名出现在最近正文时给） */
  place?: string;
  /** 这一场里确实在场的人（不含玩家自己） */
  present: string[];
  /**
   * 认识但不在场的人（角色卡/人物档案里有，最近正文没出现）。
   * 用途是给"去找他"这张牌——否则玩家想见某人只能撞墙。
   * 不给位置：我们不知道他在哪，所以也不判断远近。
   */
  knownElsewhere: string[];
  /** 身上的东西 */
  items: string[];
  /** 知道的地名（可以去） */
  places: ScenePlace[];
  /** 手头没了结的事（因果/目标） */
  threads: SceneThread[];
  /** 在场判定的依据：narrative=正文命中 / entities=实体表 / none=判不出 */
  basis: "narrative" | "entities" | "none";
}

const SCAN_CHARS = 4000;
const MAX_PRESENT = 6;
const MAX_ITEMS = 8;
const MAX_PLACES = 6;
const MAX_THREADS = 4;

/** 占位名：这些不是具体的人，不该出现在「在场」或「去找」里 */
const GENERIC_NAMES = new Set([
  "主角", "玩家", "我", "你", "他", "她", "它", "某人", "众人", "路人", "路人甲", "旁白", "无名氏",
]);

/** 给外部（地图、名单）复用：这个名字是不是"还没填好的占位" */
export function isGenericName(name: string): boolean {
  return GENERIC_NAMES.has((name || "").trim());
}

/** 容错取名：接受 string[] / {name}[] / 脏数据，永远不抛 */
export function namesOf(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  const out: string[] = [];
  for (const it of list) {
    if (typeof it === "string") {
      const t = it.trim();
      if (t) out.push(t);
    } else if (it && typeof it === "object") {
      const n = (it as { name?: unknown }).name;
      if (typeof n === "string" && n.trim()) out.push(n.trim());
    }
  }
  return Array.from(new Set(out));
}

/** 正文里最后一次提到该名字的位置；没提过返回 -1 */
function lastMention(text: string, name: string): number {
  if (!text || !name) return -1;
  return text.lastIndexOf(name);
}

/**
 * 地名去重：世界书里同一条路常有多种写法
 * （「槐安路127号乙栋负一层」与「槐安路127号，乙栋，负一层」是同一个地方）。
 * 归一化只去掉分隔标点与空白，不做同义词合并——猜错了会把两个地方并成一个。
 * 同一处保留更短的那个写法，卡片上放得下。
 */
export function dedupePlaces(names: string[], cap = MAX_PLACES): ScenePlace[] {
  // 第一道：去标点后同名即同一处；保留首次出现的位置，取更短的写法。
  const order: string[] = [];
  const idxByKey = new Map<string, number>();
  for (const raw of names) {
    const name = (raw || "").trim();
    if (!name) continue;
    const key = name.replace(/[，,、·．.\s]/g, "");
    if (!key) continue;
    const at = idxByKey.get(key);
    if (at === undefined) {
      idxByKey.set(key, order.length);
      order.push(name);
    } else if (name.length < order[at].length) {
      order[at] = name;
    }
  }

  // 第二道：详略合并。
  // 「老纺织厂」与「老纺织厂厂区」是同一处的详略两版，不该占两张牌；
  // 但「林氏旧宅」与「林氏旧宅东厢房」是两处，不能并。
  // 分界不看长度，看多出来的尾巴是不是**通用区域词**——只有这类才真是同一个地方。
  // 注意保持原序（世界书里的书写顺序），不按长度重排：玩家先写的地方排前面。
  const GENERIC_TAIL = /^(厂区|旧址|附近|一带|门口|周边|片区|区域|大楼|大院|广场|街区)$/;
  const kept = order.filter(
    (name) =>
      !order.some(
        (k) => k !== name && name.startsWith(k) && k.length >= 4 && GENERIC_TAIL.test(name.slice(k.length))
      )
  );

  return kept.slice(0, cap).map((name) => ({ name }));
}

export interface SceneInput {
  /** 最近一轮正文 */
  narrative?: string;
  /** 再往前一轮（人名未必重复出现，回看一手能少漏） */
  prevNarrative?: string;
  /** 本轮玩家写的话（也算"提到"） */
  actionText?: string;
  /** 实体表（模型吐 NE| 时才非空） */
  entities?: unknown;
  /** 背包 */
  items?: unknown;
  /** 人名库：角色卡 / 人物档案 / 前传快照 */
  characterNames?: string[];
  /** 已知地点名 */
  knownPlaces?: string[];
  /**
   * 地点提示：由调用方回溯最近若干轮算出。
   * 为什么需要它——正文不会每轮都重提地名，只扫最近两轮会让"我在哪"忽然变回不详。
   */
  placeHint?: string;
  /** 未了的事 */
  threads?: SceneThread[];
  /** 游戏内时间 */
  time?: string;
  /** 玩家自己（不出现在"在场"里） */
  playerName?: string;
}

/**
 * 从已有数据里恢复一个场景。
 * 注意：present 为空有两种含义——"确实没人"与"判不出"，靠 basis 区分。
 */
export function buildScene(input: SceneInput): SceneBundle {
  const recent = [input.prevNarrative || "", input.narrative || "", input.actionText || ""]
    .join("\n")
    .slice(-SCAN_CHARS);

  const playerName = (input.playerName || "").trim();

  // 人名库：角色卡优先，实体表补充（模型肯吐 NE 的时候更准）
  const entityNames = (Array.isArray(input.entities) ? input.entities : [])
    .filter((e: any) => e && typeof e === "object")
    .filter((e: any) => {
      const t = String(e.type || "").toLowerCase();
      return t === "character" || t === "creature" || t === "npc" || t === "";
    })
    .map((e: any) => String(e.name || "").trim())
    .filter(Boolean);

  const candidates = Array.from(
    new Set([...(input.characterNames || []), ...entityNames].map((n) => n.trim()).filter(Boolean))
  )
    // 占位名不是人：「主角」「玩家」「某人」出现在牌上会像系统还没填好的样本
    .filter((n) => !GENERIC_NAMES.has(n));

  const present = candidates
    .filter((n) => n !== playerName && n.length >= 2)
    .filter((n) => lastMention(recent, n) >= 0)
    // 越靠后提到越可能还在场；同分按长度（长的更具体）
    .sort((a, b) => lastMention(recent, b) - lastMention(recent, a) || b.length - a.length)
    .slice(0, MAX_PRESENT);

  const places = dedupePlaces(namesOf(input.knownPlaces));

  // 当前地点：调用方回溯出的提示优先；否则取最近正文里最后被提到的那个
  let place: string | undefined = input.placeHint?.trim() || undefined;
  if (!place) {
    let bestAt = -1;
    for (const p of places) {
      const at = lastMention(recent, p.name);
      if (at > bestAt) {
        bestAt = at;
        place = p.name;
      }
    }
    if (bestAt < 0) place = undefined;
  }

  const items = namesOf(input.items).slice(0, MAX_ITEMS);

  const knownElsewhere = candidates
    .filter((n) => n !== playerName && n.length >= 2 && !present.includes(n))
    .slice(0, 3);

  const threads = (Array.isArray(input.threads) ? input.threads : [])
    .filter((t) => t && typeof t.text === "string" && t.text.trim())
    .slice(0, MAX_THREADS);

  const basis: SceneBundle["basis"] =
    present.length > 0 ? (entityNames.some((n) => present.includes(n)) ? "entities" : "narrative") : "none";

  return {
    time: input.time?.trim() || undefined,
    place,
    present,
    knownElsewhere,
    items,
    places,
    threads,
    basis,
  };
}

/** 给判定层用的最小快照（名字数组，不是对象） */
export function toSnapshot(scene: SceneBundle): {
  presentNames?: string[];
  items?: string[];
  reachable?: Array<{ name: string; hours?: number }>;
} {
  return {
    presentNames: scene.present.length > 0 ? scene.present : undefined,
    items: scene.items.length > 0 ? scene.items : undefined,
    reachable: scene.places.length > 0 ? scene.places : undefined,
  };
}

/** 一句话处境，给界面/提示词用；不夹解释 */
export function describeScene(scene: SceneBundle): string {
  const parts: string[] = [];
  if (scene.time) parts.push(scene.time);
  if (scene.place) parts.push(scene.place);
  if (scene.present.length) parts.push(`在场 ${scene.present.join("、")}`);
  if (scene.items.length) parts.push(`身上 ${scene.items.slice(0, 3).join("、")}`);
  return parts.join(" · ") || "处境不明";
}
