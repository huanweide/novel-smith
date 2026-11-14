/**
 * POST /api/game/saga/[sagaId]/characters/autofill
 *
 * 游戏本·人物卡「一键填充」——从小说系统的角色自动补全抄来的思路，
 * 但存储指向游戏本自己的 saga.characterSheets（JSON 档案），不碰 CharacterCard 表。
 *
 * 干的事：
 *   1. 读这张卡已填的字段，找出空白项；
 *   2. 把「名字 + 已填信息 + 项目世界观/梗概」交给 LLM 补全；
 *   3. 合并回写 characterSheets[name]（已填的不覆盖，只补空白）。
 *
 * 响应：{ ok, filled: string[], sheet: CharacterSheet, message }
 *
 * 铁律：只补空白，绝不编造已填字段；不写任何「世界常识」（年龄/外貌/性格由模型按角色名推，不由这里定死）。
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getEffectiveConfig, createLLMClient } from "@/core/llm/client";

type Params = { params: Promise<{ sagaId: string }> };

interface GameSheet {
  name: string;
  role?: string;
  title?: string;
  age?: string;
  appearance?: string;
  personality?: string;
  background?: string;
  abilities?: string[];
  relations?: Array<{ name: string; relation: string; level?: number }>;
  notes?: string;
  [k: string]: unknown;
}

export const maxDuration = 60;

export async function POST(_req: Request, { params }: Params) {
  const { sagaId } = await params;
  try {
    const body = await _req.json().catch(() => ({}));
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) return NextResponse.json({ error: "缺少角色名" }, { status: 400 });

    const saga = await prisma.gameSaga.findUnique({
      where: { id: sagaId },
      select: { characterSheets: true, projectId: true },
    });
    if (!saga) return NextResponse.json({ error: "游戏本不存在" }, { status: 404 });

    const all: Record<string, any> =
      saga.characterSheets && typeof saga.characterSheets === "object"
        ? { ...(saga.characterSheets as Record<string, any>) }
        : {};
    const sheet: GameSheet = all[name] || { name };

    // 哪些字段空着要补（已填的不动）
    const empty: string[] = [];
    if (!sheet.role || !sheet.role.trim()) empty.push("role");
    if (!sheet.title || !sheet.title.trim()) empty.push("title");
    if (!sheet.age || !sheet.age.trim()) empty.push("age");
    if (!sheet.appearance || !sheet.appearance.trim()) empty.push("appearance");
    if (!sheet.personality || !sheet.personality.trim()) empty.push("personality");
    if (!sheet.background || (sheet.background || "").trim().length < 20) empty.push("background");
    if (!Array.isArray(sheet.abilities) || sheet.abilities.length === 0) empty.push("abilities");
    if (!Array.isArray(sheet.relations) || sheet.relations.length === 0) empty.push("relations");
    if (!sheet.notes || !sheet.notes.trim()) empty.push("notes");
    if (empty.length === 0) {
      return NextResponse.json({ ok: true, filled: [], sheet, message: "档案已完整，无需补全" });
    }

    // 项目世界观上下文（让补全贴这个世界，而不是凭空编）
    let synopsis = "";
    let globalPrompt = "";
    if (saga.projectId) {
      try {
        const proj = await prisma.project.findUnique({
          where: { id: saga.projectId },
          select: { synopsis: true, globalPrompt: true },
        });
        synopsis = (proj?.synopsis || "").slice(0, 600);
        globalPrompt = (proj?.globalPrompt || "").slice(0, 1200);
      } catch { /* 项目上下文拿不到不影响补全 */ }
    }

    const prompt = buildPrompt(name, sheet, synopsis, globalPrompt, empty);

    const config = await getEffectiveConfig();
    const model = (config as any)?.writerModel || (config as any)?.model;
    if (!model) return NextResponse.json({ error: "未配置写作模型" }, { status: 500 });
    const client = createLLMClient(config);
    const res = await client.chat({
      model,
      messages: [
        {
          role: "system",
          content:
            "你是专业小说角色设计师。根据角色名与已有信息补全缺失字段。只返回JSON，不要其他文字。内容原创、符合中文小说风格、贴合给定世界观。",
        },
        { role: "user", content: prompt },
      ],
      temperature: 0.7,
      maxTokens: 2048,
    });

    const filled = parseFilled(res.content || "", empty);

    // 合并写回（已填字段一律保留）
    const merged: any = { ...sheet };
    for (const k of ["role", "title", "age", "appearance", "personality", "background", "notes"]) {
      if (filled[k] != null && String(filled[k]).trim()) merged[k] = filled[k];
    }
    if (Array.isArray(filled.abilities) && filled.abilities.length) {
      merged.abilities = filled.abilities.map((x: any) => String(x)).filter(Boolean);
    }
    if (Array.isArray(filled.relations) && filled.relations.length) {
      merged.relations = filled.relations
        .map((r: any) => ({ name: String(r?.name || ""), relation: String(r?.relation || "") }))
        .filter((r: any) => r.name);
    }
    merged.name = name;
    merged.updatedAt = new Date().toISOString();

    all[name] = merged;
    const updated = await prisma.gameSaga.update({
      where: { id: sagaId },
      data: { characterSheets: all },
      select: { characterSheets: true },
    });

    const filledKeys = Object.keys(filled);
    return NextResponse.json({
      ok: true,
      filled: filledKeys,
      sheet: (updated.characterSheets as any)[name],
      message: filledKeys.length ? `已补全 ${filledKeys.length} 项` : "模型未返回可写入内容",
    });
  } catch (e: any) {
    console.error("[game autofill] 补全失败:", e);
    return NextResponse.json({ error: e?.message || "补全失败" }, { status: 500 });
  }
}

