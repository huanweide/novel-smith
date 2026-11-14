/**
 * 服务端场景加载 —— 意图盘接口与行动判定共用同一份"处境"
 *
 * 为什么要共用：界面说"能送"，后端判定说"你身上没有"，是最伤信任的一类矛盾。
 * 两条链路只要各算一次，就一定会漂。这里只留一个入口。
 *
 * 失败策略：任何异常都返回一个"判不出"的空场景（basis="none"），
 * 上层据此放行——判定层不能成为新的故障点。
 */

import { prisma } from "@/lib/prisma";
import { buildScene, isGenericName, namesOf, type SceneBundle, type SceneThread } from "@/core/game/scene";
import { buildSagaMap, type SagaMap } from "@/core/game/saga-map";
import { parseExtensions } from "@/core/game/session-extensions";
import type { NarrativeMode } from "@/core/game/jev";

export interface LoadedScene {
  scene: SceneBundle;
  map: SagaMap;
  mode: NarrativeMode;
  playerName: string | null;
}

/** 已知地点可能是 string[] / {name}[] / { 名字: ... } 映射，三种都吃 */
export function placeNames(raw: unknown): string[] {
  if (Array.isArray(raw)) return namesOf(raw);
  if (raw && typeof raw === "object") return Object.keys(raw as Record<string, unknown>);
  return [];
}

const EMPTY: LoadedScene = {
  scene: { present: [], knownElsewhere: [], items: [], places: [], threads: [], basis: "none" },
  map: {
    cols: 1,
    rows: 1,
    cells: [null],
    unplaced: [],
    relations: [],
    stats: { places: 0, people: 0, placed: 0, unplaced: 0 },
  },
  mode: "first",
  playerName: null,
};

export async function loadScene(sessionId: string): Promise<LoadedScene> {
  if (!sessionId) return EMPTY;
  try {
    const session = await prisma.gameSession.findUnique({
      where: { id: sessionId },
      select: {
        id: true,
        projectId: true,
        extensions: true,
        saga: {
          select: {
            projectId: true,
            narrativeMode: true,
            playAsName: true,
            gameTime: true,
            knownLocations: true,
            characterSheets: true,
            sourceSnapshot: true,
            relations: true,
          },
        },
      },
    });
    if (!session) return EMPTY;

    // 最近八轮：人名未必每轮重提（回看一手），地点更是常常连续几轮不提（回溯取最后一次）
    const states = await prisma.gameState.findMany({
      where: { sessionId },
      orderBy: { round: "desc" },
      take: 8,
      select: { narrative: true, entities: true, items: true, playerAction: true },
    });
    const latest = states[0];
    const prev = states[1];

    const saga = session.saga;
    const ext = parseExtensions(session.extensions);

    // 人名库 / 地名库：模型不肯吐 NE| 时，这是唯一可靠的来源。
    // 人物卡与世界书（category=geography）都是玩家自己写下的世界，用它们不叫"编"。
    const projectId = session.projectId || saga?.projectId || null;
    let cardNames: string[] = [];
    let lorePlaces: string[] = [];
    if (projectId) {
      try {
        const [cards, lore] = await Promise.all([
          prisma.characterCard.findMany({ where: { projectId }, select: { name: true }, take: 40 }),
          prisma.lorebookEntry.findMany({
            where: { projectId, category: "geography" },
            select: { title: true },
            take: 40,
          }),
        ]);
        cardNames = namesOf(cards);
        lorePlaces = namesOf(lore.map((l) => ({ name: l.title })));
      } catch {
        // 查不到就当没有——不能因为素材缺失让整局点不动
      }
    }

    const sheetNames =
      saga?.characterSheets && typeof saga.characterSheets === "object"
        ? Object.keys(saga.characterSheets as Record<string, unknown>)
        : [];
    let snapNames: string[] = [];
    try {
      const snap = saga?.sourceSnapshot ? JSON.parse(saga.sourceSnapshot) : null;
      snapNames = namesOf(snap?.characters);
    } catch {
      snapNames = [];
    }

    const threads: SceneThread[] = [
      ...ext.causality.filter((s) => !s.triggered).map((s) => ({ text: s.description || s.subject, subject: s.subject, risk: true })),
      ...ext.goals.filter((g) => !g.done).map((g) => ({ text: g.text, risk: false })),
    ];

    const knownPlaces = Array.from(new Set([...placeNames(saga?.knownLocations), ...lorePlaces]));

    // 地点回溯：从最近一轮往前找，谁最后被提到就是"我现在在哪"。
    // 玩家的行动文本优先于正文——"前往林氏旧宅"比叙述里的一句描写更明确。
    let placeHint = "";
    for (const st of states) {
      const act = st.playerAction || "";
      const actHit = knownPlaces.find((p) => p && act.includes(p));
      if (actHit) {
        placeHint = actHit;
        break;
      }
      const nar = st.narrative || "";
      const narHit = knownPlaces.find((p) => p && nar.includes(p));
      if (narHit) {
        placeHint = narHit;
        break;
      }
    }

    const scene = buildScene({
      narrative: latest?.narrative || "",
      prevNarrative: prev?.narrative || "",
      actionText: latest?.playerAction || "",
      entities: latest?.entities,
      items: latest?.items,
      characterNames: [...sheetNames, ...snapNames, ...cardNames],
      knownPlaces,
      placeHint: placeHint || undefined,
      threads,
      time: saga?.gameTime || undefined,
      playerName: saga?.playAsName || "",
    });

    // ── 地图：位置来自人物档案（status.location），关系来自 saga.relations ──
    // 两个兜底，都能说出依据，不是猜：
    //   · 正文里在场的人 → 就在"当前地点"（他这一场戏就在这儿）；
    //   · 档案里没记位置、正文里也没出现 → 行踪不明，不硬塞。
    const sheets =
      saga?.characterSheets && typeof saga.characterSheets === "object"
        ? (saga.characterSheets as Record<string, { status?: { location?: string } }>)
        : {};
    const relations =
      saga?.relations && typeof saga.relations === "object"
        ? (saga.relations as Record<string, { level?: number; reason?: string }>)
        : {};

    const presentSet = new Set(scene.present);
    const here = scene.place || "";

    const peopleFromSheets = Object.entries(sheets)
      .filter(([name]) => !isGenericName(name))
      .map(([name, sheet]) => {
        const recorded = typeof sheet?.status?.location === "string" ? sheet.status.location.trim() : "";
        return {
          name,
          place: recorded || (presentSet.has(name) ? here : ""),
          level: typeof relations[name]?.level === "number" ? relations[name].level : undefined,
        };
      });
    const sheetNameSet = new Set(peopleFromSheets.map((p) => p.name));
    const peopleFromCards = cardNames
      .filter((n) => !sheetNameSet.has(n) && !isGenericName(n))
      .map((name) => ({ name, place: presentSet.has(name) ? here : "" }));

    const map = buildSagaMap({
      places: scene.places.map((p) => p.name), // 已去重、保持世界书原序
      currentPlace: scene.place,
      playerName: saga?.playAsName || "",
      people: [...peopleFromSheets, ...peopleFromCards],
      relations,
      maxCols: 2,
      maxCells: 6,
    });

    return {
      scene,
      map,
      mode: ((saga?.narrativeMode || "first") as NarrativeMode) || "first",
      playerName: saga?.playAsName || null,
    };
  } catch {
    return EMPTY;
  }
}
