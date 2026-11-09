import { asArray } from "@/lib/utils";
import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api";
import { BUILTINS } from "@/lib/builtin-presets";

// POST /api/seed/presets —— 写入内置示范预设（首次部署或重置时用）
// 把"参考资料本身就是个预设库"实体化为可一键套用的示范资产。
// 来源：用户提供的《奶龙都能看会的宝宝流数据库使用教程》v2.7，提取其中明确命名的预设概念：
//   · 表格模板预设（主角信息表 / 属性表 / 关系表 / 资产表 / 宫斗·妃嫔居住建筑表）
//   · 剧情推进预设（默认纯召回 / 缝合怪多线推进）
//   · 分阶段人设（<if cell> 语法，文档「IF语法」章节）
//   · 世界观骨架 / 文风 / 角色卡
// 去重规则：{ type, title, isBuiltin:true } 已存在则跳过，因此新增预设只会在首次播种或重置时注入，
// 不会影响用户已有的项目数据。

// BUILTINS 已抽到 src/lib/builtin-presets.ts（单一数据源，避免双份维护）

export async function POST() {
  try {
    let created = 0;
    let updated = 0;
    for (const b of BUILTINS) {
      const tags = Array.from(new Set([...asArray<string>(b.tags), "trirui推荐"]));
      const exists = await prisma.preset.findFirst({
        where: { type: b.type, title: b.title, isBuiltin: true },
      });
      if (!exists) {
        await prisma.preset.create({
          data: { ...b, author: "trirui", tags, isBuiltin: true, isPublic: true } as any,
        });
        created++;
      } else {
        // 同步语义（P3 发布准备）：内置预设以代码为单一事实源——description/content/tags
        // 随版本演进（修 regex 失效、重写描述、加防污染标注），升级用户的旧内置记录必须跟进，
        // 否则「自动播种只处理从零、升级用户永远拿不到修复」。内置预设 UI 不可编辑（需先复刻），覆盖安全。
        await prisma.preset.update({
          where: { id: exists.id },
          data: { description: b.description, content: b.content as any, tags },
        });
        updated++;
      }
    }
    return NextResponse.json({ ok: true, created, updated, total: BUILTINS.length });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return jsonError(`播种预设失败：${msg}`);
  }
}