function buildPrompt(
  name: string,
  sheet: GameSheet,
  synopsis: string,
  globalPrompt: string,
  empty: string[],
): string {
  const fieldDesc: Record<string, string> = {
    role: "身份/职业（如：落魄书生、江湖游医、没落世家次子）",
    title: "头衔/称号（如：青云弟子、镇北将军、无名客）",
    age: "年龄（如：二十四岁、外表三十实则百岁）",
    appearance: "外貌（2-3句：身形、面貌特征、着装气质）",
    personality: "性格（1-2句：主导性格与内在矛盾）",
    background: "背景故事（3-4句：出身、当前境遇、短期目标、如何卷入眼前之事）",
    abilities: "能力/技能列表（3-6项，逗号分隔，符合角色定位与世界观）",
    relations: "人际关系JSON数组：[{name:关联者姓名, relation:关系(如师徒/宿敌/故人/旧识)}]，1-4条",
    notes: "自由备注（1-2句：可记的怪癖、口头禅或可疑之处）",
  };
  const fields = empty.map((f) => `- ${f}: ${fieldDesc[f] || f}`).join("\n");
  return `请为以下小说角色补全缺失档案。

【角色】
- 姓名：${name}
- 已有身份：${sheet.role || "无"}
- 已有头衔：${sheet.title || "无"}
- 已有年龄：${sheet.age || "无"}
- 已有外貌：${sheet.appearance || "无"}
- 已有性格：${sheet.personality || "无"}
- 已有背景：${(sheet.background || "").slice(0, 200) || "无"}
- 已有能力：${Array.isArray(sheet.abilities) ? sheet.abilities.join("、") : "无"}

【世界上下文】
${synopsis}
${globalPrompt}

【需补全字段】
${fields}

【输出】严格输出JSON，键名对应上述字段名：
{
  "role": "...", "title": "...", "age": "...", "appearance": "...",
  "personality": "...", "background": "...", "abilities": ["...","..."],
  "relations": [{"name":"...","relation":"..."}], "notes": "..."
}
只输出需要补全的字段；长文本控制在 3-4 句，不堆砌套话；列表 1-6 项即可。内容必须原创、合理、贴合世界观。`;
}

function parseFilled(raw: string, empty: string[]): Record<string, any> {
  try {
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return {};
    const obj = JSON.parse(m[0]);
    const out: Record<string, any> = {};
    for (const f of empty) if (obj[f] !== undefined) out[f] = obj[f];
    return out;
  } catch {
    return {};
  }
}
