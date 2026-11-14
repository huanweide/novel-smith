/**
 * POST /api/game/saga/[sagaId]/characters/inspect
 *
 * 人物卡上的「探查」——判定来源是**你自己**有没有探查的机制或实力
 * （用户原话，2026-11-14）：神识/功法/情报打听，全部确定性计分；
 * 成败交给骰子（d100 ≤ 成功率），AI 只补「探到的东西」，永远不判成败。
 *
 * 流程：
 *   1. inspectPower（纯函数）：自身能力关键词 + 与目标交情 → 成功率与透明明细；
 *   2. 掷骰 d100（服务端），inspectVerdict（纯函数）裁四档；
 *   3. 失败/被抓住：只结算好感惩罚（起疑 -3 / 当场抓住 -10），不探到任何东西；
 *   4. 成功/看穿：一次轻 LLM 调用生成「随身物品清单 + 底细洞察」，
 *      写进 characterSheets[name].revealed（永久知情——看清过的人不会忘）。
 *
 * 响应：{ ok, verdict: { tier, d100, rate, parts, reveals, alertDelta, note }, inventory?, insight? }
 *
 * 铁律：探查不写进正文回合（不消耗游戏轮次、不动 gameState）——看人不是做事，
 * 卡内操作与 autofill 同级；正文里的探查描述照走自由行动，两不相扰。
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getEffectiveConfig, createLLMClient } from "@/core/llm/client";
import { inspectPower, inspectVerdict, tierLabel } from "@/core/game/inspect";

type Params = { params: Promise<{ sagaId: string }> };

export const maxDuration = 60;

interface RevealedInventory {
  name: string;
  desc?: string;
  round: number;
}

export async function POST(req: Request, { params }: Params) {
  const { sagaId } = await params;
  try {
    const body = await req.json().catch(() => ({}));
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) return NextResponse.json({ error: "缺少要探查的人" }, { status: 400 });

    const saga = await prisma.gameSaga.findUnique({
      where: { id: sagaId },
      select: { characterSheets: true, relations: true, playAsName: true, projectId: true },
    });
    if (!saga) return NextResponse.json({ error: "游戏本不存在" }, { status: 404 });

    const all: Record<string, any> =
      saga.characterSheets && typeof saga.characterSheets === "object"
        ? { ...(saga.characterSheets as Record<string, any>) }
        : {};
    const target = all[name] || { name };
    const player = saga.playAsName ? all[saga.playAsName] || {} : {};
    if (saga.playAsName === name) {
      return NextResponse.json({ error: "不用探查你自己——你的底细只在你自己心里" }, { status: 400 });
    }

    // ── 1+2. 探查力 + 掷骰（全确定性，判定过程透明） ──
    const level = Number(
      (saga.relations as Record<string, { level?: number }> | null)?.[name]?.level ?? 0
    );
    const power = inspectPower(
      Array.isArray(player.abilities) ? player.abilities.map(String) : [],
      level
    );
    const d100 = 1 + Math.floor(Math.random() * 100);
    const verdict = inspectVerdict(d100, power.rate);

    // ── 3. 被察觉：好感惩罚照写（探查不是免费的，露形要付代价） ──
    let alertApplied = 0;
    if (verdict.alertDelta !== 0) {
      const rel: Record<string, any> =
        saga.relations && typeof saga.relations === "object" && !Array.isArray(saga.relations)
          ? { ...(saga.relations as Record<string, any>) }
          : {};
      const entry = rel[name] || {};
      const before = Number(entry.level ?? 0);
      const after = Math.max(-100, Math.min(100, before + verdict.alertDelta));
      rel[name] = {
        ...entry,
        level: after,
        history: [...(Array.isArray(entry.history) ? entry.history : []).slice(-19),
          { round: 0, delta: verdict.alertDelta, reason: verdict.tier === "blunder" ? "探查被当场抓住" : "盯人盯得露了形" }],
      };
      await prisma.gameSaga.update({ where: { id: sagaId }, data: { relations: rel as any } });
      alertApplied = verdict.alertDelta;
    }

    // ── 4. 探到了：一次轻 LLM 调用补「随身 + 洞察」（AI 只补货，不判成败） ──
    let inventory: RevealedInventory[] = Array.isArray(target.revealed?.inventory)
      ? (target.revealed.inventory as RevealedInventory[])
      : [];
    let insight: string = (target.revealed?.insight as string) || "";

    if (verdict.reveals.inventory || verdict.reveals.background) {
      let synopsis = "";
      if (saga.projectId) {
        try {
          const proj = await prisma.project.findUnique({
            where: { id: saga.projectId },
            select: { synopsis: true },
          });
          synopsis = (proj?.synopsis || "").slice(0, 500);
        } catch { /* 项目上下文拿不到不影响探查 */ }
      }

      try {
        const config = await getEffectiveConfig();
        const model = (config as any)?.writerModel || (config as any)?.model;
        if (!model) throw new Error("未配置写作模型");
        const client = createLLMClient(config);
        const res = await client.chat({
          model,
          messages: [
            {
              role: "system",
              content:
                '你在为小说角色卡补「被人探查后看到的东西」。只返回JSON，不要其他文字。物品贴合此人身份、家境与随身习惯（2-5件，含身上穿的用的），洞察是一句「表面看不出、细看才知道」的判断。尊重给定世界观，不写不属于此世界的东西。',
            },
            {
              role: "user",
              content: `【世界梗概】${synopsis || "（未知，按常识贴合角色身份）"}

【被探查的人】${name}${target.role ? `（${target.role}）` : ""}${target.title ? ` · ${target.title}` : ""}
性格：${target.personality || "不详"}
背景：${(target.background || "不详").slice(0, 200)}
本事：${Array.isArray(target.abilities) ? target.abilities.join("、") : "不详"}

探查档位：${tierLabel(verdict.tier)}${verdict.tier === "critical" ? "（连他藏起来的那一眼也看见了，可以给一件隐秘物品）" : ""}

请输出：{"items":[{"name":"物品名","desc":"一句话（≤20字）"}],"insight":"一句洞察（≤40字）"}`,
            },
          ],
          temperature: 0.6,
          maxTokens: 600,
        });

        // 宽容解析（坏 JSON 不炸，探查仍算成功——只是清单先空着）
        const m = (res.content || "").match(/\{[\s\S]*\}/);
        if (m) {
          const parsed = JSON.parse(m[0]);
          if (Array.isArray(parsed.items)) {
            const fresh: RevealedInventory[] = parsed.items
              .map((x: any) => ({ name: String(x?.name || "").trim().slice(0, 20), desc: String(x?.desc || "").slice(0, 30) || undefined }))
              .filter((x: RevealedInventory) => x.name)
              .map((x: RevealedInventory) => ({ ...x, round: 0 })); // round 由调用方无轮次语境，记 0 表示「探查所得」
            // 探查所得与已知的合并去重（看清过的东西不会消失）
            const seen = new Set(inventory.map((i) => i.name));
            for (const f of fresh) if (!seen.has(f.name)) { inventory.push(f); seen.add(f.name); }
            inventory = inventory.slice(-20);
          }
          if (typeof parsed.insight === "string" && parsed.insight.trim()) {
            insight = parsed.insight.trim().slice(0, 60);
          }
        }
      } catch {
        // LLM 不可用：判定仍然成立（骰子已掷），只是这次没看清内容——如实告知
        if (inventory.length === 0) inventory = [];
      }
    }

    // ── 写回 revealed（成功才写；失败者 revealed 原样保留——以前看清过的不会忘） ──
    if (verdict.reveals.inventory || verdict.reveals.background) {
      all[name] = {
        ...target,
        name,
        revealed: { ...(target.revealed || {}), insight, inventory },
        updatedAt: new Date().toISOString(),
      };
      await prisma.gameSaga.update({
        where: { id: sagaId },
        data: { characterSheets: all },
        select: { characterSheets: true },
      });
    }

    return NextResponse.json({
      ok: true,
      verdict: { ...verdict, parts: power.parts },
      inventory: verdict.reveals.inventory ? inventory : undefined,
      insight: verdict.reveals.background ? insight : undefined,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "探查失败" }, { status: 500 });
  }
}
